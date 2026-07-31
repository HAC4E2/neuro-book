import {existsSync} from "node:fs";
import {cp, mkdir, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {dirname, extname, relative, resolve} from "node:path";
import ts from "typescript";
import {productRuntimeCompatibilityPlugin} from "nbook/scripts/build/product-bundle-plugins";
import {productRuntimeIslandPackageNames} from "nbook/scripts/build/product-runtime-islands";
import {
    projectAuthoringDependencies,
    type AuthoringDependencyRegistration,
    type ProjectedAuthoringDependency,
} from "nbook/scripts/build/product-authoring-type-projection";

export type ProductAuthoringKitResult = {
    compilerBytes: number;
    sdkBytes: number;
    typeBytes: number;
    typeFiles: number;
    dependencies: ProductAuthoringDependency[];
};

export type ProductAuthoringDependency = ProjectedAuthoringDependency;

const AUTHORING_DEPENDENCY_SCHEMA = "nbook.product-authoring-dependencies/v2";
const AUTHORING_DEPENDENCIES = [
    {
        name: "typebox",
        kind: "runtime",
        purpose: "Profile 源码公开使用 Type 构造 schema，运行时 esbuild 需要读取实现与声明。",
        smoke: "compile and import a Profile that uses Type.Object",
    },
    {
        name: "@types/node",
        kind: "types",
        purpose: "Profile SDK 声明引用 Node 类型。",
        smoke: "typecheck Profile SDK declarations",
    },
    {
        name: "undici-types",
        kind: "types",
        purpose: "@types/node 的 fetch 声明引用 undici-types。",
        smoke: "resolve Node fetch declarations",
    },
    {
        name: "@earendil-works/pi-agent-core",
        kind: "types",
        purpose: "Profile 公开上下文复用 Agent message 与 tool 类型。",
        smoke: "typecheck Profile SDK Agent message declarations",
    },
    {
        name: "@earendil-works/pi-ai",
        kind: "types",
        purpose: "Profile 公开上下文复用模型、消息与用量类型。",
        smoke: "typecheck Profile SDK model declarations",
    },
    {
        name: "@anthropic-ai/sdk",
        kind: "types",
        purpose: "PI Anthropic request options 的声明依赖。",
        smoke: "resolve PI Anthropic option declarations",
    },
    {
        name: "@google/genai",
        kind: "types",
        purpose: "PI Google request options 的声明依赖。",
        smoke: "resolve PI Google option declarations",
        optionalTypePeers: ["@modelcontextprotocol/sdk"],
    },
    {
        name: "google-auth-library",
        kind: "types",
        purpose: "Google GenAI Node auth 声明的直接类型依赖。",
        smoke: "resolve Google GenAI auth declarations",
    },
    {
        name: "gaxios",
        kind: "types",
        purpose: "Google Auth HTTP client 的声明依赖。",
        smoke: "resolve Google Auth HTTP declarations",
    },
    {
        name: "gcp-metadata",
        kind: "types",
        purpose: "Google Auth metadata client 的声明依赖。",
        smoke: "resolve Google Auth metadata declarations",
    },
    {
        name: "google-logging-utils",
        kind: "types",
        purpose: "Google Auth logger 的声明依赖。",
        smoke: "resolve Google Auth logging declarations",
    },
    {
        name: "openai",
        kind: "types",
        purpose: "PI OpenAI request options 的声明依赖。",
        smoke: "resolve PI OpenAI option declarations",
    },
    {
        name: "@prisma/client",
        kind: "types",
        purpose: "Project session 与 World Engine 公开类型引用生成的 Prisma 类型。",
        smoke: "typecheck generated Project Prisma declarations",
    },
    {
        name: "@prisma/client-runtime-utils",
        kind: "types",
        purpose: "@prisma/client runtime declarations 的直接类型依赖。",
        smoke: "resolve Prisma runtime utility declarations",
    },
    {
        name: "zod",
        kind: "types",
        purpose: "Profile settings、DTO 与写作资源公开类型引用 Zod。",
        smoke: "typecheck Profile settings declarations",
    },
] as const satisfies readonly AuthoringDependencyRegistration[];

/**
 * 建立与 Product revision 绑定的 Profile Authoring Kit。
 *
 * worker 实现被 bundle 成一个 Bun 入口；SDK 保留源码与专用 tsconfig，供运行时
 * esbuild 编译用户 Profile。这里不复制完整 server/app/docs 或通用 node_modules。
 */
export async function buildProductAuthoringKit(outputRoot: string): Promise<ProductAuthoringKitResult> {
    const serverRoot = resolve(outputRoot, "server");
    const kitRoot = resolve(serverRoot, "authoring");
    const compilerPath = resolve(kitRoot, "profile-compile-worker.mjs");
    const sdkRoot = resolve(kitRoot, "nbook", "profile-sdk");
    const sdkSourceRoot = resolve(kitRoot, "sdk-source");
    const typeRoot = resolve(kitRoot, "types");
    await rm(kitRoot, {recursive: true, force: true});
    await mkdir(sdkRoot, {recursive: true});
    await mkdir(sdkSourceRoot, {recursive: true});

    const result = await Bun.build({
        entrypoints: [resolve("server", "agent", "profiles", "profile-compile-worker-entry.ts")],
        target: "bun",
        format: "esm",
        minify: true,
        sourcemap: "none",
        plugins: [productRuntimeCompatibilityPlugin()],
        external: [
            "bun",
            "bun:*",
            ...productRuntimeIslandPackageNames().flatMap((packageName) => [packageName, `${packageName}/*`]),
        ],
    });
    if (!result.success) {
        throw new Error([
            "Profile compiler bundle 失败：",
            ...result.logs.map((log) => log.message),
        ].join("\n"));
    }
    if (result.outputs.length !== 1) throw new Error("Profile compiler bundle 必须只产生一个入口。");
    await Bun.write(compilerPath, result.outputs[0]!);

    for (const fileName of ["index.ts", "jsx-runtime.ts", "jsx-dev-runtime.ts"]) {
        const source = resolve("profile-sdk", fileName);
        if (!existsSync(source)) throw new Error(`Profile SDK 缺少 ${fileName}`);
        await cp(source, resolve(sdkSourceRoot, fileName));
        const sdkBuild = await Bun.build({
            entrypoints: [source],
            target: "bun",
            format: "esm",
            minify: true,
            sourcemap: "none",
            external: ["bun", "bun:*"],
        });
        if (!sdkBuild.success) {
            throw new Error([
                `Profile SDK bundle 失败：${fileName}`,
                ...sdkBuild.logs.map((log) => log.message),
            ].join("\n"));
        }
        if (sdkBuild.outputs.length !== 1) throw new Error(`Profile SDK ${fileName} 必须只产生一个入口。`);
        await Bun.write(resolve(sdkRoot, fileName.replace(/\.ts$/u, ".mjs")), sdkBuild.outputs[0]!);
    }
    const declarationDependencies = await emitAuthoringTypes(typeRoot);
    assertDeclaredTypeDependencies(declarationDependencies);
    await cp(resolve("proper-lockfile.d.ts"), resolve(typeRoot, "proper-lockfile.d.ts"));
    const dependencyProjection = await projectAuthoringDependencies({
        seedSpecifiers: new Set([...declarationDependencies].filter((specifier) => specifier !== "proper-lockfile")),
        targetNodeModulesRoot: resolve(kitRoot, "node_modules"),
        registrations: AUTHORING_DEPENDENCIES,
        importerPath: resolve("profile-sdk", "index.ts"),
    });
    await writeFile(resolve(kitRoot, "tsconfig.json"), `${JSON.stringify({
        compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "Bundler",
            jsx: "react-jsx",
            jsxImportSource: "nbook/profile-sdk",
            strict: true,
            // Product 只保证批准依赖的公开声明可达；不为第三方 optional peer 伪造类型。
            skipLibCheck: true,
            baseUrl: ".",
            paths: {
                "nbook/profile-sdk": ["./types/profile-sdk/index.d.ts"],
                "nbook/profile-sdk/*": ["./types/profile-sdk/*"],
                "nbook/*": ["./types/*"],
                "#cache/*": ["./types/packages/file-snapshot-cache/src/*"],
                "proper-lockfile": ["./types/proper-lockfile.d.ts"],
            },
            typeRoots: ["./node_modules/@types"],
            types: ["node"],
        },
        include: ["./types/**/*.d.ts", "./types/**/*.d.mts", "./sdk-source/**/*.ts"],
    }, null, 4)}\n`, "utf8");
    await writeFile(resolve(kitRoot, "package.json"), `${JSON.stringify({
        name: "@notnotype/neuro-book-profile-authoring-kit",
        private: true,
        type: "module",
    }, null, 4)}\n`, "utf8");
    await writeFile(resolve(kitRoot, "authoring-dependencies.json"), `${JSON.stringify({
        schema: AUTHORING_DEPENDENCY_SCHEMA,
        dependencies: dependencyProjection.dependencies,
        instances: dependencyProjection.instances,
    }, null, 4)}\n`, "utf8");

    const typeInventory = await directoryInventory(typeRoot);
    const packageTypeInventory = await directoryInventory(resolve(kitRoot, "node_modules"));
    return {
        compilerBytes: (await stat(compilerPath)).size,
        sdkBytes: await sdkSize(sdkRoot) + await sdkSize(sdkSourceRoot),
        typeBytes: typeInventory.bytes + packageTypeInventory.bytes,
        typeFiles: typeInventory.files + packageTypeInventory.files,
        dependencies: dependencyProjection.dependencies,
    };
}

/**
 * 使用 TypeScript 声明 emitter 建立候选图，再从 SDK 三个公开入口精确投影可达声明。
 * `program.emit()` 会写出 Program 中所有源码；不能直接把那棵树当成 SDK 闭包。
 */
async function emitAuthoringTypes(typeRoot: string): Promise<Set<string>> {
    const root = resolve(".");
    const emittedRoot = resolve(dirname(typeRoot), ".types-emitted");
    await rm(emittedRoot, {recursive: true, force: true});
    await rm(typeRoot, {recursive: true, force: true});
    const options: ts.CompilerOptions = {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.ReactJSX,
        jsxImportSource: "nbook/profile-sdk",
        baseUrl: root,
        paths: {"nbook/*": ["./*"]},
        rootDir: root,
        outDir: emittedRoot,
        lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
        types: ["bun", "node"],
        skipLibCheck: true,
        noCheck: true,
        declaration: true,
        emitDeclarationOnly: true,
    };
    const roots = ["index.ts", "jsx-runtime.ts", "jsx-dev-runtime.ts"]
        .map((fileName) => resolve("profile-sdk", fileName));
    try {
        const program = ts.createProgram({rootNames: roots, options});
        const diagnostics = program.getSyntacticDiagnostics();
        if (diagnostics.length > 0) {
            throw new Error(ts.formatDiagnostics(diagnostics, {
                getCanonicalFileName: (fileName) => fileName,
                getCurrentDirectory: () => process.cwd(),
                getNewLine: () => "\n",
            }));
        }
        const emitted = program.emit();
        if (emitted.emitSkipped) throw new Error("Profile SDK declaration projection 没有完成。");
        return await copyReachableDeclarations(emittedRoot, typeRoot);
    } finally {
        await rm(emittedRoot, {recursive: true, force: true});
    }
}

/** 从声明入口沿静态 module specifier 复制闭包，并返回第三方类型依赖。 */
async function copyReachableDeclarations(emittedRoot: string, typeRoot: string): Promise<Set<string>> {
    const entryFiles = ["index.d.ts", "jsx-runtime.d.ts", "jsx-dev-runtime.d.ts"]
        .map((fileName) => resolve(emittedRoot, "profile-sdk", fileName));
    const queue = [...entryFiles];
    const visited = new Set<string>();
    const dependencies = new Set<string>();
    while (queue.length > 0) {
        const sourcePath = queue.shift()!;
        if (visited.has(sourcePath)) continue;
        visited.add(sourcePath);
        const emittedRelativePath = relative(emittedRoot, sourcePath);
        if (emittedRelativePath.startsWith("..") || extname(emittedRelativePath) === "") {
            throw new Error(`Authoring declaration 越出 emitter 根：${sourcePath}`);
        }
        const source = await readFile(sourcePath, "utf8");
        const normalizedSourceRoot = resolve(".").replaceAll("\\", "/");
        if (source.replaceAll("\\", "/").includes(normalizedSourceRoot)) {
            throw new Error(`Authoring declaration 泄漏构建机绝对路径：${emittedRelativePath}`);
        }
        const targetPath = resolve(typeRoot, emittedRelativePath);
        await mkdir(dirname(targetPath), {recursive: true});
        await cp(sourcePath, targetPath);

        for (const specifier of declarationModuleSpecifiers(sourcePath, source)) {
            const internalPath = resolveInternalDeclaration(emittedRoot, sourcePath, specifier);
            if (internalPath) {
                queue.push(internalPath);
                continue;
            }
            if (specifier.startsWith("nbook/") || specifier.startsWith(".") || specifier.startsWith("#cache/")) {
                throw new Error(`${emittedRelativePath} 引用了未投影声明：${specifier}`);
            }
            dependencies.add(specifier);
        }
    }
    return dependencies;
}

/** 使用 TypeScript AST 收集 import、re-export 与静态 import type 的 module specifier。 */
function declarationModuleSpecifiers(filePath: string, source: string): Set<string> {
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const specifiers = new Set<string>();
    const visit = (node: ts.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
            && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            specifiers.add(node.moduleSpecifier.text);
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
            && ts.isStringLiteral(node.argument.literal)) {
            specifiers.add(node.argument.literal.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return specifiers;
}

/** 解析 emitter 内的 nbook、相对路径和 file-snapshot-cache 私有 alias。 */
function resolveInternalDeclaration(emittedRoot: string, importer: string, specifier: string): string | null {
    let basePath: string;
    if (specifier.startsWith("nbook/")) {
        basePath = resolve(emittedRoot, specifier.slice("nbook/".length));
    } else if (specifier.startsWith("#cache/")) {
        basePath = resolve(emittedRoot, "packages", "file-snapshot-cache", "src", specifier.slice("#cache/".length));
    } else if (specifier.startsWith(".")) {
        basePath = resolve(dirname(importer), specifier);
    } else {
        return null;
    }
    const sourceExtension = /\.(?:tsx?|mts|cts|mjs|cjs|js)$/u.exec(basePath)?.[0];
    const extensionlessPath = sourceExtension ? basePath.slice(0, -sourceExtension.length) : basePath;
    const candidates = [
        `${extensionlessPath}.d.ts`,
        `${extensionlessPath}.d.mts`,
        `${extensionlessPath}.d.cts`,
        resolve(basePath, "index.d.ts"),
        resolve(basePath, "index.d.mts"),
        resolve(basePath, "index.d.cts"),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** 第三方声明只能来自显式登记的 Authoring type/runtime island。 */
function assertDeclaredTypeDependencies(specifiers: Set<string>): void {
    const allowedPackages = new Set(AUTHORING_DEPENDENCIES.map((dependency) => dependency.name));
    const unsupported = [...specifiers].filter((specifier) => {
        if (specifier.startsWith("node:")) return false;
        if (specifier === "proper-lockfile") return false;
        const segments = specifier.split("/");
        const packageName = specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0]!;
        return !allowedPackages.has(packageName);
    });
    if (unsupported.length > 0) {
        throw new Error(`Authoring declaration 含未登记第三方依赖：\n${unsupported.sort().map((name) => `- ${name}`).join("\n")}`);
    }
}

async function sdkSize(root: string): Promise<number> {
    const files = ["index.ts", "jsx-runtime.ts", "jsx-dev-runtime.ts", "index.mjs", "jsx-runtime.mjs", "jsx-dev-runtime.mjs"];
    let bytes = 0;
    for (const fileName of files) {
        const path = resolve(root, fileName);
        if (existsSync(path)) bytes += (await stat(path)).size;
    }
    return bytes;
}

/** 统计 Authoring Kit 的声明树，供 owner inventory 和构建日志使用。 */
async function directoryInventory(root: string): Promise<{files: number; bytes: number}> {
    let files = 0;
    let bytes = 0;
    const walk = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const filePath = resolve(directory, entry.name);
            if (entry.isDirectory()) await walk(filePath);
            else if (entry.isFile()) {
                files += 1;
                bytes += (await stat(filePath)).size;
            } else throw new Error(`Authoring Kit 含特殊文件：${filePath}`);
        }
    };
    await walk(root);
    return {files, bytes};
}

if (import.meta.main) {
    const outputRoot = resolve(process.env.NEURO_BOOK_OUTPUT_DIR ?? ".output");
    console.log(await buildProductAuthoringKit(outputRoot));
}
