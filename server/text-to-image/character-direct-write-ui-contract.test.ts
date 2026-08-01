import {readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";

const PANEL_PATH = "app/components/novel-ide/workspace/WorkspaceCharacterDetailPanel.vue";

describe("character detail direct-write ownership contract", () => {
    it("保存精确正文、持久化 pending identity 后只调用 direct route", async () => {
        const source = await readFile(PANEL_PATH, "utf8");
        const saveIndex = source.indexOf("await saveDraft(");
        const hashIndex = source.indexOf("createTextToImageFileHash(", saveIndex);
        const pendingIndex = source.indexOf("writePendingDirectWrite(", hashIndex);
        const fetchIndex = source.indexOf("$fetch(\"/api/text-to-image/character-image-tags\"", pendingIndex);
        expect(saveIndex).toBeGreaterThan(0);
        expect(hashIndex).toBeGreaterThan(saveIndex);
        expect(pendingIndex).toBeGreaterThan(hashIndex);
        expect(fetchIndex).toBeGreaterThan(pendingIndex);
        expect(source.match(/\/api\/text-to-image\/character-image-tags/gmu)).toHaveLength(1);
    });

    it("严格解析完成结果，按 error code 清理或保留同一 pending key", async () => {
        const source = await readFile(PANEL_PATH, "utf8");
        expect(source).toContain("CharacterVisualDirectWriteResultSchema.parse");
        expect(source).toContain("resolveApiErrorCode(error)");
        expect(source).toContain("CharacterVisualDirectWriteTerminalErrorCodeSchema.safeParse");
        expect(source).toContain("clearPendingDirectWrite(");
        expect(source).toContain("useNotification()");
        expect(source).toContain("resolveApiErrorMessage(error");
    });

    it("成功后刷新树与当前文件，并在运行期间显示进度、禁用冲突动作", async () => {
        const source = await readFile(PANEL_PATH, "utf8");
        expect(source).toContain("store.loadWorkspaceTree(");
        expect(source).toContain("store.loadWorkspaceFile(");
        expect(source).toContain("generatingImageTags ? \"生成中...\"");
        expect(source).toContain(":disabled=\"savingFile || generatingImageTags\"");
    });

    it("不再拥有 preview、冲突决策或 migration/proposal UI", async () => {
        const source = await readFile(PANEL_PATH, "utf8");
        for (const removed of [
            "directorPreview",
            "directorDecisions",
            "prepareDirectorMigration",
            "directorFieldLabel",
            "character-visual-migrations",
            "proposal",
            "migration",
        ]) {
            expect(source).not.toContain(removed);
        }
        expect(source).not.toMatch(/(?:bg|text|border)-(?:gray|slate|zinc|neutral|red|amber|green|blue)-/u);
        expect(source).not.toContain("dark:");
    });
});
