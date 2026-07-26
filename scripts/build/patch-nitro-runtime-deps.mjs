#!/usr/bin/env bun
import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile} from "node:fs/promises";
import {dirname, relative, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {compileProfileArtifacts} from "nbook/server/agent/profiles/profile-artifact-compiler";

const runtimePackageSeeds = [
    "@clack/prompts",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@libsql/client",
    "@libsql/isomorphic-ws",
    "@prisma/debug",
    "chokidar",
    "commander",
    "consola",
    "diff",
    "dotenv",
    "esbuild",
    "fflate",
    "h3",
    "picocolors",
    "sqlite-vec",
    "typebox",
    "tsx",
    "typescript",
    "undici",
    "vue",
    "ws",
    "yaml",
    "yazl",
    "zod",
];
const effectiveRuntimePackageSeeds = runtimePackageSeeds;
const runtimeContextPaths = [
    "AGENTS.md",
    "reference",
    "docs",
    "assets/workspace",
    "server",
    "shared",
    "prisma/migrations/sqlite",
    "prisma/schema.sqlite.prisma",
    "prisma.config.ts",
    "scripts/cli/create-admin.ts",
    "scripts/cli/has-users.ts",
    "scripts/cli/prisma-runtime-preflight.ts",
    "scripts/cli/sync-user-assets.ts",
    "scripts/deploy/product-start.mjs",
    "scripts/db",
    "scripts/build/prepare-system-assets.ts",
    "scripts/build/profile.ts",
    "scripts/build/variable.ts",
    "scripts/utils",
    "tsconfig.json",
    ".nuxt/tsconfig.json",
    ".nuxt/tsconfig.server.json",
];
const outputRoot = resolve(process.env.NEURO_BOOK_OUTPUT_DIR ?? ".output");
const serverRoot = resolve(outputRoot, "server");
const illegalImportMetaFallback = "file:///_entry.js";
const importMetaFallbackShape = '{url:"file:///_entry.js",env:process.env}';
const sourceNodeModulesFileUrl = pathToFileURL(resolve("node_modules")).href.replace(/\/?$/, "/");
const sourceNodeModulesFileUrlVariants = [
    sourceNodeModulesFileUrl,
    sourceNodeModulesFileUrl.replace(/^file:\/\/\//, "file://"),
];
const bunStoreModuleSpecifierPattern = /(["'])((?:\.\.\/|\.\/)*node_modules\/\.bun\/([^/"']+)\/node_modules\/(@[^/"']+\/[^/"']+|[^/"']+)(\/[^"'\r\n]*)?)\1/g;

const timings = [];
const packageCopyStats = {
    copied: 0,
    skipped: 0,
};

const patchedExternalFileUrls = await measure("patch external file URLs", async () => {
    return await patchExternalFileUrls(serverRoot);
});

await measure("copy runtime package closure", async () => {
    await copyRuntimePackageClosure([
        ...effectiveRuntimePackageSeeds,
        ...await collectNitroExternalPackageSeeds(serverRoot),
    ]);
});

await measure("copy profile import context", async () => {
    for (const runtimePath of runtimeContextPaths) {
        const source = resolve(runtimePath);
        const target = resolve(serverRoot, runtimePath);
        if (!existsSync(source)) {
            throw new Error(`缺少 Nitro runtime 文件：${runtimePath}`);
        }
        await rm(target, {recursive: true, force: true});
        await mkdir(dirname(target), {recursive: true});
        await copyDirectory(source, target);
    }
});
await measure("assert product output runtime files", async () => {
    await assertProductOutputRuntimeFiles();
});

await measure("copy workspace cli runtime script", async () => {
    await copyWorkspaceCliRuntimeScript();
});
await measure("write product package manifest", async () => {
    await writeProductPackageJson();
});
await measure("copy nbook runtime package", async () => {
    await copyNbookRuntimePackage();
});
await measure("assert nbook runtime package", async () => {
    assertNbookRuntimePackage(resolve(serverRoot, "node_modules", "nbook"));
});
await measure("compile Product system profiles", async () => {
    const previous = process.env.NEURO_BOOK_PRODUCT_BUILD;
    process.env.NEURO_BOOK_PRODUCT_BUILD = "1";
    try {
        await compileProfileArtifacts({
            profileRoot: resolve(serverRoot, "assets", "workspace", ".nbook", "agent", "profiles"),
            rootLabel: relative(process.cwd(), resolve(serverRoot, "assets", "workspace", ".nbook", "agent", "profiles")).replaceAll("\\", "/"),
        });
    } finally {
        if (previous === undefined) delete process.env.NEURO_BOOK_PRODUCT_BUILD;
        else process.env.NEURO_BOOK_PRODUCT_BUILD = previous;
    }
});
await measure("copy Bun store runtime closure", async () => {
    await copyBunStoreRuntimeClosure(await collectBunStoreRuntimeSeeds(serverRoot));
});
await measure("assert Bun store runtime closure", async () => {
    await assertBunStoreRuntimeImports(serverRoot);
});
const patchedImportMetaFiles = await measure("patch import.meta fallbacks", async () => {
    return await patchImportMetaFallbacks(resolve(serverRoot, "chunks"));
});
await measure("assert import.meta fallbacks", async () => {
    await assertNoIllegalImportMetaFallbacks(resolve(serverRoot, "chunks"));
});
await measure("assert external file URLs", async () => {
    await assertNoRepoNodeModuleFileUrls(serverRoot);
});

console.log(`patched Nitro runtime dependencies: ${effectiveRuntimePackageSeeds.join(", ")}`);
console.log(`copied profile import context: ${runtimeContextPaths.join(", ")}`);
console.log(`patched Nitro import.meta fallbacks: ${patchedImportMetaFiles}`);
console.log(`patched external node_modules file URLs: ${patchedExternalFileUrls}`);
console.log(`Nitro runtime package copy: copied=${packageCopyStats.copied}, skipped=${packageCopyStats.skipped}`);
console.log(`patch Nitro runtime deps timings: ${timings.map((item) => `${item.label}=${item.seconds.toFixed(2)}s`).join(", ")}`);

/**
 * 记录 Product Runtime 后处理阶段耗时，便于定位 Windows 大量小文件复制瓶颈。
 */
async function measure(label, action) {
    const startedAt = performance.now();
    try {
        return await action();
    } finally {
        timings.push({
            label,
            seconds: (performance.now() - startedAt) / 1000,
        });
    }
}

/**
 * GHCR / 通用 `.output` runner 不经过 `product:stage`，启动所需脚本必须在
 * Nitro 后处理阶段进入 `.output/server/scripts/**`。
 */
async function assertProductOutputRuntimeFiles() {
    const requiredPaths = [
        "prisma/migrations/sqlite",
        "prisma/schema.sqlite.prisma",
        "prisma.config.ts",
        "scripts/build/prepare-system-assets.ts",
        "scripts/deploy/product-start.mjs",
        "scripts/db/prisma-migrate.mjs",
        "scripts/cli/create-admin.ts",
        "scripts/cli/has-users.ts",
        "scripts/cli/prisma-runtime-preflight.ts",
    ];
    const missing = requiredPaths.filter((runtimePath) => !existsSync(resolve(serverRoot, runtimePath)));
    const migrationDir = resolve(serverRoot, "prisma", "migrations", "sqlite");
    if (missing.length === 0 && !await hasSqliteMigration(migrationDir)) {
        missing.push("prisma/migrations/sqlite/*/migration.sql");
    }
    if (missing.length > 0) {
        throw new Error([
            "Nitro product output is missing required runtime files.",
            "Missing:",
            ...missing.map((runtimePath) => `- .output/server/${runtimePath}`),
        ].join("\n"));
    }
}

/**
 * 确认 SQLite migration 目录里至少有一个可执行 migration.sql。
 */
async function hasSqliteMigration(migrationDir) {
    const entries = await readdir(migrationDir, {withFileTypes: true}).catch(() => []);
    return entries.some((entry) => entry.isDirectory() && existsSync(resolve(migrationDir, entry.name, "migration.sql")));
}

/**
 * Nitro 的部分 server chunks 会生成 `file:///_entry.js` 作为 import.meta fallback。
 * 这个 URL 在 Windows 下不是合法绝对 file URL。这里把它改成从当前 chunk
 * 指回 `.output/server/index.mjs` 的合法 URL，同时保留 server root 语义。
 */
async function patchImportMetaFallbacks(root) {
    let count = 0;
    for (const filePath of await listMjsFiles(root)) {
        const text = await readFile(filePath, "utf8");
        if (!text.includes(illegalImportMetaFallback)) {
            continue;
        }
        const entrySpecifier = relative(dirname(filePath), resolve(serverRoot, "index.mjs")).replaceAll("\\", "/");
        const normalizedSpecifier = entrySpecifier.startsWith(".") ? entrySpecifier : `./${entrySpecifier}`;
        const next = text.replaceAll(
            importMetaFallbackShape,
            `{url:new URL(${JSON.stringify(normalizedSpecifier)},import.meta.url).href,env:process.env}`,
        );
        if (next !== text) {
            await writeFile(filePath, next, "utf8");
            count += 1;
        }
    }
    return count;
}

/**
 * 把 Windows runtime 兼容修复变成构建门禁：如果 Nitro 改了产物格式，
 * 导致上面的精确替换失效，构建应直接失败，避免 release zip 带着已知坏产物。
 */
async function assertNoIllegalImportMetaFallbacks(root) {
    const offenders = [];
    for (const filePath of await listMjsFiles(root)) {
        const text = await readFile(filePath, "utf8");
        if (text.includes(illegalImportMetaFallback)) {
            offenders.push(relative(process.cwd(), filePath).replaceAll("\\", "/"));
        }
    }
    if (offenders.length > 0) {
        throw new Error([
            "Nitro build output still contains Windows-invalid import.meta fallback.",
            `Fallback: ${illegalImportMetaFallback}`,
            "Files:",
            ...offenders.map((filePath) => `- ${filePath}`),
        ].join("\n"));
    }
}

/**
 * `externals.trace=false` 会让 Nitro 把 external 包写成开发机根 node_modules
 * 的绝对 file URL。产品包不能依赖构建机路径，这里统一改为指向
 * `.output/server/node_modules` 的相对 import。
 */
async function patchExternalFileUrls(root) {
    let count = 0;
    for (const filePath of await listMjsFiles(root)) {
        const text = await readFile(filePath, "utf8");
        if (!sourceNodeModulesFileUrlVariants.some((prefix) => text.includes(prefix))) {
            continue;
        }
        const replacementBase = relative(dirname(filePath), resolve(serverRoot, "node_modules")).replaceAll("\\", "/");
        const normalizedBase = replacementBase.startsWith(".") ? replacementBase : `./${replacementBase}`;
        let next = text;
        for (const prefix of sourceNodeModulesFileUrlVariants) {
            next = next.replaceAll(prefix, `${normalizedBase}/`);
        }
        if (next !== text) {
            await writeFile(filePath, next, "utf8");
            count += 1;
        }
    }
    return count;
}

/**
 * 防止 product 产物继续引用开发机源码根 node_modules。
 */
async function assertNoRepoNodeModuleFileUrls(root) {
    const offenders = [];
    for (const filePath of await listMjsFiles(root)) {
        const text = await readFile(filePath, "utf8");
        if (sourceNodeModulesFileUrlVariants.some((prefix) => text.includes(prefix))) {
            offenders.push(relative(process.cwd(), filePath).replaceAll("\\", "/"));
        }
    }
    if (offenders.length > 0) {
        throw new Error([
            "Nitro build output still references source-root node_modules file URLs.",
            `Prefixes: ${sourceNodeModulesFileUrlVariants.join(", ")}`,
            "Files:",
            ...offenders.map((filePath) => `- ${filePath}`),
        ].join("\n"));
    }
}

/**
 * 写入 Product `.output` 运行 manifest，供 GHCR / 通用 runner 读取版本。
 */
async function writeProductPackageJson() {
    const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
    await writeFile(resolve(serverRoot, "package.json"), `${JSON.stringify({
        name: "neuro-book-output",
        version: packageJson.version ?? "0.0.0",
        description: packageJson.description,
        license: packageJson.license,
        repository: packageJson.repository,
        private: true,
        type: "module",
    }, null, 4)}\n`, "utf8");
}

/**
 * 为 product 内源码脚本提供 `nbook/*` 解析入口。
 * 这里复制一个真实的本地包目录，并把应用源码根打包进去，
 * 这样 `.output/server/scripts/**`、worker 和 CLI 都不用回退到仓库根。
 */
async function copyNbookRuntimePackage() {
    const packageRoot = resolve(serverRoot, "node_modules", "nbook");
    await rm(packageRoot, {recursive: true, force: true});
    await mkdir(packageRoot, {recursive: true});
    await writeFile(resolve(packageRoot, "package.json"), `${JSON.stringify({
        name: "nbook",
        version: JSON.parse(await readFile(resolve("package.json"), "utf8")).version ?? "0.0.0",
        private: true,
        type: "module",
    }, null, 4)}\n`, "utf8");
    await copyDirectory(resolve("server"), resolve(packageRoot, "server"));
    await copyDirectory(resolve("shared"), resolve(packageRoot, "shared"));
    await copyDirectory(resolve("app"), resolve(packageRoot, "app"));
    await copyDirectory(resolve("world-engine"), resolve(packageRoot, "world-engine"));
}

function assertNbookRuntimePackage(packageRoot) {
    const requiredPaths = [
        resolve(packageRoot, "world-engine", "schema", "index.ts"),
        resolve(packageRoot, "server", "generated", "prisma", "client.ts"),
    ];
    const missing = requiredPaths.filter((path) => !existsSync(path));
    if (missing.length > 0) {
        throw new Error([
            "Product nbook runtime package 缺少必要运行文件：",
            ...missing.map((path) => `- ${path}`),
        ].join("\n"));
    }
}

/**
 * 把 Agent-facing workspace CLI 复制到 `.output/server` 内，方便产品包
 * 从 `.output/server/node_modules` 解析 runtime vendor。
 */
async function copyWorkspaceCliRuntimeScript() {
    const source = resolve("assets", "workspace", ".nbook", "agent", "scripts", "workspace.ts");
    const target = resolve(serverRoot, "scripts", "agent", "workspace.ts");
    if (!existsSync(source)) {
        throw new Error("缺少 Agent workspace CLI: assets/workspace/.nbook/agent/scripts/workspace.ts");
    }
    await rm(target, {recursive: true, force: true});
    await mkdir(dirname(target), {recursive: true});
    await copyDirectory(source, target);
}

/**
 * 复制一组 runtime 入口包及其 runtime dependencies 闭包。
 */
async function copyRuntimePackageClosure(seedPackages) {
    const queue = seedPackages.map((packageName) => ({packageName, source: null, parentPackageName: null}));
    const requiredPackages = new Set(seedPackages);
    const seen = new Set();
    while (queue.length > 0) {
        const next = queue.shift();
        if (!next) {
            continue;
        }
        const {packageName, source: resolvedSource, parentPackageName} = next;
        if (!packageName || seen.has(packageName)) {
            continue;
        }
        seen.add(packageName);
        const source = resolvedSource ?? await resolveRuntimePackage(packageName);
        if (!source) {
            const parent = parentPackageName ? ` (required by ${parentPackageName})` : "";
            throw new Error(`Missing Nitro runtime package: ${packageName}${parent}`);
        }
        const target = resolve(outputRoot, "server", "node_modules", ...packageName.split("/"));
        if (!existsSync(source)) {
            if (requiredPackages.has(packageName)) {
                throw new Error(`缺少 Nitro runtime package: ${packageName}`);
            }
            continue;
        }
        if (await isRuntimePackageCurrent(source, target)) {
            packageCopyStats.skipped += 1;
        } else {
            await rm(target, {recursive: true, force: true});
            await mkdir(dirname(target), {recursive: true});
            await copyDirectory(source, target);
            packageCopyStats.copied += 1;
        }

        const packageJsonPath = resolve(source, "package.json");
        if (!existsSync(packageJsonPath)) {
            continue;
        }
        const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
        const dependencies = packageJson.dependencies ?? {};
        for (const dependencyName of Object.keys(dependencies)) {
            if (!seen.has(dependencyName)) {
                queue.push({
                    packageName: dependencyName,
                    source: await resolveRuntimePackage(dependencyName, source),
                    parentPackageName: packageName,
                });
            }
        }
        const optionalDependencies = packageJson.optionalDependencies ?? {};
        for (const dependencyName of Object.keys(optionalDependencies)) {
            const dependencySource = await resolveRuntimePackage(dependencyName, source);
            if (!seen.has(dependencyName) && dependencySource) {
                queue.push({
                    packageName: dependencyName,
                    source: dependencySource,
                    parentPackageName: packageName,
                });
            }
        }
    }
}

/**
 * 物化 Nitro 产物引用的 Bun store 包，并为每个包保留独立的依赖闭包。
 * 不能按包名扁平化，因为同名依赖在不同 Bun store 中可能使用不同版本。
 */
async function copyBunStoreRuntimeClosure(seeds) {
    const queue = [...seeds];
    const seen = new Set();
    while (queue.length > 0) {
        const seed = queue.shift();
        if (!seed || seen.has(seed.target)) {
            continue;
        }
        seen.add(seed.target);
        if (!existsSync(seed.source)) {
            throw new Error(`Missing Bun store runtime package source: ${seed.source}`);
        }
        if (await isRuntimePackageCurrent(seed.source, seed.target)) {
            packageCopyStats.skipped += 1;
        } else {
            await copyRuntimePackageFiles(seed.source, seed.target);
            packageCopyStats.copied += 1;
        }

        const packageJsonPath = resolve(seed.source, "package.json");
        if (!existsSync(packageJsonPath)) {
            continue;
        }
        const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
        const dependencies = packageJson.dependencies ?? {};
        for (const dependencyName of Object.keys(dependencies)) {
            const dependencySource = await resolveRuntimePackage(dependencyName, seed.source);
            if (!dependencySource) {
                throw new Error(`Missing Bun store dependency: ${dependencyName} (required by ${packageJson.name})`);
            }
            queue.push({
                source: dependencySource,
                target: resolve(seed.storeNodeModules, ...dependencyName.split("/")),
                storeNodeModules: seed.storeNodeModules,
            });
        }

        const optionalDependencies = packageJson.optionalDependencies ?? {};
        const peerDependencies = packageJson.peerDependencies ?? {};
        for (const dependencyName of new Set([
            ...Object.keys(optionalDependencies),
            ...Object.keys(peerDependencies),
        ])) {
            const dependencySource = await resolveRuntimePackage(dependencyName, seed.source);
            if (dependencySource) {
                queue.push({
                    source: dependencySource,
                    target: resolve(seed.storeNodeModules, ...dependencyName.split("/")),
                    storeNodeModules: seed.storeNodeModules,
                });
            }
        }
    }
}

/**
 * 收集 Nitro 输出中真实执行的 Bun store 模块说明符，并映射到产品内同位置的 vendor 目录。
 */
async function collectBunStoreRuntimeSeeds(root) {
    const seeds = new Map();
    // 跳过 assets：profile artifacts 是 esbuild bundle，`node_modules/.bun/...` 是 module ID
    // 字符串而非真实 import，bundle 已内联依赖代码，不需要外部 store 文件。
    for (const filePath of await listMjsFiles(root, {skipNodeModules: true, skipPrecomputed: true, skipAssets: true})) {
        const text = await readFile(filePath, "utf8");
        for (const match of text.matchAll(bunStoreModuleSpecifierPattern)) {
            const [, , _specifier, storeKey, packageName] = match;
            const source = resolve("node_modules", ".bun", storeKey, "node_modules", ...packageName.split("/"));
            if (!existsSync(source)) {
                throw new Error(`Nitro build output references missing Bun store package: ${packageName} (${storeKey})`);
            }
            const target = resolve(serverRoot, "node_modules", ".bun", storeKey, "node_modules", ...packageName.split("/"));
            seeds.set(target, {
                source,
                target,
                storeNodeModules: resolve(serverRoot, "node_modules", ".bun", storeKey, "node_modules"),
            });
        }
    }
    return [...seeds.values()];
}

/**
 * 构建门禁：每一个 Bun store 模块说明符都必须能在产品目录内解析到真实文件。
 */
async function assertBunStoreRuntimeImports(root) {
    const missing = [];
    // 跳过 assets：profile artifacts 的 Bun store 路径是 esbuild module ID，非真实 import。
    for (const filePath of await listMjsFiles(root, {skipNodeModules: true, skipPrecomputed: true, skipAssets: true})) {
        const text = await readFile(filePath, "utf8");
        for (const match of text.matchAll(bunStoreModuleSpecifierPattern)) {
            const specifier = match[2];
            if (!existsSync(resolve(dirname(filePath), specifier))) {
                missing.push(`${relative(process.cwd(), filePath).replaceAll("\\", "/")}: ${specifier}`);
            }
        }
    }
    if (missing.length > 0) {
        throw new Error([
            "Nitro build output contains unresolved Bun store imports.",
            "Imports:",
            ...missing.map((item) => `- ${item}`),
        ].join("\n"));
    }
}

/**
 * 按 Node 的模块解析规则定位运行时包。Bun 的隔离安装会把传递依赖放在
 * `.bun/<package>/node_modules` 中，因此不能只从项目根 `node_modules` 查找。
 */
async function resolveRuntimePackage(packageName, importerSource = null) {
    if (!importerSource) {
        const packageRoot = resolve("node_modules", ...packageName.split("/"));
        return existsSync(packageRoot) ? packageRoot : null;
    }

    // Bun 的扁平入口通常是 junction；先沿未解析的导入路径查找，才能命中其隔离依赖树。
    const directDependency = resolve(importerSource, "node_modules", ...packageName.split("/"));
    if (existsSync(directDependency)) {
        return await realpath(directDependency);
    }

    const importerManifest = resolve(importerSource, "package.json");
    if (!existsSync(importerManifest)) {
        return null;
    }
    let current = dirname(await realpath(importerManifest));
    while (dirname(current) !== current) {
        const candidate = resolve(current, "node_modules", ...packageName.split("/"));
        if (existsSync(candidate)) {
            return await realpath(candidate);
        }
        // Bun 隔离安装的扁平 store 布局：<store>/node_modules/<所有包平铺>。
        // 当向上查找到达本身就是 node_modules 的目录层时，标准 Node 解析会查
        // <store>/node_modules/node_modules/<pkg>（不存在），遗漏 store 内的平铺依赖。
        // 这里补查 <current>/<pkg>，命中 Bun store 内部的兄弟包。
        if (current.endsWith("node_modules")) {
            const flatCandidate = resolve(current, ...packageName.split("/"));
            if (existsSync(flatCandidate)) {
                return await realpath(flatCandidate);
            }
        }
        current = dirname(current);
    }
    return null;
}

/**
 * 从 Nitro 产物里收集已 external 成 `node_modules/<pkg>` 的包。
 * `externals.trace=false` 不再自动写 `.output/server/package.json`，
 * 因此 Product Runtime vendor 需要以产物 import 为准补齐。
 */
async function collectNitroExternalPackageSeeds(root) {
    if (!existsSync(root)) {
        return [];
    }
    const packages = new Set();
    // 只收集 Nitro chunks 中的扁平 external 引用 `node_modules/<pkg>`。
    // 跳过 `assets/` 目录：profile artifacts 是 esbuild bundle，其中的
    // `node_modules/<pkg>` 是 module ID 字符串而非真实 import，传递依赖只在
    // Bun store 中存在（项目根 node_modules 没有），误当 seed 会导致解析失败。
    // profile artifacts 的 Bun store 引用由 copyBunStoreRuntimeClosure 负责。
    const importPattern = /["'](?:\.\.\/|\.\/)*node_modules\/(?!\.bun\/)([^"'\/]+)(?:\/([^"'\/]+))?/g;
    for (const filePath of await listMjsFiles(root, {skipAssets: true})) {
        const text = await readFile(filePath, "utf8");
        for (const match of text.matchAll(importPattern)) {
            const packageName = match[1].startsWith("@") ? `${match[1]}/${match[2]}` : match[1];
            if (isPackageSeed(packageName)) {
                packages.add(packageName);
            }
        }
    }
    return [...packages].sort();
}

