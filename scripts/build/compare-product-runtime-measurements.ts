import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {parseArgs} from "node:util";

import {
    PRODUCT_PLATFORMS,
    type ProductPlatform,
} from "nbook/packages/neuro-book-manager/src/types";
import {
    PRODUCT_RUNTIME_MEASUREMENT_SCHEMA,
    type ProductRuntimeMeasurementReport,
} from "nbook/scripts/build/product-runtime-image-builder";
import {
    canonicalProductRuntimeJson,
    PRODUCT_RUNTIME_BUILDER_CONTRACT_VERSION,
} from "nbook/shared/product-runtime-image-verifier";

type MeasurementIdentity = Omit<ProductRuntimeMeasurementReport, "measuredAt">;

const IDENTITY_FIELDS = [
    "schema",
    "builderContractVersion",
    "version",
    "revision",
    "dirty",
    "platform",
    "lockfileSha256",
    "sourceDigest",
    "runtime",
    "runtimeContract",
    "policy",
    "inventory",
    "treeDigest",
    "shapeDigest",
] as const satisfies readonly (keyof MeasurementIdentity)[];

/** 比较同平台、同Source的两份measurement；时间戳是唯一允许不同的字段。 */
export async function compareProductRuntimeMeasurements(
    leftPathInput: string,
    rightPathInput: string,
): Promise<{platform: ProductPlatform; revision: string; files: number; bytes: number}> {
    const left = parseMeasurement(await readFile(resolve(leftPathInput), "utf8"), "A");
    const right = parseMeasurement(await readFile(resolve(rightPathInput), "utf8"), "B");
    const drift = IDENTITY_FIELDS.filter((field) => (
        canonicalProductRuntimeJson(left[field]) !== canonicalProductRuntimeJson(right[field])
    ));
    if (drift.length > 0) {
        throw new Error(`Product Runtime measurement A/B不可复现：${drift.join(", ")}`);
    }
    return {
        platform: left.platform,
        revision: left.revision,
        files: left.inventory.files,
        bytes: left.inventory.bytes,
    };
}

/** 收窄受控workflow生成的JSON；外部JSON必须先以unknown读取。 */
function parseMeasurement(text: string, label: "A" | "B"): ProductRuntimeMeasurementReport {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Product Runtime measurement ${label}不是对象。`);
    }
    const record = value as {[key: string]: unknown};
    const platform = PRODUCT_PLATFORMS.find((candidate) => candidate === record.platform);
    const inventory = objectField(record.inventory);
    if (
        record.schema !== PRODUCT_RUNTIME_MEASUREMENT_SCHEMA
        || record.builderContractVersion !== PRODUCT_RUNTIME_BUILDER_CONTRACT_VERSION
        || !platform
        || record.dirty !== false
        || !stringField(record.version)
        || !stringField(record.revision)
        || !stringField(record.lockfileSha256)
        || !stringField(record.sourceDigest)
        || !stringField(record.treeDigest)
        || !stringField(record.shapeDigest)
        || !stringField(record.measuredAt)
        || !Number.isFinite(Date.parse(record.measuredAt))
        || !objectField(record.runtime)
        || !objectField(record.runtimeContract)
        || !objectField(record.policy)
        || !Number.isSafeInteger(inventory?.files)
        || !Number.isSafeInteger(inventory?.bytes)
        || !Array.isArray(inventory?.owners)
    ) {
        throw new Error(`Product Runtime measurement ${label}身份或inventory无效。`);
    }
    return value as ProductRuntimeMeasurementReport;
}

/** 只接受非数组对象。 */
function objectField(value: unknown): {[key: string]: unknown} | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as {[key: string]: unknown}
        : undefined;
}

/** identity文本字段不能是空字符串。 */
function stringField(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

if (import.meta.main) {
    const {values} = parseArgs({
        allowPositionals: false,
        options: {
            left: {type: "string"},
            right: {type: "string"},
        },
        strict: true,
    });
    if (!values.left || !values.right) {
        throw new Error("用法：bun scripts/build/compare-product-runtime-measurements.ts --left <A.json> --right <B.json>");
    }
    console.log(JSON.stringify({
        ok: true,
        ...await compareProductRuntimeMeasurements(values.left, values.right),
    }, null, 4));
}
