import {describe, expect, it} from "vitest";
import {
    clearPendingTextToImagePrompt,
    resolvePendingTextToImagePrompt,
    setPendingTextToImagePrompt,
} from "nbook/app/components/novel-ide/text-to-image/asset-action-state";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";

function asset(overrides: Partial<TextToImageAssetDto> = {}): TextToImageAssetDto {
    return {
        id: "asset-1",
        jobId: "job-1",
        sourceAnchorId: "slot-1",
        relativePath: "images/asset-1.png",
        fileName: "asset-1.png",
        mimeType: "image/png",
        byteLength: 1024,
        prompt: "original prompt",
        negativePrompt: "bad anatomy",
        model: "nai-diffusion-4-full",
        width: 832,
        height: 1216,
        seed: 123,
        sourceKind: "markdown",
        sourcePath: "chapters/chapter-01.md",
        createdAt: "2026-08-11T00:00:00.000Z",
        ...overrides,
    };
}

describe("text-to-image pending prompt state", () => {
    it("keeps a modified prompt for the image slot across history asset instances", () => {
        const current = asset();
        const historyInstance = asset({id: "asset-2", prompt: "history prompt"});
        const pending = setPendingTextToImagePrompt({}, current, "modified prompt");

        expect(resolvePendingTextToImagePrompt(historyInstance, pending)).toBe("modified prompt");
    });

    it("clears the slot after the user sends the pending prompt", () => {
        const current = asset();
        const pending = setPendingTextToImagePrompt({}, current, "modified prompt");

        expect(resolvePendingTextToImagePrompt(
            current,
            clearPendingTextToImagePrompt(pending, current),
        )).toBe("original prompt");
    });
});
