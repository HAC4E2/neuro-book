import {beforeEach, describe, expect, it, vi} from "vitest";

describe("GET /api/novels/[novelId]/plot/story", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it("只负责读取参数并委托给 plotFacade", async () => {
        const getStoryDto = vi.fn(async () => ({id: "1"}));

        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            requireNovelId: vi.fn(() => 7),
        }));
        vi.doMock("nbook/server/plot", () => ({
            plotFacade: {
                getStoryDto,
            },
        }));

        const handler = (await import("nbook/server/api/novels/[novelId]/plot/story.get")).default;
        const result = await handler({} as never);

        expect(getStoryDto).toHaveBeenCalledWith(7);
        expect(result).toEqual({id: "1"});
    });
});
