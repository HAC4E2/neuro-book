import {randomUUID} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {ProductPlatform, ProductRuntimeImageIdentity} from "#manager/types";
import {
    ProductRuntimeImageBuilder,
    type VerifiedProductRuntimeImage,
} from "nbook/scripts/build/product-runtime-image-builder";
import {
    createProductRuntimeContract,
    PRODUCT_RUNTIME_COMMAND_BOOTSTRAP,
    PRODUCT_RUNTIME_CONTRACT_PATH,
} from "nbook/shared/product-runtime-contract";

/** 纯 schema/流程测试使用的合法 identity；真实镜像测试必须使用 Builder 返回值。 */
export const TEST_RUNTIME_IMAGE_IDENTITY = {
    imageId: `sha256:${"e".repeat(64)}`,
    sourceDigest: `sha256:${"f".repeat(64)}`,
    lockfileSha256: `sha256:${"9".repeat(64)}`,
    builderContractVersion: "2",
} as const satisfies ProductRuntimeImageIdentity;

/**
 * 在最小 Git-less Source Root 中构建真实 Runtime Image v2 fixture。
 * manifest、ready marker、inventory 与所有 digest 均由正式 Builder 生成。
 */
export async function buildTestRuntimeImage(input: {
    sourceRoot: string;
    version: string;
    revision: string;
    platform: ProductPlatform;
    operationId?: string;
}): Promise<VerifiedProductRuntimeImage> {
    await Promise.all([
        mkdir(join(input.sourceRoot, "node_modules", "nuxt"), {recursive: true}),
        mkdir(join(input.sourceRoot, "node_modules", "nitropack"), {recursive: true}),
    ]);
    await Promise.all([
        writeFile(join(input.sourceRoot, "package.json"), `${JSON.stringify({
            name: "nbook-manager-runtime-image-fixture",
            version: input.version,
        })}\n`, "utf8"),
        writeFile(join(input.sourceRoot, "bun.lock"), "fixture-lock\n", "utf8"),
        writeFile(join(input.sourceRoot, "node_modules", "nuxt", "package.json"), `${JSON.stringify({
            name: "nuxt",
            version: "4.3.1",
        })}\n`, "utf8"),
        writeFile(join(input.sourceRoot, "node_modules", "nitropack", "package.json"), `${JSON.stringify({
            name: "nitropack",
            version: "2.13.4",
        })}\n`, "utf8"),
    ]);

    return await new ProductRuntimeImageBuilder(input.sourceRoot).buildCandidate({
        operationId: input.operationId ?? `manager-fixture-${randomUUID()}`,
        platform: input.platform,
        expectedSource: {
            version: input.version,
            revision: input.revision,
            dirty: false,
        },
        owners: [{name: "test-runtime", paths: ["server"]}],
        budget: {
            maxFiles: 16,
            maxBytes: 64 * 1024,
            ownerBaselines: [{name: "test-runtime", files: 16, bytes: 64 * 1024}],
        },
        async build({imageRoot}) {
            const entry = "server/commands/all.mjs";
            const contract = createProductRuntimeContract({
                productStart: entry,
                sqliteMigrate: entry,
                applicationStateMigration: entry,
                createAdmin: entry,
                profile: entry,
                variable: entry,
                workspace: entry,
                prepareSystemAssets: entry,
                checkMigrations: entry,
                profileAuthoringSmoke: entry,
                imageVariantSmoke: entry,
                sqliteVecSmoke: entry,
            });
            await mkdir(join(imageRoot, "server", "commands"), {recursive: true});
            await Promise.all([
                writeFile(join(imageRoot, "server", "index.mjs"), "export {};\n", "utf8"),
                writeFile(join(imageRoot, ...PRODUCT_RUNTIME_COMMAND_BOOTSTRAP.split("/")), "export {};\n", "utf8"),
                writeFile(join(imageRoot, ...entry.split("/")), "export {};\n", "utf8"),
                writeFile(
                    join(imageRoot, ...PRODUCT_RUNTIME_CONTRACT_PATH.split("/")),
                    `${JSON.stringify(contract, null, 2)}\n`,
                    "utf8",
                ),
            ]);
        },
    });
}
