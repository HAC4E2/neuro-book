import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const editorPath = fileURLToPath(new URL("../../markdown-studio/TipTapMarkdownEditor.vue", import.meta.url));
const assetDialogPath = fileURLToPath(new URL("./TextToImageAssetActionDialog.vue", import.meta.url));
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

    it("后处理和历史详情复制实际图片 Blob 并提供下载，不复制 URL", async () => {
        const assetDialog = await readFile(assetDialogPath, "utf8");
        const history = await readFile(historyPath, "utf8");

        for (const source of [assetDialog, history]) {
            expect(source).toContain("readImageBlob");
            expect(source).toContain("copyImageBlobToClipboard");
            expect(source).toContain("downloadImageBlob");
            expect(source).not.toContain("navigator.clipboard.writeText");
        }
    });

    it("后处理工作台放大且关闭历史切片不产生正文替换副作用", async () => {
        const assetDialog = await readFile(assetDialogPath, "utf8");

        expect(assetDialog).toContain('width="min(1440px, calc(100vw - 24px))"');
        expect(assetDialog).toContain('height="min(900px, calc(100dvh - 24px))"');
        expect(assetDialog).toContain('isTagSend ? "send" : "reroll"');
        expect(assetDialog).not.toContain('emit("success", selectedAsset)');
        expect(assetDialog).not.toContain("absolute inset-0 flex items-center justify-center");
        expect(assetDialog).toContain("watch(() => props.projectRoot");
        expect(assetDialog).toContain("窗口尺寸已变化，遮罩已清空，请重新涂抹");
        expect(assetDialog).toContain('busyAction.value = "copying"');
        expect(assetDialog).toContain('busyAction.value = "downloading"');
    });
});
