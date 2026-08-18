import {
    fetchTextToImageProvider,
    resolveTextToImageOutboundPolicy,
} from "nbook/server/text-to-image/provider-fetch";
import type {LlmFetchImpl} from "nbook/server/text-to-image/llm-chat";

export type FetchLlmModelsInput = {
    baseUrl: string;
    credential: string;
    fetchImpl?: LlmFetchImpl;
};

/** 调用 OpenAI 兼容 `/models` 拉取可用模型 ID。 */
export async function fetchLlmModels(input: FetchLlmModelsInput): Promise<string[]> {
    const baseUrl = input.baseUrl.replace(/\/+$/u, "");
    const response = await fetchTextToImageProvider(
        `${baseUrl}/models`,
        {
            method: "GET",
            headers: {authorization: `Bearer ${input.credential}`},
        },
        {
            ...resolveTextToImageOutboundPolicy(),
            allowPrivateNetwork: false,
        },
        input.fetchImpl ? {fetchImpl: input.fetchImpl as never} : {},
    );
    if (!response.ok) {
        throw new Error(`获取模型列表失败：HTTP ${response.status}`);
    }
    const data = await response.json() as {data?: Array<{id?: unknown}>};
    return (data.data ?? [])
        .map((item) => typeof item.id === "string" ? item.id : "")
        .filter(Boolean);
}
