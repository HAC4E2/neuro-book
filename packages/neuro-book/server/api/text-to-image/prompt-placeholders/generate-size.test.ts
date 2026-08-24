import {describe, expect, it} from "vitest";
import {parseTextToImageSize} from "nbook/server/api/text-to-image/prompt-placeholders/[id]/generate.post";

describe("parseTextToImageSize", () => {
    it("accepts x, X, multiplication signs and multiple candidates", () => {
        expect(parseTextToImageSize("尺寸：832 x 1216；最后使用 1024X1024")).toEqual({
            width: 1024,
            height: 1024,
        });
        expect(parseTextToImageSize("1216 × 832")).toEqual({width: 1216, height: 832});
    });

    it("ignores out-of-range candidates and falls back to recipe dimensions", () => {
        expect(parseTextToImageSize("32x32, 8192x8192")).toEqual({});
    });
});
