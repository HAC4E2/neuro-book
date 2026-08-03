import {describe, expect, it} from "vitest";
import {requestLlmCompletion, type LlmFetchImpl} from "nbook/server/text-to-image/llm-chat";

describe("requestLlmCompletion", () => {
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
});
