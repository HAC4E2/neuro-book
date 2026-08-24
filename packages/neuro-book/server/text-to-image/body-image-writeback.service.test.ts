import {beforeEach, describe, expect, it, vi} from "vitest";
import type {WorkspaceFileNode} from "nbook/server/workspace-files/workspace-files";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";

const state = vi.hoisted(() => ({
    content: "正文\n<text-to-image-prompt id=\"tti-1\">\n{\"schema\":\"nbook.text-to-image-prompt/v1\",\"prompt\":\"1girl\",\"negativePrompt\":\"\",\"anchor\":\"正文\",\"title\":\"\",\"size\":\"\",\"tagThink\":\"\"}\n</text-to-image-prompt>",
    mtimeMs: 1,
    statCalls: 0,
    writes: [] as string[],
}));

vi.mock("nbook/server/workspace-files/project-open-guard", () => ({
    withProjectTargetMutation: async (
        _target: unknown,
        handler: (handles: {history: object}) => Promise<unknown>,
    ) => handler({history: {}}),
}));

vi.mock("nbook/server/workspace-files/workspace-files", () => ({
    readWorkspaceTextFile: vi.fn(async () => state.content),
    statWorkspacePath: vi.fn(async () => ({mtimeMs: nextMtime()} as unknown as WorkspaceFileNode)),
}));

vi.mock("nbook/server/workspace-history/tracked-workspace-files", () => ({
    USER_LOCAL_ACTOR: {kind: "user", userId: 0},
    writeWorkspaceTextFileTracked: vi.fn(async (input: {content: string}) => {
        state.content = input.content;
        state.writes.push(input.content);
        state.mtimeMs += 1;
    }),
}));

function nextMtime(): number {
    state.statCalls += 1;
    // 第一次写入前模拟外部修改；服务必须重新读盘后再替换。
    return state.statCalls === 2 ? 2 : state.mtimeMs;
}

const asset: TextToImageAssetDto = {
    id: "asset-1",
    jobId: "job-1",
    relativePath: "assets/tti/asset-1.png",
    fileName: "asset-1.png",
    mimeType: "image/png",
    byteLength: 10,
    width: 832,
    height: 1216,
    model: "nai-diffusion-4-5-full",
    seed: 1,
    prompt: "1girl",
    negativePrompt: "",
    sourceKind: "body",
    sourcePath: "manuscript/chapter-1.md",
    sourceAnchorId: "tti-1",
    createdAt: "2026-08-17T00:00:00.000Z",
};

describe("body image writeback service", () => {
    beforeEach(() => {
        state.content = "正文\n<text-to-image-prompt id=\"tti-1\">\n{\"schema\":\"nbook.text-to-image-prompt/v1\",\"prompt\":\"1girl\",\"negativePrompt\":\"\",\"anchor\":\"正文\",\"title\":\"\",\"size\":\"\",\"tagThink\":\"\"}\n</text-to-image-prompt>";
        state.mtimeMs = 1;
        state.statCalls = 0;
        state.writes.length = 0;
    });

    it("按最新文件版本重试并只替换目标占位符", async () => {
        const {writeBodyImageAssetToChapter} = await import("nbook/server/text-to-image/body-image-writeback.service");
        const result = await writeBodyImageAssetToChapter({
            target: {kind: "project-workspace", root: "C:/project" as never, projectRoot: "demo" as never},
            filePath: "manuscript/chapter-1.md",
            placeholderId: "tti-1",
            asset,
        });

        expect(result.status).toBe("inserted");
        expect(result.content).toContain("![NovelAI 生成图片](assets/tti/asset-1.png");
        expect(state.writes).toHaveLength(1);
        expect(state.statCalls).toBeGreaterThanOrEqual(4);
    });

    it("占位符已消失但已有同来源图片时返回 already_inserted", async () => {
        state.content = "正文\n![NovelAI 生成图片](assets/tti/asset-old.png \"seed 2 | 832x1216\")";
        const {writeBodyImageAssetToChapter} = await import("nbook/server/text-to-image/body-image-writeback.service");
        const result = await writeBodyImageAssetToChapter({
            target: {kind: "project-workspace", root: "C:/project" as never, projectRoot: "demo" as never},
            filePath: "manuscript/chapter-1.md",
            placeholderId: "tti-1",
            asset,
            existingAssetPaths: ["assets/tti/asset-old.png"],
        });

        expect(result.status).toBe("already_inserted");
        expect(state.writes).toHaveLength(0);
    });

    it("占位符消失且没有已知图片时返回 missing，不写正文", async () => {
        state.content = "正文";
        const {writeBodyImageAssetToChapter} = await import("nbook/server/text-to-image/body-image-writeback.service");
        const result = await writeBodyImageAssetToChapter({
            target: {kind: "project-workspace", root: "C:/project" as never, projectRoot: "demo" as never},
            filePath: "manuscript/chapter-1.md",
            placeholderId: "tti-1",
            asset,
        });

        expect(result.status).toBe("missing");
        expect(state.writes).toHaveLength(0);
    });
});
