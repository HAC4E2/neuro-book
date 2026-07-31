import {mkdir, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {afterEach, describe, expect, it} from "vitest";
import {
    resolveRuntimeArtifactCompilerContext,
    resolveRuntimeArtifactNbookPath,
} from "nbook/server/utils/runtime-artifact-compiler-context";

describe("runtime artifact compiler context", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("Product build只使用Authoring Kit编译上下文，artifact require继续指向Product runtime", async () => {
        const root = resolve(".agent", "workspace", "artifact-context-test", randomUUID());
        roots.push(root);
        const outputRoot = join(root, ".output", "server");
        const authoringRoot = join(outputRoot, "authoring");
        const outputNbookFile = join(authoringRoot, "nbook", "server", "marker.ts");
        await mkdir(join(root, "node_modules"), {recursive: true});
        await mkdir(join(authoringRoot, "nbook", "server"), {recursive: true});
        await writeFile(join(root, "package.json"), '{"name":"neuro-book"}\n', "utf8");
        await writeFile(join(root, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(outputRoot, "package.json"), '{"name":"neuro-book-output"}\n', "utf8");
        await writeFile(join(outputRoot, "index.mjs"), "", "utf8");
        await mkdir(join(authoringRoot, "node_modules", "typebox"), {recursive: true});
        await writeFile(join(authoringRoot, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(authoringRoot, "package.json"), '{"name":"@notnotype/neuro-book-profile-authoring-kit"}\n', "utf8");
        await writeFile(outputNbookFile, "export const marker = true;\n", "utf8");

        const context = resolveRuntimeArtifactCompilerContext(root, {NEURO_BOOK_PRODUCT_BUILD: "1"});

        expect(context).toEqual(expect.objectContaining({
            productRuntime: true,
            nbookRoot: join(authoringRoot, "nbook"),
            compilerPackageRoot: join(authoringRoot, "package.json"),
            compilerNodeModulesRoot: join(authoringRoot, "node_modules"),
            artifactRuntimeRequireRoot: join(outputRoot, "index.mjs"),
            tsconfigPath: join(authoringRoot, "tsconfig.json"),
        }));
        expect(resolveRuntimeArtifactNbookPath(context, "server/marker")).toBe(outputNbookFile);
    });

    it("Product缺少自包含tsconfig时拒绝回退Source根", async () => {
        const root = resolve(".agent", "workspace", "artifact-context-missing-test", randomUUID());
        roots.push(root);
        const outputRoot = join(root, ".output", "server");
        await mkdir(outputRoot, {recursive: true});
        await writeFile(join(root, "package.json"), '{"name":"neuro-book-product"}\n', "utf8");
        await writeFile(join(root, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(outputRoot, "index.mjs"), "", "utf8");

        expect(() => resolveRuntimeArtifactCompilerContext(root)).toThrow("Product runtime 缺少自包含 Authoring Kit");
    });
});
