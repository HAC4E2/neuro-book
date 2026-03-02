import {OrderService} from "nbook/server/plot/services/order.service";
import type {
    PlotRepository,
    SceneRepository,
    StoryRepository,
    ThreadRepository,
} from "nbook/server/plot/contracts/plot-repositories";
import {describe, expect, it} from "vitest";

describe("OrderService", () => {
    it("会校验 Scene 在线程 bucket 内的连续排序", () => {
        const service = new OrderService(
            {} as StoryRepository,
            {} as ThreadRepository,
            {} as SceneRepository,
            {} as PlotRepository,
        );

        expect(() => service.validateSceneReorderItems(
            [1, 2],
            [10],
            [
                {sceneId: 1, threadId: 10, chapterPath: "manuscript/001/", threadSortOrder: 0, chapterSortOrder: 0},
                {sceneId: 2, threadId: 10, chapterPath: "manuscript/001/", threadSortOrder: 2, chapterSortOrder: 1},
            ],
        )).toThrowError("剧情线程 10 下的 Scene排序必须从 0 开始连续递增");
    });

    it("会校验未挂章节的 Scene 不能提供 chapterSortOrder", () => {
        const service = new OrderService(
            {} as StoryRepository,
            {} as ThreadRepository,
            {} as SceneRepository,
            {} as PlotRepository,
        );

        expect(() => service.validateSceneReorderItems(
            [1],
            [10],
            [
                {sceneId: 1, threadId: 10, chapterPath: null, threadSortOrder: 0, chapterSortOrder: 0},
            ],
        )).toThrowError("未挂入章节的 Scene 不能提供 chapterSortOrder");
    });
});
