import type {TextToImageRequestType} from "nbook/shared/dto/text-to-image.dto";
import {
    resolveTextToImageContextProfile,
    resolveTextToImageRequestProvider,
    type ResolvedTextToImageRequestProvider,
} from "nbook/server/text-to-image/llm-context";

export type ResolvedBoundTextToImageLlmRuntime = ResolvedTextToImageRequestProvider & {
    contextEntries: Awaited<ReturnType<typeof resolveTextToImageContextProfile>>["entries"];
    promptMode: Awaited<ReturnType<typeof resolveTextToImageContextProfile>>["promptMode"];
    profileId: string;
};

/** Resolve both the request-type Provider and its context profile in one server boundary. */
export async function resolveBoundTextToImageLlmRuntime(
    userId: number,
    requestType: TextToImageRequestType,
): Promise<ResolvedBoundTextToImageLlmRuntime> {
    const [provider, contextProfile] = await Promise.all([
        resolveTextToImageRequestProvider(userId, requestType),
        resolveTextToImageContextProfile(requestType),
    ]);
    return {...provider, contextEntries: contextProfile.entries, promptMode: contextProfile.promptMode, profileId: contextProfile.id};
}
