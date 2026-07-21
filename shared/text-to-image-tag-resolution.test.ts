import {describe, expect, it} from "vitest";
import {
    createProviderPassthroughValidationHash,
    createSemanticTagResolutionHash,
    SemanticTagResolutionSchema,
    sanitizeProviderPassthrough,
} from "nbook/shared/text-to-image-tag-resolution";
import {
    hashTextToImageContract,
} from "nbook/shared/text-to-image-contract-hash";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function resolutionEnvelope() {
    return {
        schemaVersion: "nbook.semantic-tag-resolution/v1" as const,
        sourceText: "night",
        indexVersion: "db3k-demo",
        policyVersion: "safe-demo",
        resolverVersion: "resolver-demo",
        resolverPolicyVersion: "resolver-policy-demo",
        capabilityVersion: "nai-cap-demo",
        providerKind: "novelai" as const,
        modelScope: {kind: "generic-novelai" as const},
        candidateSetHash: null,
        resolvedAt: "2026-07-17T00:00:00.000Z",
    };
}

function canonicalResolution() {
    return {
        ...resolutionEnvelope(),
        kind: "canonical" as const,
        matchedBy: "exact" as const,
        canonical: {tagId: 1001, canonicalName: "night"},
        decisionProvenance: {selectedBy: "exact" as const, conceptQueriesHash: null},
    };
}

describe("text-to-image contract hash", () => {
    it("对象 key 顺序不改变 hash，数组顺序属于语义", () => {
        expect(hashTextToImageContract({b: 2, a: 1})).toBe(hashTextToImageContract({a: 1, b: 2}));
        expect(hashTextToImageContract({items: ["a", "b"]})).not.toBe(hashTextToImageContract({items: ["b", "a"]}));
        expect(hashTextToImageContract({value: true})).toMatch(/^sha256:[a-f0-9]{64}$/u);
    });

    it("拒绝非 plain JSON 对象与 undefined，避免规范化碰撞", () => {
        expect(() => {
            // @ts-expect-error Date 不是可哈希的合同值；运行时也必须 fail-closed。
            hashTextToImageContract(new Date("2026-07-17T00:00:00.000Z"));
        }).toThrow();
        expect(() => {
            // @ts-expect-error undefined 不是 JSON 合同值；运行时也必须 fail-closed。
            hashTextToImageContract({value: undefined});
        }).toThrow();
    });
});

