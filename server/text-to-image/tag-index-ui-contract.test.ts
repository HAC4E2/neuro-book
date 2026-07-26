import fs from "node:fs/promises";
import path from "node:path";
import {describe, expect, it} from "vitest";

describe("TextToImageTagIndexSection UI 挂载合同", () => {
    it("文生图全局设置面板挂载 Tag 词库状态/手动重导入组件", async () => {
        const source = await fs.readFile(path.join(process.cwd(), "app/components/novel-ide/settings/NovelIdeTextToImageSettingsPanel.vue"), "utf8");
        expect(source).toContain("TextToImageTagIndexSection");
    });
});
