import {beforeEach, describe, expect, it, vi} from "vitest";

describe("PATCH /api/novels/[novelId]/plot/threads/[threadId]", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it("只负责校验输入并委托给 plotFacade", async () => {
        const updateStoryThread = vi.fn(async () => ({id: "9"}));
        const body = {title: "更新标题"};

        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            requireNovelId: vi.fn(() => 7),
            validateBody: vi.fn(async () => body),
        }));
        vi.doMock("nbook/server/plot", () => ({
            plotFacade: {
                updateStoryThread,
            },
            requireStoryThreadId: vi.fn(() => 8),
        }));

        const handler = (await import("nbook/server/api/novels/[novelId]/plot/threads/[threadId].patch")).default;
        const result = await handler({} as never);

        expect(updateStoryThread).toHaveBeenCalledWith(7, 8, body);
        expect(result).toEqual({id: "9"});
    });
});
