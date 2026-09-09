import {createHash} from "node:crypto";
import {describe, expect, it} from "vitest";
import {
    DEFAULT_TEXT_TO_IMAGE_TAIL_MESSAGES_CONFIG,
    DEFAULT_TEXT_TO_IMAGE_TOOL_CALL_CONFIG,
} from "nbook/shared/text-to-image-toolcall-defaults";
import {TextToImageTailMessagesConfigSchema, TextToImageToolCallConfigSchema} from "nbook/shared/dto/text-to-image.dto";
import {prepareLlmToolCallRequest, resolveTextToImageLlmSettings} from "nbook/server/text-to-image/llm-toolcall-config";
import {decodeLlmCompletionPayload, finishSseAccumulator, createSseAccumulator, accumulateSsePayload} from "nbook/server/text-to-image/llm-toolcall-response";
import {requestLlmCompletion, type LlmFetchImpl} from "nbook/server/text-to-image/llm-chat";

function sha256(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

describe("text-to-image Tool/Tail contract", () => {
    it("keeps fixed upstream runtime strings", () => {
        expect(sha256(DEFAULT_TEXT_TO_IMAGE_TOOL_CALL_CONFIG.desc)).toBe("e567e4e9f6f7855f3a75c6043ece121217a74d6b8f0948877d58739d127d409d");
        expect(DEFAULT_TEXT_TO_IMAGE_TOOL_CALL_CONFIG.fields[0]?.description).toBe("用户要求的思考cot与正文。**第一输出必须为<thinking>**");
        expect(DEFAULT_TEXT_TO_IMAGE_TAIL_MESSAGES_CONFIG.messages).toHaveLength(3);
        expect(DEFAULT_TEXT_TO_IMAGE_TAIL_MESSAGES_CONFIG.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
        expect(DEFAULT_TEXT_TO_IMAGE_TAIL_MESSAGES_CONFIG.messages.map((message) => [message.content.length, sha256(message.content)])).toEqual([
            [296, "e23d97741af47fe58c7ee404e2811869386cd5141314a53e148f7c01cc90765d"],
            [494, "1a263f3f1b1396da22f6d51d8ce6724fde7aac0bb1a4f43b2006356d911547c0"],
            [10485, "facb710db55080170a91e00060bc65d5267e97fbfc64a7fb3e0fd279d0ee5902"],
        ]);
    });

    it("uses fixed defaults when global Tool/Tail config is absent", () => {
        const resolved = resolveTextToImageLlmSettings(undefined, {baseUrl: "https://example.test", model: "m"});
        expect(resolved.toolCallConfig).toEqual(DEFAULT_TEXT_TO_IMAGE_TOOL_CALL_CONFIG);
        expect(resolved.tailMessagesConfig).toEqual(DEFAULT_TEXT_TO_IMAGE_TAIL_MESSAGES_CONFIG);
    });
    it("resolves provider override as a complete independent object", () => {
        const global = TextToImageToolCallConfigSchema.parse({enabled: true, nameMode: "fixed", fixedName: "global"});
        const tail = TextToImageTailMessagesConfigSchema.parse({enabled: true, messages: [{role: "user", content: "global %TOOL_NAME%"}]});
        const resolved = resolveTextToImageLlmSettings(
            {toolCallConfig: global, tailMessagesConfig: tail},
            {baseUrl: "https://example.test", model: "m", toolCallConfig: {enabled: false, nameMode: "dynamic", fixedName: "", prefix: "", desc: "", fields: [{name: "answer", description: "", required: true, wrapTag: ""}]}, tailMessagesConfig: {enabled: false, messages: []}},
        );
        expect(resolved.toolCallConfig.enabled).toBe(false);
        expect(resolved.tailMessagesConfig.messages).toEqual([]);
    });

    it("builds fixed tool, tool_choice and one-pass Tail replacements", () => {
        const tool = TextToImageToolCallConfigSchema.parse({enabled: true, nameMode: "fixed", fixedName: "emit", desc: "desc", fields: [{name: "thought", description: "d", required: true, wrapTag: "thinking"}]});
        const tail = TextToImageTailMessagesConfigSchema.parse({enabled: true, messages: [
            {role: "user", content: "%TOOL_NAME% / TOOL_NAME% / %s"},
            {role: "assistant", content: ""},
        ]});
        const prepared = prepareLlmToolCallRequest([{role: "user", content: "prompt"}], tool, tail);
        expect(prepared.toolName).toBe("emit");
        expect(prepared.toolChoice).toEqual({type: "function", function: {name: "emit"}});
        expect(prepared.tools?.[0]?.function.parameters.required).toEqual(["thought"]);
        expect(prepared.messages.at(-1)).toEqual({role: "user", content: "emit / emit / emit"});
    });

    it("decodes ordered fields, wraps once and ignores unknown keys", () => {
        const config = TextToImageToolCallConfigSchema.parse({enabled: true, nameMode: "fixed", fixedName: "emit", fields: [
            {name: "thought", description: "", required: true, wrapTag: "thinking"},
            {name: "body", description: "", required: false, wrapTag: ""},
        ]});
        const value = decodeLlmCompletionPayload({choices: [{message: {tool_calls: [{function: {name: "emit", arguments: JSON.stringify({body: "body", thought: "<think>keep</think>", extra: 1})}}]}}]}, {toolEnabled: true, toolName: "emit", toolConfig: config});
        expect(value).toBe("<think>keep</think>\n\nbody");
    });

    it("rejects unknown tools, bad JSON and missing required fields", () => {
        const config = TextToImageToolCallConfigSchema.parse({enabled: true, nameMode: "fixed", fixedName: "emit"});
        expect(() => decodeLlmCompletionPayload({choices: [{message: {tool_calls: [{function: {name: "other", arguments: "{}"}}]}}]}, {toolEnabled: true, toolName: "emit", toolConfig: config})).toThrow("未知工具");
        expect(() => decodeLlmCompletionPayload({choices: [{message: {tool_calls: [{function: {name: "emit", arguments: "{"}}]}}]}, {toolEnabled: true, toolName: "emit", toolConfig: config})).toThrow("JSON");
        expect(() => decodeLlmCompletionPayload({choices: [{message: {tool_calls: [{function: {name: "emit", arguments: "{}"}}]}}]}, {toolEnabled: true, toolName: "emit", toolConfig: config})).toThrow("必填");
    });

    it("assembles tool-call SSE chunks by index and matches JSON decoding", () => {
        const config = TextToImageToolCallConfigSchema.parse({enabled: true, nameMode: "fixed", fixedName: "emit"});
        const accumulator = createSseAccumulator();
        accumulateSsePayload(accumulator, {choices: [{delta: {tool_calls: [{index: 0, function: {name: "emit", arguments: "{\"thought\":\"he"}}]}}]});
        accumulateSsePayload(accumulator, {choices: [{delta: {tool_calls: [{index: 0, function: {arguments: "llo\"}"}}]}, finish_reason: "stop"}]});
        expect(finishSseAccumulator(accumulator, {toolEnabled: true, toolName: "emit", toolConfig: config})).toBe("hello");
    });

    it("does not append Tail or tools when Tool is disabled", () => {
        const prepared = prepareLlmToolCallRequest([{role: "user", content: "prompt"}], TextToImageToolCallConfigSchema.parse({enabled: false}), TextToImageTailMessagesConfigSchema.parse({enabled: true, messages: [{role: "user", content: "tail"}]}));
        expect(prepared.tools).toBeUndefined();
        expect(prepared.toolChoice).toBeUndefined();
        expect(prepared.messages).toEqual([{role: "user", content: "prompt"}]);
    });

    it("accepts an SSE frame without a trailing newline and rejects an incomplete JSON frame", async () => {
        const okFetch: LlmFetchImpl = async () => new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]', {status: 200, headers: {"content-type": "text/event-stream"}});
        await expect(requestLlmCompletion({baseUrl: "https://example.test", credential: "x", model: "m", messages: [{role: "user", content: "p"}], stream: true, fetchImpl: okFetch})).resolves.toBe("ok");
        const badFetch: LlmFetchImpl = async () => new Response('data: {"choices":[', {status: 200, headers: {"content-type": "text/event-stream"}});
        await expect(requestLlmCompletion({baseUrl: "https://example.test", credential: "x", model: "m", messages: [{role: "user", content: "p"}], stream: true, fetchImpl: badFetch})).rejects.toThrow("无法解析");
    });
    it("sends tools once and reuses the generated name on retry", async () => {
        const bodies: Array<Record<string, unknown>> = [];
        let attempts = 0;
        const fetchImpl: LlmFetchImpl = async (_url, init) => {
            attempts += 1;
            bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
            if (attempts === 1) return new Response("retry", {status: 500});
            return new Response(JSON.stringify({choices: [{message: {tool_calls: [{function: {name: (bodies[0]?.tool_choice as {function: {name: string}}).function.name, arguments: JSON.stringify({thought: "done"})}}]}}]}), {status: 200});
        };
        const config = TextToImageToolCallConfigSchema.parse({enabled: true, nameMode: "dynamic", prefix: "x_"});
        const result = await requestLlmCompletion({baseUrl: "https://example.test", credential: "x", model: "m", messages: [{role: "user", content: "p"}], toolCallConfig: config, tailMessagesConfig: {enabled: false, messages: []}, retryCount: 1, fetchImpl});
        expect(result).toBe("done");
        expect(attempts).toBe(2);
        expect((bodies[0]?.tool_choice as {function: {name: string}}).function.name).toBe((bodies[1]?.tool_choice as {function: {name: string}}).function.name);
    });
    it("does not retry an aborted request", async () => {
        let attempts = 0;
        const fetchImpl: LlmFetchImpl = async () => {
            attempts += 1;
            const error = new Error("cancelled");
            error.name = "AbortError";
            throw error;
        };
        await expect(requestLlmCompletion({
            baseUrl: "https://example.test",
            credential: "x",
            model: "m",
            messages: [{role: "user", content: "p"}],
            retryCount: 2,
            fetchImpl,
        })).rejects.toThrow();
        expect(attempts).toBe(1);
    });
    it("aborts the retry timer when the signal is cancelled", async () => {
        const controller = new AbortController();
        let attempts = 0;
        const fetchImpl: LlmFetchImpl = async () => {
            attempts += 1;
            controller.abort();
            return new Response("retry", {status: 500});
        };
        await expect(requestLlmCompletion({
            baseUrl: "https://example.test",
            credential: "x",
            model: "m",
            messages: [{role: "user", content: "p"}],
            retryCount: 2,
            signal: controller.signal,
            fetchImpl,
        })).rejects.toThrow();
        expect(attempts).toBe(1);
    });
    it("omits HTTP tools and Tail when Tool is disabled", async () => {
        let requestBody: Record<string, unknown> | undefined;
        const fetchImpl: LlmFetchImpl = async (_url, init) => {
            requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
            return new Response(JSON.stringify({choices: [{message: {content: "plain"}}]}), {status: 200});
        };
        await expect(requestLlmCompletion({
            baseUrl: "https://example.test",
            credential: "x",
            model: "m",
            messages: [{role: "user", content: "prompt"}],
            toolCallConfig: TextToImageToolCallConfigSchema.parse({enabled: false}),
            tailMessagesConfig: TextToImageTailMessagesConfigSchema.parse({enabled: true, messages: [{role: "user", content: "tail"}]}),
            fetchImpl,
        })).resolves.toBe("plain");
        expect(requestBody).toBeDefined();
        expect(requestBody).not.toHaveProperty("tools");
        expect(requestBody).not.toHaveProperty("tool_choice");
        expect(requestBody?.messages).toEqual([{role: "user", content: "prompt"}]);
    });
});
