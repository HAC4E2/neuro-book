import {existsSync, readFileSync} from "node:fs";
import {isAbsolute, join, relative, resolve} from "node:path";

/** Runtime artifact 编译时使用的唯一源码与依赖上下文。 */
export type RuntimeArtifactCompilerContext = Readonly<{
    root: string;
    productRuntime: boolean;
    outputRoot: string;
    nbookRoot: string;
    /** 编译 Profile/Variable 时唯一允许的 package 解析根。 */
    compilerPackageRoot: string;
    /** 仅供 esbuild 解析批准 authoring 依赖的 node_modules。 */
    compilerNodeModulesRoot: string;
    /** 已生成 artifact 在 Product 运行时建立 require 的根。 */
    artifactRuntimeRequireRoot: string;
    tsconfigPath: string;
}>;

/**
 * 解析 Profile、Variable 等 Runtime artifact 的编译上下文。
 *
 * Source 开发直接使用 checkout；Product 必须完全绑定 `.output/server`，禁止
 * freshness manifest 记录最终安装包中不存在的根 `node_modules` 或生成源码。
 */
export function resolveRuntimeArtifactCompilerContext(
    root = process.cwd(),
    env: NodeJS.ProcessEnv = process.env,
): RuntimeArtifactCompilerContext {
    const absoluteRoot = resolve(root);
    const explicitImageRoot = env.NEURO_BOOK_PRODUCT_IMAGE_ROOT?.trim();
    const outputRoot = explicitImageRoot
        ? resolve(explicitImageRoot, "server")
        : resolve(absoluteRoot, ".output", "server");
    const outputEntry = resolve(outputRoot, "index.mjs");
    const rootPackage = resolve(absoluteRoot, "package.json");
    const outputPackage = resolve(outputRoot, "package.json");
    const productRuntime = existsSync(outputEntry) && (Boolean(explicitImageRoot) || (
        packageManifestName(rootPackage) === "neuro-book-product"
        || packageManifestName(outputPackage) === "neuro-book-output"
            && (env.NEURO_BOOK_PRODUCT_BUILD === "1" || !existsSync(resolve(absoluteRoot, "node_modules")))
    ));

    if (!productRuntime) {
        return Object.freeze({
            root: absoluteRoot,
            productRuntime: false,
            outputRoot,
            nbookRoot: absoluteRoot,
            compilerPackageRoot: rootPackage,
            compilerNodeModulesRoot: resolve(absoluteRoot, "node_modules"),
            artifactRuntimeRequireRoot: rootPackage,
            tsconfigPath: resolve(absoluteRoot, "tsconfig.json"),
        });
    }

    const authoringRoot = resolve(outputRoot, "authoring");
    const tsconfigPath = resolve(authoringRoot, "tsconfig.json");
    const authoringPackagePath = resolve(authoringRoot, "package.json");
    if (!existsSync(tsconfigPath) || !existsSync(authoringPackagePath)) {
        throw new Error(`Product runtime 缺少自包含 Authoring Kit：${authoringRoot}`);
    }
    return Object.freeze({
        root: absoluteRoot,
        productRuntime: true,
        outputRoot,
        nbookRoot: resolve(authoringRoot, "nbook"),
        compilerPackageRoot: authoringPackagePath,
        compilerNodeModulesRoot: resolve(authoringRoot, "node_modules"),
        artifactRuntimeRequireRoot: outputEntry,
        tsconfigPath,
    });
}

/** 把 staging image 内的物理依赖路径稳定写成激活后的 `.output/server/**` 身份。 */
export function normalizeRuntimeArtifactPath(
    filePath: string,
    context = resolveRuntimeArtifactCompilerContext(),
): string {
    const absolutePath = resolve(filePath);
    if (context.productRuntime) {
        const outputRelative = relative(context.outputRoot, absolutePath);
        if (outputRelative === "" || outputRelative === ".") return ".output/server";
        if (!outputRelative.startsWith("..") && !isAbsolute(outputRelative)) {
            return `.output/server/${outputRelative.split(/[\\/]+/u).join("/")}`;
        }
    }
    const cwdRelative = relative(process.cwd(), absolutePath);
    if (cwdRelative && !cwdRelative.startsWith("..") && !isAbsolute(cwdRelative)) {
        return cwdRelative.split(/[\\/]+/u).join("/");
    }
    return absolutePath.split(/[\\/]+/u).join("/");
}

/** 从当前编译上下文解析 `nbook/*` 包级源码。 */
export function resolveRuntimeArtifactNbookPath(
    context: RuntimeArtifactCompilerContext,
    relativePath: string,
): string {
    const basePath = resolve(context.nbookRoot, relativePath);
    const candidates = [
        join(basePath, "index.ts"),
        join(basePath, "index.tsx"),
        join(basePath, "index.js"),
        join(basePath, "index.mjs"),
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.js`,
        `${basePath}.mjs`,
        basePath,
    ];
    const resolvedPath = candidates.find((candidate) => existsSync(candidate));
    if (!resolvedPath) {
        const source = context.productRuntime ? "Product Profile Authoring Kit" : "Source checkout";
        throw new Error(`${source} 无法解析 nbook 包级 import：${relativePath}`);
    }
    return resolvedPath;
}

/** 读取 package name；损坏或缺失时返回 null。 */
function packageManifestName(path: string): string | null {
    try {
        const manifest = JSON.parse(readFileSync(path, "utf8")) as {name?: string};
        return typeof manifest.name === "string" ? manifest.name : null;
    } catch {
        return null;
    }
}
