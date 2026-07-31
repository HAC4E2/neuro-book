import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {lock as acquireFileLock} from "proper-lockfile";
import {currentProductPlatform} from "nbook/packages/neuro-book-manager/src/platform";
import type {ProductPlatform} from "nbook/packages/neuro-book-manager/src/types";
import {LocalProductPublisher} from "nbook/scripts/build/local-product-publisher";
import {
    ProductRuntimeImageBuilder,
    type ProductRuntimeImageOwner,
    type ProductRuntimeOwnerBaseline,
} from "nbook/scripts/build/product-runtime-image-builder";

export const PRODUCT_RUNTIME_MAX_BYTES = 360 * 1024 * 1024;
export const PRODUCT_RUNTIME_MAX_FILES = 6_000;
export const PRODUCT_SOURCE_DATE_EPOCH = "0";
const PRODUCT_BUILD_PASSTHROUGH_ENVIRONMENT = new Set([
    "APPDATA",
    "COMSPEC",
    "DYLD_LIBRARY_PATH",
    "HOME",
    "LD_LIBRARY_PATH",
    "LOCALAPPDATA",
    "PATH",
    "PATHEXT",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USERPROFILE",
    "WINDIR",
    "XDG_CACHE_HOME",
]);

export const PRODUCT_RUNTIME_OWNERS: readonly ProductRuntimeImageOwner[] = [
    {name: "frontend", paths: ["public"]},
    {name: "server-bundle", paths: ["server/index.mjs", "server/index.mjs.map"]},
    {name: "commands", paths: ["server/commands", "server/prisma"]},
    {name: "authoring-kit", paths: ["server/authoring"]},
    {name: "native-islands", paths: ["server/node_modules", "server/native-islands.json"]},
    {name: "system-assets", paths: ["server/assets"]},
    {name: "runtime-meta", paths: ["nitro.json", "server/package.json", "server/runtime-contract.json"]},
] as const;

// 2026-07-29 Windows x64 verified Runtime Image 的 owner inventory。
// 上调任一值必须同步 ADR 0009 与 Task 130，不能只放宽 CI 数字。
const PRODUCT_RUNTIME_OWNER_BASELINES: Readonly<Partial<Record<ProductPlatform, readonly ProductRuntimeOwnerBaseline[]>>> = {
    "windows-x64": [
        {name: "frontend", files: 176, bytes: 15_810_725},
        {name: "server-bundle", files: 1, bytes: 12_571_222},
        {name: "commands", files: 102, bytes: 10_692_845},
        {name: "authoring-kit", files: 1_923, bytes: 20_694_368},
        {name: "native-islands", files: 2_102, bytes: 86_688_809},
        {name: "system-assets", files: 376, bytes: 14_812_033},
        {name: "runtime-meta", files: 3, bytes: 4_229},
    ],
};

/** 统一执行 Nuxt raw build、Product 后处理、Runtime Image 验证与本地发布。 */
export async function buildProductRuntimeImage(): Promise<void> {
    const projectRoot = process.cwd();
    await withProductBuildLease(projectRoot, async () => {
        const platform = currentProductPlatform();
        const ownerBaselines = productRuntimeOwnerBaselines(platform);
        const buildEnvironment = productBuildEnvironment(process.env);
        await run("bun", ["scripts/build/prepare-system-assets.ts"], buildEnvironment);
        const explicitRevision = process.env.NEURO_BOOK_SOURCE_REVISION?.trim();
        const operationId = `${new Date().toISOString().replace(/[^0-9]/gu, "")}-${randomUUID()}`;
        const builder = new ProductRuntimeImageBuilder(projectRoot);
        const candidate = await builder.buildCandidate({
            operationId,
            platform,
            owners: PRODUCT_RUNTIME_OWNERS,
            expectedSource: explicitRevision ? {revision: explicitRevision, dirty: false} : undefined,
            budget: {
                maxFiles: PRODUCT_RUNTIME_MAX_FILES,
                maxBytes: PRODUCT_RUNTIME_MAX_BYTES,
                ownerBaselines,
            },
            async build({imageRoot, scratchRoot, sourceDigest}) {
                await run("bun", ["run", "nuxt:build:raw"], {
                    ...buildEnvironment,
                    NEURO_BOOK_OUTPUT_DIR: imageRoot,
                    NEURO_BOOK_PRODUCT_IMAGE_ROOT: imageRoot,
                    NEURO_BOOK_PRODUCT_SOURCE_DIGEST: sourceDigest,
                });
                await run("bun", ["scripts/build/patch-nitro-runtime-deps.mjs"], {
                    ...buildEnvironment,
                    NEURO_BOOK_OUTPUT_DIR: imageRoot,
                    NEURO_BOOK_PRODUCT_SCRATCH_ROOT: scratchRoot,
                });
            },
        });
        const published = await new LocalProductPublisher(projectRoot, builder).publish({
            candidate,
            explicitOutputRoot: process.env.NEURO_BOOK_OUTPUT_DIR?.trim() || undefined,
        });
        console.log([
            `Product Runtime Image published: ${published.path}`,
            `imageId=${published.manifest.imageId}`,
            `files=${published.manifest.inventory.files}`,
            `bytes=${published.manifest.inventory.bytes}`,
        ].join(" ") );
    });
}

