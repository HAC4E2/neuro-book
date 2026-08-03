import {describe, expect, it} from "vitest";
import {buildContextMessages, shouldIncludeContextEntry} from "nbook/server/text-to-image/llm-context";
import type {TextToImageContextEntry} from "nbook/shared/dto/text-to-image.dto";

function entry(overrides: Partial<TextToImageContextEntry> = {}): TextToImageContextEntry {
    return {
        id: "entry-1",
        name: "",
        role: "user",
        content: "context content",
        enabled: true,
        triggerMode: "always",
        triggerWords: "",
        andTriggerWords: "",
        ...overrides,
    };
}

describe("llm-context", () => {
    it("always 条目无条件进入消息", () => {
        expect(buildContextMessages([entry()], {})).toEqual([
            {role: "user", content: "context content"},
        ]);
    });

    it("trigger 条目命中正文或需求才进入", () => {
        const trigger = entry({
            triggerMode: "trigger",
            triggerWords: "战斗, 森林",
        });
        expect(shouldIncludeContextEntry(trigger, {body: "进入森林"})).toBe(true);
        expect(shouldIncludeContextEntry(trigger, {userDemand: "画战斗场景"})).toBe(true);
        expect(shouldIncludeContextEntry(trigger, {body: "安静的房间"})).toBe(false);
    });

    it("andTriggerWords 必须全部命中", () => {
        const trigger = entry({
            triggerMode: "trigger",
            triggerWords: "战斗",
            andTriggerWords: "夜晚, 森林",
        });
        expect(shouldIncludeContextEntry(trigger, {body: "夜晚的森林中爆发战斗"})).toBe(true);
        expect(shouldIncludeContextEntry(trigger, {body: "白天森林中的战斗"})).toBe(false);
    });
});
