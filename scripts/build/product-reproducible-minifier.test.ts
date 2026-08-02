import {readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";

import {minifyProductJavaScript} from "nbook/scripts/build/product-reproducible-minifier";

describe("Product reproducible minifier", () => {
    it("相同 ESM 输入产生逐字节一致的小型输出", async () => {
        const source = [
            "const deliberatelyLongIdentifier = 40;",
            "const anotherLongIdentifier = 2;",
            "export const answer = deliberatelyLongIdentifier + anotherLongIdentifier;",
            "",
        ].join("\n");

        const [left, right] = await Promise.all([
            minifyProductJavaScript(source, "fixture.mjs"),
            minifyProductJavaScript(source, "fixture.mjs"),
        ]);

        expect(left).toBe(right);
        expect(Buffer.byteLength(left)).toBeLessThan(Buffer.byteLength(source));
        expect(left).toContain("export");
    });

    it("正式 Product builders 不再调用 Bun identifier minifier", async () => {
        const builders = [
            "scripts/build/product-runtime-bundle.ts",
            "scripts/build/product-command-bundle.ts",
            "scripts/build/product-authoring-kit.ts",
            "scripts/build/product-authoring-type-projection.ts",
        ];

        for (const builder of builders) {
            const source = await readFile(builder, "utf8");
            expect(source, builder).not.toContain("minify: true");
            expect(source, builder).toContain("minifyProductJavaScript");
        }
    });
});
