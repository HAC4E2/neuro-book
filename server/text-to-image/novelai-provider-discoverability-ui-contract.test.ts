import fs from "node:fs/promises";
import path from "node:path";
import {describe, expect, it} from "vitest";

// 2026-07-27：NovelAI Provider/API 与 Recipe 编辑已迁移到全局设置（NovelIdeTextToImageSettingsPanel），
// 可发现性契约随之改为约束设置面板：API Token 入口先于 Tag 词库区块出现；
// 文生图侧边面板不得回长出第二个 Provider 凭据写入口。
describe("NovelAI Provider discoverability", () => {
    it("keeps the direct token entry in global settings ahead of the optional tag index", async () => {
        const settings = await fs.readFile(path.join(process.cwd(), "app/components/novel-ide/settings/NovelIdeTextToImageSettingsPanel.vue"), "utf8");

        expect(settings).toContain("NovelAI Recipe");
        expect(settings).toContain("API Token");
        expect(settings.indexOf("API Token")).toBeLessThan(settings.indexOf("Tag 词库"));
    });

    it("does not regrow a Provider credential entry inside the sidebar panel", async () => {
        const sidebar = await fs.readFile(path.join(process.cwd(), "app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue"), "utf8");

        expect(sidebar).not.toContain("API Token");
        expect(sidebar).not.toContain('/api/text-to-image/providers/novelai"');
    });
});
