import {describe, expect, it} from "vitest";
import {normalizeImportedContextProfiles} from "nbook/app/utils/text-to-image-context-import";

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

    it("空对象抛错", () => {
        expect(() => normalizeImportedContextProfiles({})).toThrow(/没有可导入/);
    });
});
