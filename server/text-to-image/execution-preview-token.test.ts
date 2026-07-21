import {describe, expect, it} from "vitest";
import {
    deriveIllustrationSeed,
    ExecutionPreviewTokenError,
    ExecutionPreviewTokenService,
} from "nbook/server/text-to-image/execution-preview-token";

const H = (value: string): string => `sha256:${value.repeat(64).slice(0, 64)}`;

describe("ExecutionPreviewTokenService", () => {
    it("round-trips an HMAC token and rejects tampering or expiry", () => {
        let now = Date.parse("2026-07-21T00:00:00.000Z");
        const service = new ExecutionPreviewTokenService({
            secret: "route-b-preview-token-test-secret-32-bytes",
            now: () => now,
            ttlMs: 120_000,
        });
        const issued = service.issue({
            executionNonce: "nonce-a",
            targetHash: H("a"),
            manifestHash: H("b"),
        });

        expect(service.verify(issued.token)).toEqual(issued.claims);
        const last = issued.token.at(-1);
        if (!last) throw new Error("测试 token 不能为空");
        const tampered = `${issued.token.slice(0, -1)}${last === "a" ? "b" : "a"}`;
        expect(() => service.verify(tampered)).toThrowError(expect.objectContaining<Partial<ExecutionPreviewTokenError>>({
            code: "ILLUSTRATION_PREVIEW_TOKEN_INVALID",
        }));

        now = issued.claims.expiresAt;
        expect(() => service.verify(issued.token)).toThrowError(expect.objectContaining<Partial<ExecutionPreviewTokenError>>({
            code: "ILLUSTRATION_PREVIEW_TOKEN_EXPIRED",
        }));
    });

    it("derives stable, source/output-separated NovelAI random seeds", () => {
        const input = {
            executionNonce: "nonce-a",
            sourceIdentityHash: H("c"),
            variantIndex: 0,
            outputIndex: 0,
            compilerVersion: "route-b-compiler-v1",
        };
        const first = deriveIllustrationSeed(input);

        expect(deriveIllustrationSeed(input)).toBe(first);
        expect(deriveIllustrationSeed({...input, outputIndex: 1})).not.toBe(first);
        expect(deriveIllustrationSeed({...input, sourceIdentityHash: H("d")})).not.toBe(first);
        expect(first).toBeGreaterThanOrEqual(0);
        expect(first).toBeLessThanOrEqual(4_294_967_295);
    });
});