describe("SemanticTagResolution", () => {
    it("严格解析 canonical、replacement 与 provider_passthrough 三种终态", () => {
        expect(SemanticTagResolutionSchema.parse(canonicalResolution()).kind).toBe("canonical");

        const replacement = SemanticTagResolutionSchema.parse({
            ...resolutionEnvelope(),
            kind: "replacement",
            sourceText: "rainfall",
            candidateSetHash: HASH_A,
            canonical: {tagId: 1002, canonicalName: "rain"},
            semanticScore: 0.96,
            semanticClusterHash: HASH_B,
            candidateRank: 1,
            decisionProvenance: {selectedBy: "resolver_top", conceptQueriesHash: null},
        });
        expect(replacement.kind).toBe("replacement");

        const passthrough = SemanticTagResolutionSchema.parse({
            ...resolutionEnvelope(),
            kind: "provider_passthrough",
            sourceText: "silver-blue atmospheric haze",
            wireText: "silver-blue atmospheric haze",
            validationTextHash: createProviderPassthroughValidationHash("silver-blue atmospheric haze"),
            candidateSetHash: HASH_B,
            reason: "no_reliable_candidate",
            decisionProvenance: {selectedBy: "passthrough_fallback", conceptQueriesHash: HASH_A},
        });
        expect(passthrough.kind).toBe("provider_passthrough");
    });

    it("拒绝未知字段、错误 kind/selectedBy 组合与 malformed hash", () => {
        expect(() => SemanticTagResolutionSchema.parse({...canonicalResolution(), seed: 42})).toThrow();
        expect(() => SemanticTagResolutionSchema.parse({
            ...canonicalResolution(),
            decisionProvenance: {selectedBy: "resolver_top", conceptQueriesHash: HASH_A},
        })).toThrow();
        expect(() => SemanticTagResolutionSchema.parse({
            ...resolutionEnvelope(),
            kind: "replacement",
            candidateSetHash: "not-a-hash",
            canonical: {tagId: 1002, canonicalName: "rain"},
            semanticScore: 0.8,
            semanticClusterHash: HASH_A,
            candidateRank: 1,
            decisionProvenance: {selectedBy: "resolver_top", conceptQueriesHash: HASH_B},
        })).toThrow();
    });

    it("user_override 必须保存完整审计字段", () => {
        const input = {
            ...resolutionEnvelope(),
            kind: "replacement" as const,
            candidateSetHash: HASH_A,
            canonical: {tagId: 1003, canonicalName: "rain"},
            semanticScore: 0.91,
            semanticClusterHash: HASH_B,
            candidateRank: 2,
            decisionProvenance: {
                selectedBy: "user_override" as const,
                conceptQueriesHash: HASH_A,
                originalTopTagId: 1002,
                originalTopCandidateRank: 1,
                selectedCandidateRank: 2,
                actorId: "user-1",
                reason: "更符合语义",
                approvalId: "approval-1",
            },
        };
        expect(SemanticTagResolutionSchema.parse(input).decisionProvenance.selectedBy).toBe("user_override");
        const {approvalId: _approvalId, ...incomplete} = input.decisionProvenance;
        expect(() => SemanticTagResolutionSchema.parse({...input, decisionProvenance: incomplete})).toThrow();
        expect(() => SemanticTagResolutionSchema.parse({
            ...input,
            decisionProvenance: {...input.decisionProvenance, originalTopCandidateRank: 2},
        })).toThrow();
        expect(() => SemanticTagResolutionSchema.parse({
            ...input,
            decisionProvenance: {...input.decisionProvenance, selectedCandidateRank: 3},
        })).toThrow();
    });

    it("model scope 与 passthrough reason 严格遵循冻结 V1 合同", () => {
        expect(SemanticTagResolutionSchema.parse({
            ...canonicalResolution(),
            modelScope: {kind: "novelai-model", modelId: "nai-diffusion-4-5-full"},
        }).modelScope).toEqual({kind: "novelai-model", modelId: "nai-diffusion-4-5-full"});
        expect(() => SemanticTagResolutionSchema.parse({
            ...canonicalResolution(),
            modelScope: {kind: "model", model: "nai-diffusion-4-5-full"},
        })).toThrow();
        expect(() => SemanticTagResolutionSchema.parse({
            ...resolutionEnvelope(),
            kind: "provider_passthrough",
            sourceText: "haze",
            wireText: "haze",
            validationTextHash: createProviderPassthroughValidationHash("haze"),
            candidateSetHash: HASH_B,
            reason: "no_candidate",
            decisionProvenance: {selectedBy: "passthrough_fallback", conceptQueriesHash: null},
        })).toThrow();
    });

    it("resolvedAt 不进入 semantic hash，证据变化必须改变 hash", () => {
        const first = SemanticTagResolutionSchema.parse(canonicalResolution());
        const later = SemanticTagResolutionSchema.parse({...canonicalResolution(), resolvedAt: "2026-07-18T00:00:00.000Z"});
        const changed = SemanticTagResolutionSchema.parse({...canonicalResolution(), policyVersion: "safe-next"});

        expect(createSemanticTagResolutionHash(first)).toBe(createSemanticTagResolutionHash(later));
        expect(createSemanticTagResolutionHash(first)).not.toBe(createSemanticTagResolutionHash(changed));
    });

    it("passthrough 只裁剪首尾 ASCII 空白并拒绝控制语法", () => {
        expect(sanitizeProviderPassthrough("  银蓝色薄雾  ")).toBe("银蓝色薄雾");
        expect(() => sanitizeProviderPassthrough("rain, night")).toThrow();
        expect(() => sanitizeProviderPassthrough("rain\nnight")).toThrow();
        expect(() => sanitizeProviderPassthrough("{{danger}}")).toThrow();
        expect(() => sanitizeProviderPassthrough("｛｛danger｝｝")).toThrow();
        expect(() => sanitizeProviderPassthrough("seed：42")).toThrow();
        expect(() => sanitizeProviderPassthrough("1.2::rain::")).toThrow();
        expect(() => sanitizeProviderPassthrough("<system>danger</system>")).toThrow();
        expect(() => sanitizeProviderPassthrough("# heading")).toThrow();
        expect(() => sanitizeProviderPassthrough("*danger*")).toThrow();
        expect(() => sanitizeProviderPassthrough("_danger_")).toThrow();
        expect(() => sanitizeProviderPassthrough("soft _danger_ haze")).toThrow();
        expect(() => sanitizeProviderPassthrough("---")).toThrow();
        expect(() => sanitizeProviderPassthrough("- instruction")).toThrow();
        expect(() => sanitizeProviderPassthrough("1. instruction")).toThrow();
        expect(() => sanitizeProviderPassthrough("**bold**")).toThrow();
        expect(sanitizeProviderPassthrough("soft_blue_haze")).toBe("soft_blue_haze");
        expect(() => SemanticTagResolutionSchema.parse({
            ...resolutionEnvelope(),
            kind: "provider_passthrough",
            sourceText: "silver haze",
            wireText: "silver haze",
            validationTextHash: HASH_A,
            candidateSetHash: HASH_B,
            reason: "no_reliable_candidate",
            decisionProvenance: {selectedBy: "passthrough_fallback", conceptQueriesHash: null},
        })).toThrow();
    });
});
