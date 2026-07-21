import fs from "node:fs/promises";
import path from "node:path";
import {describe, expect, it} from "vitest";

describe("TextToImageCharacterMigrationPanel", () => {
    it("只调用 migration 控制面，并提供逐项 review/accept 与 journal 恢复入口", async () => {
        const source = await fs.readFile(path.join(process.cwd(), "app/components/novel-ide/text-to-image/TextToImageCharacterMigrationPanel.vue"), "utf8");
        expect(source).toContain("CharacterVisualMigrationSnapshot");
        expect(source).toContain("acceptedResolutionKeys");
        expect(source).toContain("reviewRequestHash");
        expect(source).toContain("character-visual-migrations/resume");
        expect(source).toContain("TextToImageCharacterSourcePanel");
        expect(source).toContain("pendingMigrations");
        expect(source).toContain("resolveApiErrorMessage");
        expect(source).not.toMatch(/providerId|recipeId|sampler|scheduler|guidance|smea|seed|localStorage/iu);
    });

    it("角色详情只生成 Director proposal，不再选择独立 LLM 或直接写视觉文件", async () => {
        const source = await fs.readFile(path.join(process.cwd(), "app/components/novel-ide/workspace/WorkspaceCharacterDetailPanel.vue"), "utf8");
        expect(source).toContain("CharacterVisualDirectorGenerateResult");
        expect(source).toContain("character-visual-migrations/director-prepare");
        expect(source).toContain("expectedPreviewHash");
        expect(source).not.toContain('resolveLlmTaskBinding("characterDesign")');
        expect(source).not.toMatch(/providerId|taskPrompt|temperature|topP|maxTokens|writeWorkspaceTextFile/iu);
    });

    it("Director proposal 只消费已落盘 Project 角色事实，不复制 SillyTavern card/PNG parser", async () => {
        const source = await fs.readFile(path.join(process.cwd(), "server/text-to-image/character-image-tags.ts"), "utf8");
        expect(source).toContain("readWorkspaceTextFile");
        expect(source).toContain("CharacterVisualDirectorGenerateRequestSchema");
        expect(source).not.toMatch(/readSillyTavernPngJson|loadCardInput|png-chunks|character_book/iu);
    });

    it("公开角色源入口使用服务端 inspect/preview/prepare hash，不持有 Provider 或生成参数", async () => {
        const source = await fs.readFile(path.join(process.cwd(), "app/components/novel-ide/text-to-image/TextToImageCharacterSourcePanel.vue"), "utf8");
        expect(source).toContain("character-visual-migrations/source-inspect");
        expect(source).toContain("character-visual-migrations/source-preview");
        expect(source).toContain("character-visual-migrations/source-prepare");
        expect(source).toContain("expectedMergePreviewHash");
        expect(source).toContain("decisionRequired");
        expect(source).not.toMatch(/providerId|recipeId|sampler|scheduler|guidance|smea|seed|localStorage/iu);
    });

    it("宿主把迁移面板放在文生图分页，组件不进入正文按钮或 Agent Profile", async () => {
        const host = await fs.readFile(path.join(process.cwd(), "app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue"), "utf8");
        expect(host).toContain("TextToImageCharacterMigrationPanel");
        expect(host).toContain(":project-path=\"currentProjectPath\"");
    });
});
