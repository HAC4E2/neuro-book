import {execFile} from "node:child_process";
import {createRequire} from "node:module";
import {access, mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {pathToFileURL} from "node:url";
import {promisify} from "node:util";
import {afterEach, describe, expect, it} from "vitest";

import {currentProductPlatform} from "nbook/packages/neuro-book-manager/src/platform";
import {productOpaqueImportDefinitions} from "nbook/scripts/build/product-runtime-islands";

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Product Runtime bundle", () => {
    it("把 native 物理 URL 收敛到镜像内 package island，并清除 package manager metadata", async () => {
        const outputRoot = await mkdtemp(join(tmpdir(), "nbook-product-runtime-bundle-"));
        temporaryRoots.push(outputRoot);
        const serverRoot = join(outputRoot, "server");
        const scratchRoot = join(outputRoot, ".build-scratch");
        await mkdir(serverRoot, {recursive: true});
        const requireFromSource = createRequire(import.meta.url);
        const esbuildEntry = pathToFileURL(requireFromSource.resolve("esbuild")).href;
        const zodEntry = pathToFileURL(requireFromSource.resolve("zod")).href;
        const gaxiosEntry = pathToFileURL(requireFromSource.resolve("gaxios")).href;
        const chunkRoot = join(serverRoot, "chunks", "_");
        await Promise.all([
            mkdir(chunkRoot, {recursive: true}),
            mkdir(join(serverRoot, "commands"), {recursive: true}),
            mkdir(join(serverRoot, "authoring"), {recursive: true}),
        ]);
        await Promise.all([
            writeFile(join(serverRoot, "commands", "placeholder.mjs"), "export default true;\n", "utf8"),
            writeFile(join(serverRoot, "authoring", "placeholder.mjs"), "export default true;\n", "utf8"),
        ]);
        await writeFile(join(serverRoot, "index.mjs"), [
            'import {createRequire} from "node:module";',
            'import "./chunks/_/cfg.mjs";',
            `import esbuild from ${JSON.stringify(esbuildEntry)};`,
            `import zod from ${JSON.stringify(zodEntry)};`,
            `import * as zodAgain from ${JSON.stringify(zodEntry)};`,
            'import {JSDOM} from "jsdom";',
            `import {Gaxios} from ${JSON.stringify(gaxiosEntry)};`,
            'const metadata = "../node_modules/.bun/zod@4.3.6/node_modules/zod/index.js";',
            "export {metadata};",
            "export default [esbuild.transform, zod.string, zodAgain.string, JSDOM, globalThis.__tsVersion, Gaxios];",
        ].join("\n"), "utf8");
        await writeFile(join(chunkRoot, "cfg.mjs"), [
            'import {createRequire} from "node:module";',
            'globalThis._importMeta_ = globalThis._importMeta_ || {url:new URL("../../index.mjs", import.meta.url).href,env:process.env};',
            'const runtimeRequire = createRequire(globalThis._importMeta_.url);',
            'globalThis.__tsVersion = runtimeRequire("typescript").version;',
            'console.log(globalThis.__tsVersion);',
        ].join("\n"), "utf8");

        await execFileAsync("bun", ["scripts/build/product-runtime-bundle.ts"], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NEURO_BOOK_OUTPUT_DIR: outputRoot,
                NEURO_BOOK_PRODUCT_SCRATCH_ROOT: scratchRoot,
            },
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
        });
        const source = await readFile(join(serverRoot, "index.mjs"), "utf8");
        const islands = JSON.parse(await readFile(join(serverRoot, "native-islands.json"), "utf8")) as {
            schema: string;
            platform: string;
            islands: Array<{packages: string[]}>;
            opaqueImports: ReturnType<typeof productOpaqueImportDefinitions>;
        };

        expect(source).toContain("esbuild");
        expect(source).not.toContain(esbuildEntry);
        expect(source).not.toContain(zodEntry);
        expect(source).not.toContain(gaxiosEntry);
        expect(source).not.toContain("/.bun/");
        expect(source).not.toContain("/.pnpm/");
        expect(source).not.toContain("file:///_entry.js");
        expect(source).not.toContain('new URL("../../index.mjs"');
        expect(source).toContain("./node_modules/esbuild/lib/main.js");
        expect(source).toContain("./node_modules/jsdom/lib/api.js");
        expect(source).not.toContain('import("node-fetch")');
        expect(source).not.toContain("import('node-fetch')");
        expect(source).toContain("globalThis.fetch");
        expect(source).toContain("node_modules/zod/");
        expect(islands.platform).toBe(currentProductPlatform());
        expect(islands.schema).toBe("nbook.product-native-islands/v2");
        expect(islands.opaqueImports).toEqual(productOpaqueImportDefinitions());
        const islandPackages = islands.islands.flatMap((island) => island.packages);
        expect(islandPackages).toEqual(expect.arrayContaining(["jsdom", "typescript", "undici"]));
        await expect(access(join(serverRoot, "node_modules", "jsdom", "package.json"))).resolves.toBeUndefined();
        await expect(access(join(serverRoot, "node_modules", "typescript", "lib", "typescript.js"))).resolves.toBeUndefined();
        const executed = await execFileAsync("bun", ["--no-install", join(serverRoot, "index.mjs")], {
            cwd: outputRoot,
            env: {...process.env, NODE_PATH: ""},
            windowsHide: true,
        });
        expect(executed.stdout.trim()).toBe(requireFromSource("typescript").version);
        expect(dirname(requireFromSource.resolve("esbuild/package.json"))).not.toBe(serverRoot);
        await expect(access(join(scratchRoot, "runtime-bundle"))).rejects.toMatchObject({code: "ENOENT"});
    }, 60_000);

    it("拒绝候选镜像外的 runtime bundle scratch", async () => {
        const outputRoot = await mkdtemp(join(tmpdir(), "nbook-product-runtime-bundle-image-"));
        const scratchRoot = await mkdtemp(join(tmpdir(), "nbook-product-runtime-bundle-scratch-"));
        temporaryRoots.push(outputRoot, scratchRoot);
        await mkdir(join(outputRoot, "server"), {recursive: true});
        await writeFile(join(outputRoot, "server", "index.mjs"), "export default true;\n", "utf8");

        await expect(execFileAsync("bun", ["scripts/build/product-runtime-bundle.ts"], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NEURO_BOOK_OUTPUT_DIR: outputRoot,
                NEURO_BOOK_PRODUCT_SCRATCH_ROOT: scratchRoot,
            },
            windowsHide: true,
        })).rejects.toThrow("scratch 必须位于候选镜像内");
    });
});
