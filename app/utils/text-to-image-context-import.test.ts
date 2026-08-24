import {describe, expect, it} from "vitest";
import {normalizeImportedContextProfiles} from "nbook/app/utils/text-to-image-context-import";
import {TextToImageGlobalConfigSchema} from "nbook/shared/dto/text-to-image.dto";

describe("normalizeImportedContextProfiles", () => {
    it("兼容 chatu8 `预设名 -> {entries}` 格式", () => {
        const result = normalizeImportedContextProfiles({
            "正文生图": {
                entries: [
                    {
                        id: "entry-1",
                        name: "用户消息",
                        role: "user",
                        content: "{{正文}}",
                        enabled: true,
                        triggerMode: "always",
                        triggerWords: "",
                    },
                ],
            },
        });
        expect(result["正文生图"]).toMatchObject({
            id: "正文生图",
            name: "正文生图",
            entries: [
                expect.objectContaining({
                    id: "entry-1",
                    name: "用户消息",
                    content: "{{正文}}",
                    andTriggerWords: "",
                }),
            ],
        });
    });

    it("兼容本应用导出格式", () => {
        const result = normalizeImportedContextProfiles({
            "profile-a": {
                id: "profile-a",
                name: "Profile A",
                entries: [],
            },
        });
        expect(result["profile-a"]?.name).toBe("Profile A");
    });

    it("保留合成的 507 个条目名称，保存/刷新/再次导出不改名", () => {
        const entries = Array.from({length: 507}, (_, index) => ({
            id: `synthetic-entry-${index + 1}`,
            name: `合成条目 ${index + 1}`,
            role: "user" as const,
            content: `synthetic-content-${index + 1}`,
            enabled: true,
            triggerMode: "always" as const,
            triggerWords: "",
            andTriggerWords: "",
        }));
        const imported = normalizeImportedContextProfiles({
            synthetic: {id: "synthetic", name: "Synthetic", entries},
        });
        const saved = TextToImageGlobalConfigSchema.parse({contextProfiles: imported});
        const reloaded = TextToImageGlobalConfigSchema.parse(JSON.parse(JSON.stringify(saved)));
        const result = reloaded.contextProfiles.synthetic;

        expect(result?.entries).toHaveLength(507);
        expect(result?.entries[0]?.name).toBe("合成条目 1");
        expect(result?.entries[253]?.name).toBe("合成条目 254");
        expect(result?.entries[506]?.name).toBe("合成条目 507");
    });

    it("空对象抛错", () => {
        expect(() => normalizeImportedContextProfiles({})).toThrow(/没有可导入/);
    });
});
