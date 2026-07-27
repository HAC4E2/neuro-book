import {describe, expect, it} from "vitest";
import {buildTraceSegments, computeToolsHash, type PromptPrefixAttribution} from "nbook/server/agent/observability/trace-segments";
import type {StoredMessageLike} from "nbook/server/agent/messages/stored-message-presentation";

function userMessage(text: string): StoredMessageLike {
    return {role: "user", content: [{type: "text", text}]} as StoredMessageLike;
}

function assistantMessage(text: string): StoredMessageLike {
    return {role: "assistant", content: [{type: "text", text}], stopReason: "stop"} as StoredMessageLike;
}

describe("buildTraceSegments", () => {
    it("无前缀归因时全部消息落入 conversation，并单独计 system / tools", () => {
        const segments = buildTraceSegments({
            systemPrompt: "x".repeat(400),
            tools: [{name: "read"}],
            messages: [userMessage("hello"), assistantMessage("hi")],
        });

        expect(segments.map((segment) => segment.kind)).toEqual(["system", "tools", "conversation"]);
        expect(segments[0]).toMatchObject({range: null, estimatedTokens: 100});
        expect(segments[1]?.range).toBeNull();
        expect(segments[2]?.range).toEqual({start: 0, end: 2});
    });

    it("systemPrompt 与 tools 为空时整段省略", () => {
        const segments = buildTraceSegments({systemPrompt: "", tools: [], messages: [userMessage("hi")]});
        expect(segments.map((segment) => segment.kind)).toEqual(["conversation"]);
    });

    it("按前缀归因切分，并把同一 kind 的连续消息压成一段", () => {
        const prefix: PromptPrefixAttribution = {
            kinds: ["historySet", "historySet", "conversation", "modelContext", "appending", "currentInput"],
            labels: [["Import:AGENTS.md"], ["SkillCatalog"], null, null, ["Reminder:agent-mode"], null],
        };
        const segments = buildTraceSegments({
            systemPrompt: "",
            tools: [],
            messages: prefix.kinds.map((kind, index) => userMessage(`${kind}-${String(index)}`)),
            prefix,
        });

        expect(segments.map((segment) => [segment.kind, segment.range])).toEqual([
            ["historySet", {start: 0, end: 2}],
            ["conversation", {start: 2, end: 3}],
            ["modelContext", {start: 3, end: 4}],
            ["appending", {start: 4, end: 5}],
            ["currentInput", {start: 5, end: 6}],
        ]);
        expect(segments[0]?.labels).toEqual([["Import:AGENTS.md"], ["SkillCatalog"]]);
        // 整段无来源时不产出 labels 字段，避免 trace 里堆 null 数组。
        expect(segments[1]?.labels).toBeUndefined();
        expect(segments[3]?.labels).toEqual([["Reminder:agent-mode"]]);
    });

    it("超出前缀长度的消息（本 invocation 后续 turn 追加）落入 conversation", () => {
        const prefix: PromptPrefixAttribution = {kinds: ["historySet"], labels: [["Import:AGENTS.md"]]};
        const segments = buildTraceSegments({
            systemPrompt: "",
            tools: [],
            messages: [userMessage("hist"), assistantMessage("turn1"), userMessage("tool result")],
            prefix,
        });

        expect(segments.map((segment) => [segment.kind, segment.range])).toEqual([
            ["historySet", {start: 0, end: 1}],
            ["conversation", {start: 1, end: 3}],
        ]);
    });

    it("同一 kind 被打断后产生多段，消费方按 kind 求和", () => {
        const prefix: PromptPrefixAttribution = {
            kinds: ["appending", "conversation", "appending"],
            labels: [["Reminder:a"], null, ["Reminder:b"]],
        };
        const segments = buildTraceSegments({
            systemPrompt: "",
            tools: [],
            messages: prefix.kinds.map((kind) => userMessage(kind)),
            prefix,
        });

        expect(segments.map((segment) => segment.kind)).toEqual(["appending", "conversation", "appending"]);
    });

    it("估算 token 按 chars/4，与 compaction 口径一致", () => {
        const segments = buildTraceSegments({
            systemPrompt: "",
            tools: [],
            messages: [userMessage("a".repeat(40))],
        });
        expect(segments[0]?.estimatedTokens).toBe(10);
    });
});

describe("computeToolsHash", () => {
    it("工具集相同则指纹相同，schema 变化则指纹变化", () => {
        const a = computeToolsHash([{name: "read", parameters: {type: "object"}}]);
        const b = computeToolsHash([{name: "read", parameters: {type: "object"}}]);
        const c = computeToolsHash([{name: "read", parameters: {type: "string"}}]);

        expect(a).toBe(b);
        expect(a).not.toBe(c);
        expect(a).toHaveLength(8);
    });

    it("工具数量变化会改变指纹（模式切换裁剪工具集的场景）", () => {
        expect(computeToolsHash([{name: "read"}])).not.toBe(computeToolsHash([{name: "read"}, {name: "write"}]));
    });

    it("无工具时不产生指纹", () => {
        expect(computeToolsHash([])).toBeUndefined();
    });
});