/**
 * 过滤 source map / helper path 中类似 `.pnpm`、`.virtual`、`package.json` 的非包路径。
 */
function isPackageSeed(packageName) {
    return Boolean(
        packageName
        && !packageName.endsWith("/undefined")
        && !packageName.startsWith(".")
        && packageName !== "package.json",
    );
}

/**
 * 已复制过且 package manifest 完全一致时跳过整包复制。
 * Product vendor 主要来自已安装依赖；包升级或重装会改变 package.json，
 * 从而触发重新复制。
 */
async function isRuntimePackageCurrent(source, target) {
    const sourcePackageJsonPath = resolve(source, "package.json");
    const targetPackageJsonPath = resolve(target, "package.json");
    if (!existsSync(sourcePackageJsonPath) || !existsSync(targetPackageJsonPath)) {
        return false;
    }
    const [sourcePackageJson, targetPackageJson] = await Promise.all([
        readFile(sourcePackageJsonPath, "utf8"),
        readFile(targetPackageJsonPath, "utf8"),
    ]);
    return sourcePackageJson === targetPackageJson;
}

/**
 * Windows 下大量小文件目录复制用 robocopy 通常快于 Node `fs.cp`。
 * 其他平台保持 Node 原生复制，避免引入额外系统依赖。
 */
