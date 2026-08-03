import {loadEffectiveConfig} from "nbook/server/config/config-service";
import type {TextToImageContextEntry, TextToImageRequestType} from "nbook/shared/dto/text-to-image.dto";
import type {LlmChatMessage} from "nbook/server/text-to-image/llm-chat";
import type {TextToImageRuntimePlaceholderContext} from "nbook/server/text-to-image/runtime-placeholder";

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
