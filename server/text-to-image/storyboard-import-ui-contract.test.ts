import fs from "node:fs/promises";
import path from "node:path";
import {describe, expect, it} from "vitest";

const COMPONENT_PATH = path.resolve("app/components/novel-ide/text-to-image/TextToImageStoryboardImportPanel.vue");
const HOST_PATH = path.resolve("app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue");

describe("Storyboard import pending preview UI contract", () => {
    it("只经 server inspect + Director Runtime + preview 读取，不保留浏览器导入真相源", async () => {
        const [component, host] = await Promise.all([
            fs.readFile(COMPONENT_PATH, "utf8"),
            fs.readFile(HOST_PATH, "utf8"),
        ]);

        expect(component).toContain("/api/text-to-image/storyboard-imports/sources");
        expect(component).toContain("/api/text-to-image/storyboard-imports/inspect");
        expect(component).toContain("/api/text-to-image/storyboard-imports/preview");
        expect(component).toContain('profileKey: "illustration.director"');
        expect(component).toContain('operation: "convert-preset"');
        expect(component).toContain("pendingPreview.approval.code");
        expect(component).toContain("pending_unresolved companion package");
        expect(component).toContain("/api/text-to-image/storyboard-imports/resolve");
        expect(component).toContain("/api/text-to-image/storyboard-imports/publish-preview");
        expect(component).toContain("/api/text-to-image/storyboard-imports/publish\"");
        expect(component).toContain("/api/text-to-image/storyboard-imports/publish-selector-retry");
        expect(component).toContain('targetScope: "global"');
        expect(component).toContain("confirmGlobal: true");
        expect(component).not.toContain("localStorage");
        expect(component).not.toContain("tagData");
        expect(component).not.toContain("/api/text-to-image/recipes/default");
        expect(component).not.toContain("/api/text-to-image/providers");

        expect(host).toContain("TextToImageStoryboardImportPanel");
        expect(host).not.toContain("parseStTtpTextToImageSettings");
        expect(host).not.toContain("stTtpFileInputRef");
        expect(host).not.toContain("importStTtpSettings");
    });
});