/**
 * 串行化整个 Product pipeline，包括会共享 `.nuxt` 与生成源码的 prepare/raw build。
 * 候选仍有自己的 lease；此处专门阻止两个 operation 同时读取共享 Developer Build State。
 */
export async function withProductBuildLease<T>(projectRoot: string, operation: () => Promise<T>): Promise<T> {
    const lockTarget = resolve(projectRoot, ".deploy", "product-runtime-builder");
    await mkdir(resolve(lockTarget, ".."), {recursive: true});
    await writeFile(lockTarget, "", {encoding: "utf8", flag: "a"});
    let release: (() => Promise<void>) | undefined;
    try {
        release = await acquireFileLock(lockTarget, {
            realpath: false,
            stale: 5 * 60 * 1000,
            update: 30 * 1000,
            retries: 0,
        });
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ELOCKED") {
            throw new Error("已有 Product build 正在使用共享 `.nuxt`/Source 生成态；拒绝并发构建。", {cause: error});
        }
        throw error;
    }
    try {
        return await operation();
    } finally {
        await release();
    }
}

/**
 * 为 Product 构建创建显式、跨 CI/本机一致的环境。
 *
 * 只透传进程启动和临时目录所需的 OS 变量；任意宿主 `NUXT_*`、`NITRO_*`、
 * `VITE_*` 或运行期 Secret 都不能静默改变同一 Source identity 的 payload。
 */
export function productBuildEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    for (const [name, value] of Object.entries(source)) {
        if (value !== undefined && PRODUCT_BUILD_PASSTHROUGH_ENVIRONMENT.has(name.toUpperCase())) {
            environment[name] = value;
        }
    }
    return {
        ...environment,
        LANG: "C",
        LC_ALL: "C",
        NITRO_PRESET: "node-server",
        NODE_ENV: "production",
        NUXT_DEVTOOLS: "0",
        NUXT_TELEMETRY_DISABLED: "1",
        SOURCE_DATE_EPOCH: PRODUCT_SOURCE_DATE_EPOCH,
        TZ: "UTC",
    };
}

/** 返回当前平台经过真实构建审查的 owner baseline；未知平台禁止借用其他平台数字。 */
export function productRuntimeOwnerBaselines(platform: ProductPlatform): readonly ProductRuntimeOwnerBaseline[] {
    const baselines = PRODUCT_RUNTIME_OWNER_BASELINES[platform];
    if (!baselines) {
        throw new Error(`Product Runtime Image 尚未登记 ${platform} 的 owner baseline，拒绝使用其他平台预算。`);
    }
    return baselines;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {cwd: process.cwd(), env, stdio: "inherit", windowsHide: true});
        child.on("error", rejectPromise);
        child.on("exit", (code, signal) => {
            if (signal) {
                rejectPromise(new Error(`${command} 被信号中断：${signal}`));
            } else if (code !== 0) {
                rejectPromise(new Error(`${command} ${args.join(" ")} 退出码 ${code ?? 1}`));
            } else {
                resolvePromise();
            }
        });
    });
}

if (import.meta.main) {
    await buildProductRuntimeImage();
}
