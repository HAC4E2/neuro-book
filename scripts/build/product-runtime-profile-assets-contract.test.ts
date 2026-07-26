import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";

describe("Product runtime Profile assets contract", () => {
    it("校验与清理 Nitro Product 内实际编译的系统 Profile 产物", async () => {
        const source = await readFile(resolve("scripts", "deploy", "product-runtime.mjs"), "utf8");

        expect(source).toContain([
            "const PRODUCT_PROFILE_COMPILED_ROOT = resolve(",
            "    PRODUCT_ROOT,",
            '    ".output",',
            '    "server",',
            '    "assets",',
            '    "workspace",',
            '    ".nbook",',
            '    "agent",',
            '    "profiles",',
            '    ".compiled",',
            ");",
        ].join("\n"));
        expect(source.match(/const compiledRoot = PRODUCT_PROFILE_COMPILED_ROOT;/gu)).toHaveLength(2);
        expect(source).not.toContain('resolve(PRODUCT_ROOT, "assets", "workspace", ".nbook", "agent", "profiles", ".compiled")');
    });
});
