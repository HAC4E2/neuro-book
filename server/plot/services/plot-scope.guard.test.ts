import fs from "node:fs/promises";
import path from "node:path";
import type {
    PlotLookupRepository,
    PlotRepository,
    SceneRepository,
    StoryRepository,
    ThreadRepository,
} from "nbook/server/plot/contracts/plot-repositories";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {afterEach, describe, expect, it, vi} from "vitest";

const workspaceSlug = `plot-scope-${Date.now()}`;
const workspaceRoot = path.join(process.cwd(), "workspace", workspaceSlug);

describe("PlotScopeGuard", () => {
    afterEach(async () => {
        await fs.rm(workspaceRoot, {recursive: true, force: true});
    });

    it("只接受当前小说 workspace 中真实存在的 manuscript 章节节点", async () => {
        await fs.mkdir(path.join(workspaceRoot, "manuscript", "001", "001-opening"), {recursive: true});
        await fs.writeFile(path.join(workspaceRoot, "manuscript", "001", "001-opening", "index.md"), "---\ntitle: 开篇\n---\n", "utf-8");

        const guard = new PlotScopeGuard(
            {} as StoryRepository,
            {} as ThreadRepository,
            {} as SceneRepository,
            {} as PlotRepository,
            {
                findNovelById: vi.fn(async () => ({
                    id: 1,
                    title: "小说",
                    summary: "",
                    workspaceSlug,
                })),
            } as PlotLookupRepository,
        );

        await expect(guard.assertChapterPath(1, "manuscript/001/001-opening/"))
            .resolves.toBe("manuscript/001/001-opening/");
        await expect(guard.assertChapterPath(1, "manuscript/001/missing/"))
            .rejects.toThrow("章节不存在");
    });
});
