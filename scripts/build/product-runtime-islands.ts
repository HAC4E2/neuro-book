import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, resolve} from "node:path";
import {pathToFileURL} from "node:url";

/** Product 中必须保留真实 package 形状的一组运行依赖。 */
export type ProductRuntimeIslandDefinition = {
    packages: string[];
    reason: string;
    smoke: string;
};

/** 最终 bundle 中无法由 ESM lexer 还原字面量的动态 import 登记。 */
export type ProductOpaqueImportDefinition = {
    pathPattern: string;
    count: number;
    reason: string;
    smoke: string;
};

type PackageManifest = {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
};

let cachedDynamicPackages: string[] | undefined;
let cachedRuntimePackages: string[] | undefined;

/**
 * 返回当前平台完整的 package island 登记。
 *
 * jsdom/undici 会读取 package 相对文件，TypeScript 会读取 `lib/*.d.ts`；它们
 * 不能安全冻结进单文件 bundle。其余纯 JS Provider SDK 仍由 Bun 收入 bundle。
 */
export function productRuntimeIslandDefinitions(): ProductRuntimeIslandDefinition[] {
    const definitions: ProductRuntimeIslandDefinition[] = [
        {
            packages: dynamicPackageNames(),
            reason: "jsdom/undici 与 TypeScript 在运行时读取 package 相对文件，必须保留真实 package 形状。",
            smoke: "Profile compiler compile/import and Product HTTP startup",
        },
        {
            packages: ["esbuild"],
            reason: "Profile compiler 在运行时调用 esbuild，并由 package 解析平台 binary。",
            smoke: "import esbuild and transform TypeScript",
        },
        {
            packages: ["libsql", "@neon-rs/load", "detect-libc"],
            reason: "libsql 动态加载当前平台的 native binding。",
            smoke: "import libsql and open SQLite",
        },
        {
            packages: ["sqlite-vec"],
            reason: "sqlite-vec 按平台解析 extension 动态库的真实路径。",
            smoke: "resolve sqlite-vec extension path and load it",
        },
        {
            packages: ["sharp", "@img/colour", "semver"],
            reason: "Sharp 通过 package 形状定位当前平台 addon 与 libvips。",
            smoke: "run the compiled Image Variant command through generation and a fresh-instance cache hit",
        },
    ];
    if (process.platform === "win32" && process.arch === "x64") {
        definitions[1]!.packages.push("@esbuild/win32-x64");
        definitions[2]!.packages.push("@libsql/win32-x64-msvc");
        definitions[3]!.packages.push("sqlite-vec-windows-x64");
        definitions[4]!.packages.push("@img/sharp-win32-x64");
        return definitions;
    }
    if (process.platform === "linux" && process.arch === "x64") {
        definitions[1]!.packages.push("@esbuild/linux-x64");
        definitions[2]!.packages.push("@libsql/linux-x64-gnu");
        definitions[3]!.packages.push("sqlite-vec-linux-x64");
        definitions[4]!.packages.push("@img/sharp-linux-x64", "@img/sharp-libvips-linux-x64");
        return definitions;
    }
    if (process.platform === "linux" && process.arch === "arm64") {
        definitions[1]!.packages.push("@esbuild/linux-arm64");
        definitions[2]!.packages.push("@libsql/linux-arm64-gnu");
        definitions[3]!.packages.push("sqlite-vec-linux-arm64");
        definitions[4]!.packages.push("@img/sharp-linux-arm64", "@img/sharp-libvips-linux-arm64");
        return definitions;
    }
    if (process.platform === "darwin" && process.arch === "x64") {
        definitions[1]!.packages.push("@esbuild/darwin-x64");
        definitions[2]!.packages.push("@libsql/darwin-x64");
        definitions[3]!.packages.push("sqlite-vec-darwin-x64");
        definitions[4]!.packages.push("@img/sharp-darwin-x64", "@img/sharp-libvips-darwin-x64");
        return definitions;
    }
    if (process.platform === "darwin" && process.arch === "arm64") {
        definitions[1]!.packages.push("@esbuild/darwin-arm64");
        definitions[2]!.packages.push("@libsql/darwin-arm64");
        definitions[3]!.packages.push("sqlite-vec-darwin-arm64");
        definitions[4]!.packages.push("@img/sharp-darwin-arm64", "@img/sharp-libvips-darwin-arm64");
        return definitions;
    }
    throw new Error(`Product Runtime 尚未登记 package islands：${process.platform}-${process.arch}`);
}

/** 返回供 Bun external 与最终复制共同消费的稳定 package 集合。 */
export function productRuntimeIslandPackageNames(): string[] {
    cachedRuntimePackages ??= [...new Set(
        productRuntimeIslandDefinitions().flatMap((island) => island.packages),
    )].sort();
    return [...cachedRuntimePackages];
}

/**
 * 判断 Rollup module id 是否属于 Product package island。
 * 支持 bare specifier，以及 npm、Bun、pnpm 物理路径中的最后一个 `node_modules` 边界。
 */
export function isProductRuntimeIslandModule(id: string): boolean {
    if (!id || id.startsWith("\0")) return false;
    const normalized = id.replaceAll("\\", "/");
    const packagePathWithSuffix = normalized.split("/node_modules/").at(-1) ?? normalized;
    const suffixIndex = [packagePathWithSuffix.indexOf("?"), packagePathWithSuffix.indexOf("#")]
        .filter((index) => index >= 0)
        .sort((left, right) => left - right)[0];
    const packagePath = suffixIndex === undefined
        ? packagePathWithSuffix
        : packagePathWithSuffix.slice(0, suffixIndex);
    return productRuntimeIslandPackageNames().some((packageName) => (
        packagePath === packageName || packagePath.startsWith(`${packageName}/`)
    ));
}

