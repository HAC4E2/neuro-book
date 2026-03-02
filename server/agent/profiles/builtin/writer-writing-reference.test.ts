import {describe, expect, it} from "vitest";
import {buildWritingReference, loadWritingReferencePresets, resolveWritingReferenceDirectory} from "nbook/server/agent/profiles/builtin/writer-writing-reference";

describe("writer-writing-reference", () => {
    it("可以动态发现默认文风参考正文", async () => {
        const reference = await buildWritingReference();

        expect(reference).toContain("<writing_reference>");
        expect(reference).toContain("# 第1章 反派魔法少女");
        expect(reference).toContain("# 第2章 反派的日常就是找茬");
        expect(reference).toContain("# 第3章 蹲点是反派的必备技能");
        expect(reference).not.toContain("key:");
        expect(reference).not.toContain("generatedFrom:");
    });

    it("会从源码目录 fallback 加载 writing-references", async () => {
        const directory = await resolveWritingReferenceDirectory([
            "C:/definitely-missing-writing-references",
            "server/agent/profiles/builtin/writing-references",
        ]);
        const references = await loadWritingReferencePresets();

        expect(directory.replace(/\\/g, "/")).toContain("server/agent/profiles/builtin/writing-references");
        expect(references.some((reference) => reference.key === "reborn-villain-loli-magic-girl.first-three-chapters")).toBe(true);
    });
});
