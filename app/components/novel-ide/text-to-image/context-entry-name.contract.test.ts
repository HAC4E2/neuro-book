import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const settingsPath = fileURLToPath(new URL("./TextToImageLlmSettingsSection.vue", import.meta.url));

describe("text-to-image context entry name contract", () => {
    it("条目卡显示真实名称并提供名称编辑框", async () => {
        const source = await readFile(settingsPath, "utf8");

        expect(source).toContain("条目名称");
        expect(source).toContain('v-model="entry.name"');
        expect(source).toContain("entry.name.trim()");
        expect(source).toContain("条目 ${index + 1}");
    });
});
