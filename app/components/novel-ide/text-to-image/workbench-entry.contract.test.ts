import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const activityBarPath = fileURLToPath(new URL("../NovelIdeActivityBar.vue", import.meta.url));
const indexPagePath = fileURLToPath(new URL("../../../pages/index.vue", import.meta.url));
const characterSectionPath = fileURLToPath(new URL("./TextToImageCharacterSection.vue", import.meta.url));
const llmSettingsSectionPath = fileURLToPath(new URL("./TextToImageLlmSettingsSection.vue", import.meta.url));

describe("text-to-image workbench entry contract", () => {
    it("forwards the Activity Bar action through the page-owned opener", async () => {
        const [activityBar, indexPage] = await Promise.all([
            readFile(activityBarPath, "utf8"),
            readFile(indexPagePath, "utf8"),
        ]);

        expect(activityBar).toContain('(event: "open-text-to-image"): void;');
        expect(activityBar).toContain('case "text-to-image": emit("open-text-to-image"); return;');
        expect(activityBar).toContain('@click="invoke(item)"');
        expect(indexPage).toContain('@open-text-to-image="openTextToImageWorkbench"');
        const opener = indexPage.match(/function openTextToImageWorkbench\(\): void \{[\s\S]*?\n\}/)?.[0];
        expect(opener).toContain("if (!textToImageProjectSurfaceActive.value) return;");
        expect(opener).toContain("textToImageInitialCharacter.value = null;");
        expect(opener).toContain('textToImageInitialSection.value = "llm";');
        expect(opener).toContain("textToImageWorkbenchOpen.value = true;");
    });

    it("unmounts and clears text-to-image dialogs outside a ready Novel Project", async () => {
        const indexPage = await readFile(indexPagePath, "utf8");

        expect(indexPage).toContain("const textToImageProjectSurfaceActive = computed(() => projectSurfaceActive.value");
        expect(indexPage).toContain("&& !isUserAssetsWorkspace.value");
        expect(indexPage).toContain("&& Boolean(currentProjectRoot.value));");
        const cleanupWatch = indexPage.match(/watch\(textToImageProjectSurfaceActive, \(active\) => \{[\s\S]*?\n\}\);/)?.[0];
        expect(cleanupWatch).toContain("if (active) return;");
        expect(cleanupWatch).toContain("textToImageWorkbenchOpen.value = false;");
        expect(cleanupWatch).toContain('textToImageInitialSection.value = "llm";');
        expect(cleanupWatch).toContain("textToImageInitialCharacter.value = null;");
        expect(cleanupWatch).toContain("assetActionDialogOpen.value = false;");
        expect(cleanupWatch).toContain("assetActionTarget.value = null;");
        expect(cleanupWatch).toContain("assetActionAsset.value = null;");
        expect(indexPage.match(/v-if="textToImageProjectSurfaceActive"/g)).toHaveLength(2);
    });

    it("uses the generated Nitro paths for character library actions", async () => {
        const characterSection = await readFile(characterSectionPath, "utf8");

        for (const route of [
            "/api/text-to-image/character-library.activation",
            "/api/text-to-image/character-library/groups.reorder",
            "/api/text-to-image/character-library/visual.active",
            "/api/text-to-image/character-library/visual.move",
            "/api/text-to-image/character-library/visual.move-preview",
            "/api/text-to-image/character-library/visual.delete",
            "/api/text-to-image/character-library/visual.rename",
        ]) {
            expect(characterSection).toContain(`$fetch`);
            expect(characterSection).toContain(`"${route}"`);
        }
        expect(characterSection).not.toMatch(/character-library\/(?:activation|groups\/reorder|visual\/(?:active|move|delete|rename))/);
        expect(characterSection).not.toContain("visual.copy");
    });

    it("forbids event expressions that only read a function reference instead of calling it", async () => {
        const [characterSection, llmSettingsSection] = await Promise.all([
            readFile(characterSectionPath, "utf8"),
            readFile(llmSettingsSectionPath, "utf8"),
        ]);

        // `void functionName`（不带括号）只读取并丢弃函数引用，不会调用；
        // 带括号的 `void functionName()` 是真实调用，不在此门禁内。
        for (const source of [characterSection, llmSettingsSection]) {
            expect(source).not.toMatch(/@\w+="void [A-Za-z_$][A-Za-z0-9_$]*"/u);
        }
    });

    it("binds the six confirmed interactive buttons to real calls", async () => {
        const [characterSection, llmSettingsSection] = await Promise.all([
            readFile(characterSectionPath, "utf8"),
            readFile(llmSettingsSectionPath, "utf8"),
        ]);

        for (const binding of [
            '@click="deleteVisual"',
            '@click="generateVisual"',
            '@click="moveVisualToGroup"',
            '@click="generatePhotoPrompt"',
            '@click="generateAvatar"',
        ]) {
            expect(characterSection).toContain(binding);
        }
        expect(llmSettingsSection).toContain('@click="buildTestPreview"');
    });

    it("renders every group including empty groups and keeps the create form name-only", async () => {
        const characterSection = await readFile(characterSectionPath, "utf8");

        expect(characterSection).toContain('v-for="group in groups"');
        expect(characterSection).not.toContain("visualGroups");
        expect(characterSection).toContain("暂无视觉资料");
        expect(characterSection).not.toContain("newGroupId");
        expect(characterSection).toContain('placeholder="分组名称');
        expect(characterSection).not.toContain('placeholder="分组 ID');
    });

    it("wires the delete preview and revision-confirmed deletion contract", async () => {
        const characterSection = await readFile(characterSectionPath, "utf8");

        expect(characterSection).toContain('$fetch<DeleteGroupPreview>("/api/text-to-image/character-library/groups.delete-preview"');
        expect(characterSection).toContain("expectedRevision: preview.revision");
        expect(characterSection).toContain("视觉资料将移动到默认分组");
    });
});
