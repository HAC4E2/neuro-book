import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {TextToImageChapterConflictError, TextToImageChapterService} from "nbook/server/text-to-image/chapter.service";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {registerProjectResourceOwner, resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {resolveProjectAbsolutePath, writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {createIsolatedWorkspaceAssets, type IsolatedWorkspaceAssets} from "nbook/server/workspace-files/workspace-assets-test-helper";
import {resetWorkspaceHistoryForTest, workspaceHistoryResourceOwner} from "nbook/server/workspace-history/project-history";

describe("TextToImageChapterService", () => {
    let assets: IsolatedWorkspaceAssets;
    let projectPath: string;
    let chapterPath: string;
    let service: TextToImageChapterService;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        registerProjectResourceOwner(workspaceHistoryResourceOwner);
        assets = await createIsolatedWorkspaceAssets();
        projectPath = `workspace/text-to-image-chapter-${randomUUID()}`;
        chapterPath = "manuscript/chapter-1.md";
        await writeProjectManifest(projectPath, {kind: "novel", title: "正文生图测试", summary: ""});
        await fs.mkdir(path.join(resolveProjectAbsolutePath(projectPath), "manuscript"), {recursive: true});
        await fs.writeFile(path.join(resolveProjectAbsolutePath(projectPath), chapterPath), "第一段。\n\n第二段。", "utf8");
        await openProjectForTest(projectPath);
        service = new TextToImageChapterService();
    });

    afterEach(async () => {
        await closeProjectForTest(projectPath).catch(() => undefined);
        await resetWorkspaceHistoryForTest();
        resetProjectSessionsForTest();
        await assets.dispose();
    });

    it("拒绝基于过期快照插入占位符", async () => {
        const snapshot = await service.snapshot(projectPath, chapterPath);
        await fs.writeFile(path.join(resolveProjectAbsolutePath(projectPath), chapterPath), "作者已改写。", "utf8");

        await expect(service.insertPrompts({
            projectPath,
            chapterPath,
            expectedHash: snapshot.hash,
            paragraphs: [{id: "p-1", start: 0, end: 4, text: "第一段。"}],
            prompts: [{
                afterParagraphId: "p-1",
                payload: {id: "tti-1", prompt: "1girl", negativePrompt: "", characterIds: [], sourceChapterHash: snapshot.hash},
            }],
        })).rejects.toBeInstanceOf(TextToImageChapterConflictError);
    });

    it("在无关正文编辑后仍精确替换原占位符", async () => {
        const snapshot = await service.snapshot(projectPath, chapterPath);
        await expect(service.insertPrompts({
            projectPath,
            chapterPath,
            expectedHash: snapshot.hash,
            paragraphs: [{id: "p-1", start: 0, end: 4, text: "第一段。"}],
            prompts: [{
                afterParagraphId: "p-1",
                payload: {id: "tti-1", prompt: "1girl", negativePrompt: "", characterIds: [], sourceChapterHash: snapshot.hash},
            }],
        })).resolves.toMatchObject({inserted: 1, skipped: 0});
        const chapterFile = path.join(resolveProjectAbsolutePath(projectPath), chapterPath);
        await expect(fs.readFile(chapterFile, "utf8")).resolves.toContain("<text-to-image-prompt id=\"tti-1\">");
        await fs.appendFile(chapterFile, "\n\n作者补充的无关段落。", "utf8");

        await expect(service.replacePrompt({
            projectPath,
            chapterPath,
            promptId: "tti-1",
            asset: asset(),
        })).resolves.toBe("inserted");
        await expect(fs.readFile(chapterFile, "utf8")).resolves.toContain("![NovelAI 生成图片](assets/text-to-image/2026/07/asset-1.png");
        await expect(fs.readFile(chapterFile, "utf8")).resolves.toContain("作者补充的无关段落。");
    });
});

function asset() {
    return {
        id: "asset-1",
        jobId: "job-1",
        relativePath: "assets/text-to-image/2026/07/asset-1.png",
        fileName: "asset-1.png",
        mimeType: "image/png",
        byteLength: 1,
        width: 832,
        height: 1216,
        model: "nai",
        seed: 1,
        prompt: "1girl",
        negativePrompt: "",
        sourceKind: "body",
        sourcePath: "manuscript/chapter-1.md",
        sourceAnchorId: "tti-1",
        createdAt: "2026-07-11T00:00:00.000Z",
    };
}
