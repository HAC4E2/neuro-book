import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {afterEach, describe, expect, it} from "vitest";

import {compareProductRuntimeMeasurements} from "nbook/scripts/build/compare-product-runtime-measurements";
import {
    PRODUCT_RUNTIME_MEASUREMENT_SCHEMA,
    type ProductRuntimeMeasurementReport,
} from "nbook/scripts/build/product-runtime-image-builder";
import {
    PRODUCT_RUNTIME_BUILDER_CONTRACT_VERSION,
    PRODUCT_RUNTIME_MAX_BYTES,
    PRODUCT_RUNTIME_MAX_FILES,
} from "nbook/shared/product-runtime-image-verifier";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Product Runtime measurement A/B", () => {
    it("只允许测量时间不同", async () => {
        const root = await sandbox();
        const left = report();
        const right = {...report(), measuredAt: "2026-08-02T00:00:01.000Z"};
        const [leftPath, rightPath] = await writeReports(root, left, right);

        await expect(compareProductRuntimeMeasurements(leftPath, rightPath)).resolves.toEqual({
            platform: "linux-x64-glibc",
            revision: "a".repeat(40),
            files: 1,
            bytes: 2,
        });
    });

    it("拒绝owner inventory或逐文件tree digest漂移", async () => {
        const root = await sandbox();
        const left = report();
        const right = report();
        right.inventory.bytes += 1;
        right.treeDigest = `sha256:${"e".repeat(64)}`;
        const [leftPath, rightPath] = await writeReports(root, left, right);

        await expect(compareProductRuntimeMeasurements(leftPath, rightPath))
            .rejects.toThrow("inventory, treeDigest");
    });
});

/** 创建隔离measurement fixture目录。 */
async function sandbox(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "nbook-product-measurement-"));
    roots.push(root);
    return root;
}

/** 写入两份受控报告。 */
async function writeReports(
    root: string,
    left: ProductRuntimeMeasurementReport,
    right: ProductRuntimeMeasurementReport,
): Promise<[string, string]> {
    const leftPath = join(root, "a.json");
    const rightPath = join(root, "b.json");
    await Promise.all([
        writeFile(leftPath, JSON.stringify(left), "utf8"),
        writeFile(rightPath, JSON.stringify(right), "utf8"),
    ]);
    return [leftPath, rightPath];
}

/** 返回具备全部稳定identity字段的最小报告。 */
function report(): ProductRuntimeMeasurementReport {
    return {
        schema: PRODUCT_RUNTIME_MEASUREMENT_SCHEMA,
        builderContractVersion: PRODUCT_RUNTIME_BUILDER_CONTRACT_VERSION,
        version: "0.9.0-canary.test",
        revision: "a".repeat(40),
        dirty: false,
        platform: "linux-x64-glibc",
        lockfileSha256: `sha256:${"b".repeat(64)}`,
        sourceDigest: `sha256:${"c".repeat(64)}`,
        runtime: {bun: "1.3.14", nuxt: "4.3.0", nitro: "2.13.4"},
        runtimeContract: {path: "server/runtime-contract.json", sha256: `sha256:${"d".repeat(64)}`},
        policy: {
            registered: false,
            owners: [{name: "frontend", paths: ["public"]}],
            globalBudget: {maxFiles: PRODUCT_RUNTIME_MAX_FILES, maxBytes: PRODUCT_RUNTIME_MAX_BYTES},
        },
        inventory: {
            files: 1,
            bytes: 2,
            owners: [{name: "frontend", paths: ["public"], files: 1, bytes: 2}],
        },
        treeDigest: `sha256:${"f".repeat(64)}`,
        shapeDigest: `sha256:${"0".repeat(64)}`,
        measuredAt: "2026-08-02T00:00:00.000Z",
    };
}
