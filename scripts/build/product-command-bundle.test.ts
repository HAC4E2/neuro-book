import {resolve} from "node:path";
import {readFile, readdir} from "node:fs/promises";

import {describe, expect, it} from "vitest";
import {
    PRODUCT_COMMAND_SOURCES,
    resolveProductCommandEntries,
} from "nbook/scripts/build/product-command-bundle";

describe("Product command metafile", () => {
    it("按 entryPoint 建立入口，不依赖输出文件名", () => {
        const commandRoot = resolve(".agent", "workspace", "product-command-metafile", "commands");
        const metafile = buildMetafile(commandRoot);

        const entries = resolveProductCommandEntries(metafile, commandRoot);

        for (const [index, name] of Object.keys(PRODUCT_COMMAND_SOURCES).entries()) {
            expect(entries[name as keyof typeof PRODUCT_COMMAND_SOURCES])
                .toBe(`server/commands/mapped/entry-${index}.mjs`);
        }
    });

    it("按 commands outdir 解析 Bun 返回的相对 output key", () => {
        const commandRoot = resolve(".agent", "workspace", "product-command-metafile-relative", "commands");
        const metafile = buildMetafile(commandRoot, true);

        const entries = resolveProductCommandEntries(metafile, commandRoot);

        for (const [index, name] of Object.keys(PRODUCT_COMMAND_SOURCES).entries()) {
            expect(entries[name as keyof typeof PRODUCT_COMMAND_SOURCES])
                .toBe(`server/commands/mapped/entry-${index}.mjs`);
        }
    });

    it("拒绝 metafile entry output 逃逸 commands root", () => {
        const commandRoot = resolve(".agent", "workspace", "product-command-metafile", "commands");
        const metafile = buildMetafile(commandRoot);
        const [firstOutput, definition] = Object.entries(metafile.outputs)[0]!;
        delete metafile.outputs[firstOutput];
        metafile.outputs[resolve(commandRoot, "..", "escaped.mjs")] = definition;

        expect(() => resolveProductCommandEntries(metafile, commandRoot))
            .toThrow("Product command metafile output 逃逸 commands root");
    });

    it("拒绝相对 metafile output 通过上级目录逃逸", () => {
        const commandRoot = resolve(".agent", "workspace", "product-command-metafile-relative-escape", "commands");
        const metafile = buildMetafile(commandRoot, true);
        const [firstOutput, definition] = Object.entries(metafile.outputs)[0]!;
        delete metafile.outputs[firstOutput];
        metafile.outputs["../escaped.mjs"] = definition;

        expect(() => resolveProductCommandEntries(metafile, commandRoot))
            .toThrow("Product command metafile output 逃逸 commands root");
    });

    it("Product正式命令实现归server领域Module，server不得反向依赖scripts", async () => {
        const orchestrationOnly = new Set([
            "prepare-system-assets",
            "product-profile-authoring-smoke",
            "product-variable-authoring-smoke",
            "product-image-variant-smoke",
            "sqlite-vec-smoke",
        ]);
        for (const [id, source] of Object.entries(PRODUCT_COMMAND_SOURCES)) {
            if (orchestrationOnly.has(id)) continue;
            expect(source, id).toMatch(/^server\//u);
        }
        expect(PRODUCT_COMMAND_SOURCES["prepare-system-assets"])
            .toBe("server/runtime/prepare-system-assets-command.ts");

        const offenders: string[] = [];
        const files = await readdir("server", {recursive: true});
        for (const relativePath of files.filter((fileName) => /\.(?:ts|mjs)$/u.test(fileName))) {
            const fileName = resolve("server", relativePath);
            if ((await readFile(fileName, "utf8")).includes("nbook/scripts/")) offenders.push(fileName);
        }
        expect(offenders).toEqual([]);
    });

    it("Product bootstrap只依赖共享只读Verifier，不把Builder带入命令bundle", async () => {
        const [bootstrap, verifier, builder] = await Promise.all([
            readFile("server/runtime/product-command.ts", "utf8"),
            readFile("shared/product-runtime-image-verifier.ts", "utf8"),
            readFile("scripts/build/product-runtime-image-builder.ts", "utf8"),
        ]);

        expect(bootstrap).toContain('from "nbook/shared/product-runtime-image-verifier"');
        expect(verifier).not.toContain("product-runtime-image-builder");
        expect(verifier).not.toContain("proper-lockfile");
        expect(builder).toContain('from "nbook/shared/product-runtime-image-verifier"');
        expect(builder).toContain("new ProductRuntimeImageVerifier().openVerified");
    });
});

/** 为每个命令建立文件名与 source 名完全无关的最小 Bun metafile。 */
function buildMetafile(commandRoot: string, relativeOutput = false): Bun.BuildMetafile {
    return {
        inputs: {},
        outputs: Object.fromEntries(Object.entries(PRODUCT_COMMAND_SOURCES).map(([, source], index) => [
            relativeOutput ? `./mapped/entry-${index}.mjs` : resolve(commandRoot, "mapped", `entry-${index}.mjs`),
            {
                bytes: 1,
                inputs: {},
                imports: [],
                exports: [],
                entryPoint: resolve(source),
            },
        ])),
    };
}
