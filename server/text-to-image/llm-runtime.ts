import type {TextToImageRequestType} from "nbook/shared/dto/text-to-image.dto";
import {
    resolveTextToImageContextEntries,
    resolveTextToImageRequestProvider,
    type ResolvedTextToImageRequestProvider,
} from "nbook/server/text-to-image/llm-context";

export type ResolvedBoundTextToImageLlmRuntime = ResolvedTextToImageRequestProvider & {
    contextEntries: Awaited<ReturnType<typeof resolveTextToImageContextEntries>>;
};

/** Resolve both the request-type Provider and its context profile in one server boundary. */
export async function resolveBoundTextToImageLlmRuntime(
    userId: number,
    requestType: TextToImageRequestType,
): Promise<ResolvedBoundTextToImageLlmRuntime> {
    const [provider, contextEntries] = await Promise.all([
        resolveTextToImageRequestProvider(userId, requestType),
        resolveTextToImageContextEntries(requestType),
    ]);
    return {...provider, contextEntries};
}
