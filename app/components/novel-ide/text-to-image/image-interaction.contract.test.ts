import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const editorPath = fileURLToPath(new URL("../../markdown-studio/TipTapMarkdownEditor.vue", import.meta.url));
const historyPath = fileURLToPath(new URL("./TextToImageHistorySection.vue", import.meta.url));

describe("text-to-image image interaction contract", () => {
    it("opens body-image post-processing only from a double click", async () => {
        const editor = await readFile(editorPath, "utf8");

        expect(editor).toContain("dblclick");
        expect(editor).toContain('emit("asset-action", {relativePath})');
        expect(editor).not.toContain("assetPressTimer");
        expect(editor).not.toContain("startAssetPress");
        expect(editor).not.toContain("clearAssetPressTimer");
        expect(editor).not.toContain("setTimeout");
        expect(editor).not.toContain("pointerdown");
    });

    it("keeps history images read-only and exposes their saved generation information", async () => {
        const history = await readFile(historyPath, "utf8");

        expect(history).toContain("activeInfoAsset");
        expect(history).toContain('@click="openAssetInfo(asset)"');
        expect(history).toContain("activeInfoAsset.prompt");
        expect(history).toContain("activeInfoAsset.negativePrompt");
        expect(history).toContain("activeInfoAsset.model");
        expect(history).toContain("activeInfoAsset.width");
        expect(history).toContain("activeInfoAsset.height");
        expect(history).toContain("activeInfoAsset.seed");
        expect(history).not.toContain("pressTimer");
        expect(history).not.toContain("openTagEdit");
        expect(history).not.toContain("reroll");
        expect(history).not.toContain("openInpaint");
        expect(history).not.toContain('@pointerdown="startPress');
        expect(history).not.toContain("/edit-tag");
        expect(history).not.toContain("/reroll");
        expect(history).not.toContain("/inpaint");
        expect(history).not.toContain("长按");
    });
});
