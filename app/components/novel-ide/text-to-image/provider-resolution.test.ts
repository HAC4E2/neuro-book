import {describe, expect, it} from "vitest";
import {resolveTextToImageProviderId} from "nbook/app/components/novel-ide/text-to-image/provider-resolution";

describe("resolveTextToImageProviderId", () => {
    const providers = [
        {id: 2, kind: "openai_compatible" as const},
        {id: 3, kind: "openai_compatible" as const},
        {id: 4, kind: "novelai" as const},
    ];

    it("uses the request type binding instead of the first provider", () => {
        expect(resolveTextToImageProviderId(
            providers,
            {requestTypeBindings: {image_gen: {providerId: 3, contextProfileId: "default"}}},
            "image_gen",
            "openai_compatible",
        )).toBe(3);
    });

    it("does not guess when multiple providers are unbound", () => {
        expect(resolveTextToImageProviderId(
            providers,
            {requestTypeBindings: {image_gen: {providerId: null, contextProfileId: "default"}}},
            "image_gen",
            "openai_compatible",
        )).toBeNull();
    });

    it("uses the only provider when a request type is unbound", () => {
        expect(resolveTextToImageProviderId(
            [{id: 4, kind: "novelai" as const}],
            {requestTypeBindings: {}},
            "image_gen",
            "novelai",
        )).toBe(4);
    });

    it("rejects a binding whose provider has the wrong kind", () => {
        expect(resolveTextToImageProviderId(
            providers,
            {requestTypeBindings: {image_gen: {providerId: 4, contextProfileId: "default"}}},
            "image_gen",
            "openai_compatible",
        )).toBeNull();
    });
});
