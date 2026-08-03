import {describe, expect, it} from "vitest";
import {fetchLlmModels} from "nbook/server/text-to-image/llm-models";
import type {LlmFetchImpl} from "nbook/server/text-to-image/llm-chat";

describe("fetchLlmModels", () => {
    it("请求 /models 并返回 data[].id", async () => {
        const calls: string[] = [];
        const fetchImpl: LlmFetchImpl = async (value, init) => {
            calls.push(value.toString());
            expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-test");
            return new Response(JSON.stringify({data: [{id: "gpt-4o"}, {id: "gpt-4o-mini"}]}), {
                status: 200,
                headers: {"content-type": "application/json"},
            });
        };

        const models = await fetchLlmModels({
            baseUrl: "https://api.example.com/v1",
            credential: "sk-test",
            fetchImpl,
        });

        expect(models).toEqual(["gpt-4o", "gpt-4o-mini"]);
        expect(calls[0]).toBe("https://api.example.com/v1/models");
    });
});
