import {describe, expect, it} from "vitest";
import {StoryPlotKindSchema} from "nbook/shared/dto/plot.dto";

describe("StoryPlotKindSchema", () => {
    it("支持低谷与释放节奏类型", () => {
        expect(StoryPlotKindSchema.safeParse("despair").success).toBe(true);
        expect(StoryPlotKindSchema.safeParse("relief").success).toBe(true);
    });
});
