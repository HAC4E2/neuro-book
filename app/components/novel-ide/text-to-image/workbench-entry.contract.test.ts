import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const activityBarPath = fileURLToPath(new URL("../NovelIdeActivityBar.vue", import.meta.url));
const indexPagePath = fileURLToPath(new URL("../../../pages/index.vue", import.meta.url));
const characterSectionPath = fileURLToPath(new URL("./TextToImageCharacterSection.vue", import.meta.url));

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
            "/api/text-to-image/character-library/visual.copy",
            "/api/text-to-image/character-library/visual.delete",
            "/api/text-to-image/character-library/visual.rename",
        ]) {
            expect(characterSection).toContain(`$fetch("${route}"`);
        }
        expect(characterSection).not.toMatch(/character-library\/(?:activation|groups\/reorder|visual\/(?:active|copy|delete|rename))/);
    });
});
