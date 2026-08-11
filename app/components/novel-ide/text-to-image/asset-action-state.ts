import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";

export type PendingTextToImagePrompts = Record<string, string>;

export function textToImageAssetSlotKey(asset: TextToImageAssetDto): string {
    return asset.sourceAnchorId?.trim() || asset.id;
}

export function resolvePendingTextToImagePrompt(
    asset: TextToImageAssetDto,
    pendingPrompts: PendingTextToImagePrompts,
): string {
    return pendingPrompts[textToImageAssetSlotKey(asset)] ?? asset.prompt;
}

export function setPendingTextToImagePrompt(
    pendingPrompts: PendingTextToImagePrompts,
    asset: TextToImageAssetDto,
    prompt: string,
): PendingTextToImagePrompts {
    return {
        ...pendingPrompts,
        [textToImageAssetSlotKey(asset)]: prompt,
    };
}

export function clearPendingTextToImagePrompt(
    pendingPrompts: PendingTextToImagePrompts,
    asset: TextToImageAssetDto,
): PendingTextToImagePrompts {
    const next = {...pendingPrompts};
    delete next[textToImageAssetSlotKey(asset)];
    return next;
}