/**
 * 返回最终 Product 允许保留的 opaque dynamic import 精确集合。
 *
 * Bun shared chunk 的 content hash 会随 Source 改变，因此 product-start 使用一个
 * 受限文件名前缀；数量仍必须完全一致，任何新增、消失或移动都要求重新审查本合同。
 */
export function productOpaqueImportDefinitions(): ProductOpaqueImportDefinition[] {
    return [
        {
            pathPattern: "index.mjs",
            count: 3,
            reason: "Nitro server bundle 保留运行时选择的 Profile、SQLite 与 Provider module loader。",
            smoke: "Product HTTP startup and authenticated shutdown; TypeScript and jsdom use Profile/Variable and web-fetch checks",
        },
        {
            pathPattern: "authoring/profile-compile-worker.mjs",
            count: 2,
            reason: "Profile Authoring Worker 按批准依赖和已编译 artifact 地址执行动态加载。",
            smoke: "Profile compiler compile/import with typebox",
        },
        {
            pathPattern: "commands/chunks/product-start-*.mjs",
            count: 3,
            reason: "Product start 的共享依赖按当前 Runtime 与平台选择 module implementation。",
            smoke: "Product command start and database/application-state migrations",
        },
    ];
}

/**
 * 返回 Source 根中已 hoist 的 package island 目录，并核对 manifest 身份。
 * 不通过 `<package>/package.json` 解析，因为 Sharp 等包会用 exports 隐藏该 subpath。
 */
export function productRuntimeIslandSourceRoot(packageName: string, sourceRoot = resolve(".")): string {
    const packageRoot = resolve(sourceRoot, "node_modules", ...packageName.split("/"));
    const manifest = readPackageManifest(resolve(packageRoot, "package.json"));
    if (manifest.name !== packageName || typeof manifest.version !== "string" || !manifest.version) {
        throw new Error(`Product package island Source 身份无效：${packageName} (${packageRoot})`);
    }
    return packageRoot;
}

/**
 * 解析 jsdom 的运行依赖闭包并要求所有实例可安全扁平化到 Product node_modules。
 * 出现同名不同版本时直接失败，不能静默复制错误版本。
 */
function dynamicPackageNames(): string[] {
    if (cachedDynamicPackages) return [...cachedDynamicPackages];
    const rootRequire = createRequire(pathToFileURL(resolve("package.json")));
    const queue = [rootRequire.resolve("jsdom/package.json")];
    const visited = new Set<string>();
    const packages = new Map<string, {version: string; packageJsonPath: string}>();
    while (queue.length > 0) {
        const packageJsonPath = queue.shift()!;
        const identityPath = resolve(packageJsonPath).toLowerCase();
        if (visited.has(identityPath)) continue;
        visited.add(identityPath);
        const manifest = readPackageManifest(packageJsonPath);
        const name = manifest.name;
        const version = manifest.version;
        if (!name || !version) throw new Error(`Product dynamic island package 缺少 name/version：${packageJsonPath}`);
        const existing = packages.get(name);
        if (existing && existing.version !== version) {
            throw new Error(`Product dynamic island 无法扁平化 ${name}：${existing.version} != ${version}`);
        }
        const hoistedPath = resolvePackageManifest(rootRequire, name);
        const hoisted = readPackageManifest(hoistedPath);
        if (hoisted.name !== name || hoisted.version !== version) {
            throw new Error(`Product dynamic island 与 hoisted package 身份不一致：${name}@${version}`);
        }
        packages.set(name, {version, packageJsonPath});
        const requireFromPackage = createRequire(pathToFileURL(packageJsonPath));
        for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
            queue.push(resolvePackageManifest(requireFromPackage, dependency));
        }
    }
    cachedDynamicPackages = ["typescript", ...packages.keys()].sort();
    return [...cachedDynamicPackages];
}

/** 从 package.json 读取构建期受信 manifest。 */
function readPackageManifest(packageJsonPath: string): PackageManifest {
    return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageManifest;
}

/**
 * 解析 package manifest；当 package exports 隐藏 `package.json` 时，从真实入口向上定位。
 * 只有 name 精确匹配的 manifest 才能充当依赖身份，不能误取祖先 package。
 */
function resolvePackageManifest(requireFrom: NodeRequire, packageName: string): string {
    try {
        return requireFrom.resolve(`${packageName}/package.json`);
    } catch (packageJsonError) {
        let entryPath: string;
        try {
            entryPath = requireFrom.resolve(packageName);
        } catch (entryError) {
            throw new Error(`Product package island 无法解析依赖：${packageName}`, {cause: entryError});
        }
        let directory = dirname(entryPath);
        while (true) {
            const packageJsonPath = resolve(directory, "package.json");
            try {
                if (readPackageManifest(packageJsonPath).name === packageName) return packageJsonPath;
            } catch {
                // 继续向上寻找当前入口所属 package；缺失或损坏的祖先不能成为身份。
            }
            const parent = dirname(directory);
            if (parent === directory) break;
            directory = parent;
        }
        throw new Error(`Product package island 无法定位 manifest：${packageName}`, {cause: packageJsonError});
    }
}