async function copyDirectory(source, target) {
    const sourceStat = await stat(source);
    if (!sourceStat.isDirectory() || process.platform !== "win32") {
        await cp(source, target, {recursive: true});
        return;
    }
    await mkdir(target, {recursive: true});
    await runRobocopy(source, target);
}

/**
 * 复制一个 runtime 包本体。依赖由调用方在所属 Bun store 的共享 node_modules 中物化，
 * 不能跟随复制包内 node_modules，否则会重复展开依赖树。
 */
async function copyRuntimePackageFiles(source, target) {
    await rm(target, {recursive: true, force: true});
    await mkdir(dirname(target), {recursive: true});
    const sourceStat = await stat(source);
    if (sourceStat.isDirectory() && process.platform === "win32") {
        await runRobocopy(source, target, {excludeNodeModules: true});
        return;
    }
    await cp(source, target, {
        recursive: true,
        filter: (sourcePath) => sourcePath !== resolve(source, "node_modules"),
    });
}

/**
 * 运行 robocopy。robocopy 的 0-7 都表示成功或完成复制，8+ 才是失败。
 */
async function runRobocopy(source, target, {excludeNodeModules = false} = {}) {
    await new Promise((resolvePromise, rejectPromise) => {
        const args = [
            source,
            target,
            "/MIR",
            "/NFL",
            "/NDL",
            "/NJH",
            "/NJS",
            "/NP",
        ];
        if (excludeNodeModules) {
            args.push("/XD", "node_modules");
        }
        const child = spawn("robocopy", args, {
            stdio: ["ignore", "ignore", "pipe"],
            shell: false,
            windowsHide: true,
        });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", rejectPromise);
        child.on("close", (code) => {
            if (code !== null && code <= 7) {
                resolvePromise();
                return;
            }
            rejectPromise(new Error(`robocopy failed with exit code ${code}: ${stderr.trim()}`));
        });
    });
}

/**
 * 列出指定目录下的 ESM 文件。
 * skipNodeModules：跳过 node_modules 目录，避免扫描 vendor 后的运行时依赖本身。
 * skipAssets：跳过 assets 目录，避免扫描 profile artifacts（module ID 含 node_modules/<pkg> 字符串，非真实 import）。
 * skipPrecomputed：跳过 Nuxt client.precomputed.mjs，它是 preload 数据映射，内部
 *   `../node_modules/.bun/...` 路径是对象 key 而非 import，runtime 不 require 它们。
 */
async function listMjsFiles(root, {skipNodeModules = false, skipAssets = false, skipPrecomputed = false} = {}) {
    const result = [];
    for (const entry of await readdir(root, {withFileTypes: true})) {
        const filePath = resolve(root, entry.name);
        if (entry.isDirectory()) {
            if (skipNodeModules && entry.name === "node_modules") {
                continue;
            }
            if (skipAssets && entry.name === "assets") {
                continue;
            }
            result.push(...await listMjsFiles(filePath, {skipNodeModules, skipAssets, skipPrecomputed}));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".mjs")) {
            if (skipPrecomputed && entry.name === "client.precomputed.mjs") {
                continue;
            }
            result.push(filePath);
        }
    }
    return result;
}
