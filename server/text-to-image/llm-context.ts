import {loadEffectiveConfig} from "nbook/server/config/config-service";
import type {TextToImageContextEntry, TextToImageRequestType} from "nbook/shared/dto/text-to-image.dto";
import type {LlmChatMessage} from "nbook/server/text-to-image/llm-chat";
import type {TextToImageRuntimePlaceholderContext} from "nbook/server/text-to-image/runtime-placeholder";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";

export type ResolvedTextToImageRequestProvider = {
    providerId: number;
    settings: Record<string, unknown>;
    credential: string;
};

/** 根据 LLM 管理中的请求类型绑定解析运行时 Provider，业务页面不再重复选择模型。 */
export async function resolveTextToImageRequestProvider(
    userId: number,
    requestType: TextToImageRequestType,
): Promise<ResolvedTextToImageRequestProvider> {
    const effective = await loadEffectiveConfig({workspaceKind: "user-assets"});
    const configuredProviderId = effective.textToImage.requestTypeBindings?.[requestType]?.providerId;
    if (typeof configuredProviderId !== "number" || !Number.isInteger(configuredProviderId) || configuredProviderId <= 0) {
        throw new Error(`请先在 LLM 管理中为“${requestType}”绑定 Provider。`);
    }
    const providerId = configuredProviderId;
    const providerService = new TextToImageProviderService();
    const provider = (await providerService.list(userId)).find((item) => item.id === providerId);
    if (!provider) {
        throw new Error(`请求类型“${requestType}”绑定的 Provider 不存在，请重新绑定 OpenAI 兼容 Provider。`);
    }
    if (provider.kind !== "openai_compatible") {
        throw new Error(`请求类型“${requestType}”绑定的 Provider kind 为“${provider.kind}”，只能使用 openai_compatible，NovelAI 仅用于生图。`);
    }
    const runtime = await providerService.resolveRuntimeProvider(userId, providerId);
    return {providerId, ...runtime};
}

/** 按请求类型读取全局绑定对应的上下文预设条目。 */
export async function resolveTextToImageContextEntries(
    requestType: TextToImageRequestType,
): Promise<TextToImageContextEntry[]> {
    const effective = await loadEffectiveConfig({workspaceKind: "user-assets"});
    const binding = effective.textToImage.requestTypeBindings?.[requestType];
    const profileId = binding?.contextProfileId ?? "default";
    return effective.textToImage.contextProfiles?.[profileId]?.entries ?? [];
}

/** 把启用的上下文预设条目转成 LLM 消息，插到任务 system/user 前。 */
export function buildContextMessages(
    entries: TextToImageContextEntry[],
    runtime: TextToImageRuntimePlaceholderContext,
): LlmChatMessage[] {
    return entries
        .filter((entry) => shouldIncludeContextEntry(entry, runtime))
        .map((entry) => ({
            role: entry.role,
            content: entry.content,
        }));
}

/** 按 triggerMode/triggerWords/andTriggerWords 判断条目是否进入本次请求。 */
export function shouldIncludeContextEntry(
    entry: TextToImageContextEntry,
    runtime: TextToImageRuntimePlaceholderContext,
): boolean {
    if (!entry.enabled) {
        return false;
    }
    if (entry.triggerMode === "always") {
        return true;
    }
    const haystack = [
        runtime.body ?? "",
        runtime.context ?? "",
        runtime.userDemand ?? "",
        runtime.worldBook ?? "",
    ].join("\n").toLowerCase();
    const triggers = splitTriggerWords(entry.triggerWords);
    const andTriggers = splitTriggerWords(entry.andTriggerWords);
    if (triggers.length === 0) {
        return true;
    }
    const anyMatched = triggers.some((word) => haystack.includes(word));
    if (!anyMatched) {
        return false;
    }
    return andTriggers.every((word) => haystack.includes(word));
}

function splitTriggerWords(text: string): string[] {
    return text
        .split(/[,，\n]/u)
        .map((word) => word.trim().toLowerCase())
        .filter((word) => word !== "");
}
