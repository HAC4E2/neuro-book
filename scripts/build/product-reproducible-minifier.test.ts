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
});
