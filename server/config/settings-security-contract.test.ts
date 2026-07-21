import {readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";

describe("NovelIdeSettingsDialog security contract", () => {
    it("Boot Config 页面展示运行态状态和只读示例", async () => {
        const source = await readFile("app/components/novel-ide/NovelIdeSettingsDialog.vue", "utf-8");
        const securityBlock = source.slice(
            source.indexOf("<!-- 启动期安全配置"),
            source.indexOf("<!-- 前端设定 -->"),
        );

        expect(source).toContain("useAuthSessionState");
        expect(securityBlock).toContain("settings.security.runtimeStatusDescription");
        expect(securityBlock).toContain("settings.security.exampleTitle");
        expect(securityBlock).toContain("settings.security.warning");
        expect(securityBlock).not.toContain("FormCheckbox");
        expect(securityBlock).not.toContain("saveSettings");
    });

    it("Director binding 只有全局模型设置可编辑，文生图只读并跳转", async () => {
        const [settingsSource, profileSettingsSource, textToImageSource, llmWorkspaceSource, pageSource, storeSource] = await Promise.all([
            readFile("app/components/novel-ide/settings/NovelIdeModelSettingsPanel.vue", "utf-8"),
            readFile("app/components/novel-ide/settings/NovelIdeAgentProfileModelSettingsPanel.vue", "utf-8"),
            readFile("app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue", "utf-8"),
            readFile("app/components/novel-ide/text-to-image/TextToImageLlmWorkspace.vue", "utf-8"),
            readFile("app/pages/index.vue", "utf-8"),
            readFile("app/stores/text-to-image.ts", "utf-8"),
        ]);

        expect(settingsSource).toContain("ILLUSTRATION_DIRECTOR_PROFILE_KEY");
        expect(settingsSource).toContain("checkIllustrationDirectorModel");
        expect(settingsSource).toContain("persistedId");
        expect(settingsSource).toContain("providerIdImmutable");
        expect(profileSettingsSource).toContain("isIllustrationDirectorProfile");
        expect(profileSettingsSource).toContain("preserveIllustrationDirectorModel");
        expect(textToImageSource).toContain("illustrationDirectorBinding");
        expect(textToImageSource).toContain("open-illustration-director-settings");
        expect(textToImageSource).not.toContain('resolveLlmTaskBinding("bodyImage")');
        expect(llmWorkspaceSource).not.toContain("bodyImage");
        expect(pageSource).not.toContain("/api/text-to-image/body-prompts");
        expect(pageSource).not.toContain('resolveLlmTaskBinding("bodyImage")');
        expect(pageSource).not.toContain("generateImageForBodyPrompt");
        expect(storeSource).toContain("Record<TextToImageAuxiliaryPromptTask, TextToImageLlmTaskBinding>");
    });

    it("Recipe 只由 Project API 持久化，手工 Job 不提交 NovelAI 标量", async () => {
        const [panelSource, storeSource] = await Promise.all([
            readFile("app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue", "utf-8"),
            readFile("app/stores/text-to-image.ts", "utf-8"),
        ]);
        const persistPick = storeSource.slice(storeSource.indexOf("pick: ["), storeSource.indexOf("]", storeSource.indexOf("pick: [")));
        const manualJobBody = panelSource.slice(panelSource.indexOf('"/api/text-to-image/jobs"'), panelSource.indexOf("});", panelSource.indexOf('"/api/text-to-image/jobs"')));

        expect(storeSource).toContain("loadRecipe");
        expect(storeSource).toContain("saveRecipe");
        expect(persistPick).not.toContain('"novelAi"');
        expect(persistPick).not.toContain('"stylePresets"');
        expect(persistPick).not.toContain('"activeStyleId"');
        expect(manualJobBody).toContain("expectedRecipeSourceHash");
        expect(manualJobBody).not.toContain("novelAi:");
        expect(manualJobBody).not.toContain("model:");
        expect(manualJobBody).not.toContain("seed:");
    });

    it("NovelAI Provider 只暴露 singleton API", async () => {
        const [collectionSource, singletonSource, panelSource] = await Promise.all([
            readFile("server/api/text-to-image/providers/index.post.ts", "utf-8"),
            readFile("server/api/text-to-image/providers/novelai.put.ts", "utf-8"),
            readFile("app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue", "utf-8"),
        ]);

        expect(collectionSource).toContain("TEXT_TO_IMAGE_PROVIDER_SINGLETON_REQUIRED");
        expect(singletonSource).toContain("saveNovelAi");
        expect(panelSource).toContain("/api/text-to-image/providers/novelai");
        expect(panelSource).not.toContain("新增 NovelAI Provider");
    });
});
