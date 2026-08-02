import fs from "node:fs/promises";
import {describe, expect, it} from "vitest";

const PANEL = "app/components/novel-ide/text-to-image/TextToImageReferenceAssetsPanel.vue";
const SETTINGS = "app/components/novel-ide/settings/NovelIdeTextToImageSettingsPanel.vue";
const STORE = "app/stores/text-to-image.ts";
const PREVIEW_UI = "app/utils/illustration-execution-ui.ts";
const WORKFLOW_PANEL = "app/components/novel-ide/text-to-image/TextToImageIllustrationWorkflowPanel.vue";

describe("P5 reference asset UI contract", () => {
    it("参考面板只上传 PNG/JPEG source 图片，绝不接受 webp", async () => {
        const panel = await fs.readFile(PANEL, "utf8");
        expect(panel).toContain('accept="image/png,image/jpeg"');
        expect(panel).not.toContain("image/webp");
        expect(panel).toContain("/api/text-to-image/reference-assets");
    });

    it(".vibe/.naiv4vibe 使用 import 路由，并把 suggestedStrength 作为建议展示", async () => {
        const panel = await fs.readFile(PANEL, "utf8");
        expect(panel).toContain(".vibe");
        expect(panel).toContain("naiv4vibe");
        expect(panel).toContain("import-vibe");
        expect(panel).toContain("suggestedStrength");
        expect(panel).not.toContain("encode-vibe");
    });

    it("面板严格解析分页响应并取 parsed.items，绝不当数组用", async () => {
        const panel = await fs.readFile(PANEL, "utf8");
        expect(panel).toContain("parsed.items");
        expect(panel).not.toMatch(/assets\s*=\s*await\s*\$fetch</u);
    });

    it("当前资产元数据与 missing/tampered 状态可见；展示服务端校验的 MIME 与尺寸", async () => {
        const panel = await fs.readFile(PANEL, "utf8");
        expect(panel).toContain(".status");
        expect(panel).toContain("missing");
        expect(panel).toContain("tampered");
        expect(panel).toContain("mimeType");
        expect(panel).toContain("width");
        expect(panel).toContain("height");
    });

    it("面板与 store 不残留 imageDataUrl / vibeEncoding 浏览器状态", async () => {
        const [panel, store] = await Promise.all([
            fs.readFile(PANEL, "utf8"),
            fs.readFile(STORE, "utf8"),
        ]);
        expect(panel).not.toContain("imageDataUrl");
        expect(panel).not.toContain("vibeEncoding");
        expect(store).not.toContain("imageDataUrl");
        expect(store).not.toContain("vibeEncoding");
    });

    it("Settings 消费 registry 派生 capability，无本地 isV4Model regex 或 model-ID 子串分支", async () => {
        const settings = await fs.readFile(SETTINGS, "utf8");
        expect(settings).not.toMatch(/isV4Model\s*=\s*computed\([^)]*regex/u);
        expect(settings).not.toContain("diffusion-4(?:-|");
        expect(settings).toContain("resolveProviderCapability");
        // capability 判断来自 registry 的 smea.dynSupported，而不是模型 ID 推断。
        expect(settings).toContain("dynSupported");
    });

    it("费用文案使用“额外费用下限”，绝不出现“已知费用/精确费用”", async () => {
        const [previewUi, workflowPanel] = await Promise.all([
            fs.readFile(PREVIEW_UI, "utf8"),
            fs.readFile(WORKFLOW_PANEL, "utf8"),
        ]);
        expect(previewUi).toContain("额外费用下限");
        expect(previewUi).not.toContain("已知费用");
        expect(previewUi).not.toContain("精确费用");
        expect(workflowPanel).not.toContain("已知费用");
        expect(workflowPanel).not.toContain("精确费用");
    });
});
