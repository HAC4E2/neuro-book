import {readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";

const COMPONENT = "app/components/novel-ide/text-to-image/TextToImageProjectOverlayPanel.vue";
const HOST = "app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue";

describe("Project overlay UI contract", () => {
    it("只提交 strict Project overlay CAS，不建立 Global/Provider/Recipe 浏览器写入口", async () => {
        const [component, host] = await Promise.all([
            readFile(COMPONENT, "utf8"),
            readFile(HOST, "utf8"),
        ]);
        expect(component).toContain("/api/text-to-image/project-overlays");
        expect(component).toContain("expectedFileHash");
        expect(component).toContain('mode: "draft"');
        expect(component).toContain("saveOverlay('storyboard', 'apply')");
        expect(component).toContain("saveOverlay('patterns', 'apply')");
        expect(component).not.toContain("localStorage");
        expect(component).not.toContain("targetPath");
        expect(component).not.toContain("/api/text-to-image/providers");
        expect(component).not.toContain("/api/text-to-image/recipes");
        expect(component).not.toContain("sampler");
        expect(component).not.toContain("seed");
        expect(host).toContain("TextToImageProjectOverlayPanel");
        expect(host).toContain('@global-published="handleGlobalStoryboardPublished"');
    });
});
