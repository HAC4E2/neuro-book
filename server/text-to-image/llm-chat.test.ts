import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {requestLlmCompletion, type LlmFetchImpl} from "nbook/server/text-to-image/llm-chat";

describe("requestLlmCompletion", () => {
    beforeEach(() => {
        // 屏蔽宿主环境代理，避免默认可达性探测产生真实网络访问。
        vi.stubEnv("HTTPS_PROXY", "");
        vi.stubEnv("https_proxy", "");
        vi.stubEnv("HTTP_PROXY", "");
        vi.stubEnv("http_proxy", "");
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("resolves setvar in one context entry before getvar in a later entry", async () => {
        let payload: {messages: Array<{content: string}>} | undefined;
        const fetchImpl: LlmFetchImpl = async (_value, init) => {
            payload = JSON.parse(String(init.body)) as {messages: Array<{content: string}>};
            return new Response(JSON.stringify({choices: [{message: {content: "ok"}}]}), {status: 200});
        };

        await requestLlmCompletion({
            baseUrl: "https://api.example.com/v1",
            credential: "sk-test",
            model: "gpt-4o",
            messages: [
                {role: "system", content: "{@setvar::scene::classroom@}"},
                {role: "user", content: "scene={{getvar::scene}}"},
            ],
            runtime: {},
            fetchImpl,
        });

        expect(payload?.messages[0]?.content).toBe("");
        expect(payload?.messages[1]?.content).toBe("scene=classroom");
    });

    it("accepts double-brace chatu-8 setvar and worldvar syntax", async () => {
        let payload: {messages: Array<{content: string}>} | undefined;
        const fetchImpl: LlmFetchImpl = async (_value, init) => {
            payload = JSON.parse(String(init.body)) as {messages: Array<{content: string}>};
            return new Response(JSON.stringify({choices: [{message: {content: "ok"}}]}), {status: 200});
        };

        await requestLlmCompletion({
            baseUrl: "https://api.example.com/v1",
            credential: "sk-test",
            model: "gpt-4o",
            messages: [
                {role: "system", content: "{{setvar::weather::rain}}"},
                {role: "user", content: "{{setworldvar::place::school}}place={{getworldvar::place}}, weather={{getvar::weather}}"},
            ],
            fetchImpl,
        });

        expect(payload?.messages[0]?.content).toBe("");
        expect(payload?.messages[1]?.content).toBe("place=school, weather=rain");
    });

    it("does not repeat a character in the common character list after a prior entry emitted it", async () => {
        let payload: {messages: Array<{content: string}>} | undefined;
        const fetchImpl: LlmFetchImpl = async (_value, init) => {
            payload = JSON.parse(String(init.body)) as {messages: Array<{content: string}>};
            return new Response(JSON.stringify({choices: [{message: {content: "ok"}}]}), {status: 200});
        };

        await requestLlmCompletion({
            baseUrl: "https://api.example.com/v1",
            credential: "sk-test",
            model: "gpt-4o",
            runtime: {
                characterList: "<人物>\n中文名称：林砚舟\n英文名称：Lin Yanzhou\n</人物>",
                commonCharacterList: "<人物>\n中文名称：林砚舟\n英文名称：Lin Yanzhou\n</人物>\n<人物>\n中文名称：小克\n</人物>",
            },
            messages: [
                {role: "system", content: "{{角色启用列表}}"},
                {role: "user", content: "{{通用角色启用列表}}"},
            ],
            fetchImpl,
        });

        expect(payload?.messages[0]?.content).toContain("林砚舟");
        expect(payload?.messages[1]?.content).not.toContain("林砚舟");
        expect(payload?.messages[1]?.content).toContain("小克");
    });

    it("非流式请求返回 choices[0].message.content", async () => {
        const calls: Array<{url: string; init: RequestInit}> = [];
        const fetchImpl: LlmFetchImpl = async (value, init) => {
            calls.push({url: value.toString(), init});
            return new Response(JSON.stringify({
                choices: [{message: {content: "hello world"}}],
            }), {status: 200, headers: {"content-type": "application/json"}});
        };

        const result = await requestLlmCompletion({
            baseUrl: "https://api.example.com/v1",
            credential: "sk-test",
            model: "gpt-4o",
            messages: [{role: "user", content: "hi"}],
            stream: false,
            fetchImpl,
        });

        expect(result).toBe("hello world");
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe("https://api.example.com/v1/chat/completions");
        const headers = new Headers(calls[0]?.init.headers);
        expect(headers.get("authorization")).toBe("Bearer sk-test");
        const body = JSON.parse(String(calls[0]?.init.body)) as {model: string; messages: Array<{role: string}>};
        expect(body.model).toBe("gpt-4o");
        expect(body.messages).toEqual([{role: "user", content: "hi"}]);
    });

    it("429 后按 retryCount 重试并成功", async () => {
        let attempts = 0;
        const fetchImpl: LlmFetchImpl = async () => {
            attempts += 1;
            if (attempts === 1) {
                return new Response("rate limited", {status: 429});
            }
            return new Response(JSON.stringify({
                choices: [{message: {content: "retried"}}],
            }), {status: 200, headers: {"content-type": "application/json"}});
        };

        const result = await requestLlmCompletion({
            baseUrl: "https://api.example.com/v1",
            credential: "sk-test",
            model: "gpt-4o",
            messages: [{role: "user", content: "hi"}],
            stream: false,
            retryCount: 2,
            fetchImpl,
        });

        expect(result).toBe("retried");
        expect(attempts).toBe(2);
    });

    it("流式请求拼接 delta.content", async () => {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode("data: {\"choices\":[{\"delta\":{\"content\":\"hel\"}}]}\n\n"));
                controller.enqueue(new TextEncoder().encode("data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n"));
                controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                controller.close();
            },
        });
        const fetchImpl: LlmFetchImpl = async () => new Response(stream, {
            status: 200,
            headers: {"content-type": "text/event-stream"},
        });

        const result = await requestLlmCompletion({
            baseUrl: "https://api.example.com/v1",
            credential: "sk-test",
            model: "gpt-4o",
            messages: [{role: "user", content: "hi"}],
            stream: true,
            fetchImpl,
        });

        expect(result).toBe("hello");
    });

    it("stream keeps the last delta when the provider omits the trailing blank line", async () => {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode("data: {\"choices\":[{\"delta\":{\"content\":\"tail\"}}]}"));
                controller.close();
            },
        });
        const result = await requestLlmCompletion({
            baseUrl: "https://api.example.com/v1",
            credential: "sk-test",
            model: "gpt-4o",
            messages: [{role: "user", content: "hi"}],
            stream: true,
            fetchImpl: async () => new Response(stream, {status: 200}),
        });

        expect(result).toBe("tail");
    });
});
