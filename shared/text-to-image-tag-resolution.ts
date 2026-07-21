import {z} from "zod";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";

export const SEMANTIC_TAG_RESOLUTION_SCHEMA_VERSION = "nbook.semantic-tag-resolution/v1" as const;

export const TextToImageContractHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const StableVersionSchema = z.string().trim().min(1).max(160);
const StableActorSchema = z.string().trim().min(1).max(160);

export const TextToImageModelScopeSchema = z.discriminatedUnion("kind", [
    z.object({kind: z.literal("generic-novelai")}).strict(),
    z.object({kind: z.literal("novelai-model"), modelId: z.string().trim().min(1).max(160)}).strict(),
]);
export type TextToImageModelScope = z.infer<typeof TextToImageModelScopeSchema>;

const CanonicalTagSchema = z.object({
    tagId: z.number().int().positive(),
    canonicalName: z.string().trim().min(1).max(240),
}).strict();

const ExactProvenanceSchema = z.object({
    selectedBy: z.literal("exact"),
    conceptQueriesHash: z.null(),
}).strict();

const AliasProvenanceSchema = z.object({
    selectedBy: z.literal("alias"),
    conceptQueriesHash: z.null(),
}).strict();

const ResolverTopProvenanceSchema = z.object({
    selectedBy: z.literal("resolver_top"),
    conceptQueriesHash: TextToImageContractHashSchema.nullable(),
}).strict();

const UserOverrideProvenanceSchema = z.object({
    selectedBy: z.literal("user_override"),
    conceptQueriesHash: TextToImageContractHashSchema.nullable(),
    originalTopTagId: z.number().int().positive(),
    originalTopCandidateRank: z.literal(1),
    selectedCandidateRank: z.number().int().positive(),
    actorId: StableActorSchema,
    reason: z.string().trim().min(1).max(500),
    approvalId: StableActorSchema,
}).strict();

const PassthroughProvenanceSchema = z.object({
    selectedBy: z.literal("passthrough_fallback"),
    conceptQueriesHash: TextToImageContractHashSchema.nullable(),
}).strict();

const ResolutionEnvelopeShape = {
    schemaVersion: z.literal(SEMANTIC_TAG_RESOLUTION_SCHEMA_VERSION),
    sourceText: z.string().min(1).max(500),
    indexVersion: StableVersionSchema,
    policyVersion: StableVersionSchema,
    resolverVersion: StableVersionSchema,
    resolverPolicyVersion: StableVersionSchema,
    capabilityVersion: StableVersionSchema,
    providerKind: z.literal("novelai"),
    modelScope: TextToImageModelScopeSchema,
    candidateSetHash: TextToImageContractHashSchema.nullable(),
    resolvedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u),
} as const;

const CanonicalResolutionSchema = z.object({
    ...ResolutionEnvelopeShape,
    kind: z.literal("canonical"),
    candidateSetHash: z.null(),
    matchedBy: z.enum(["exact", "alias"]),
    canonical: CanonicalTagSchema,
    decisionProvenance: z.union([ExactProvenanceSchema, AliasProvenanceSchema]),
}).strict();

const ReplacementResolutionSchema = z.object({
    ...ResolutionEnvelopeShape,
    kind: z.literal("replacement"),
    candidateSetHash: TextToImageContractHashSchema,
    canonical: CanonicalTagSchema,
    semanticScore: z.number().min(0).max(1),
    semanticClusterHash: TextToImageContractHashSchema,
    candidateRank: z.number().int().positive(),
    decisionProvenance: z.union([ResolverTopProvenanceSchema, UserOverrideProvenanceSchema]),
}).strict();

const ProviderPassthroughResolutionSchema = z.object({
    ...ResolutionEnvelopeShape,
    kind: z.literal("provider_passthrough"),
    candidateSetHash: TextToImageContractHashSchema,
    wireText: z.string().min(1).max(500),
    validationTextHash: TextToImageContractHashSchema,
    reason: z.literal("no_reliable_candidate"),
    decisionProvenance: PassthroughProvenanceSchema,
}).strict();

/** Resolver 可持久化的三种 terminal snapshot；pending/candidate 状态不属于该联合。 */
export const SemanticTagResolutionSchema = z.discriminatedUnion("kind", [
    CanonicalResolutionSchema,
    ReplacementResolutionSchema,
    ProviderPassthroughResolutionSchema,
]).superRefine((resolution, context) => {
    if (resolution.kind === "canonical" && resolution.matchedBy !== resolution.decisionProvenance.selectedBy) {
        context.addIssue({
            code: "custom",
            path: ["decisionProvenance", "selectedBy"],
            message: "canonical matchedBy 必须与 selectedBy 一致",
        });
    }
    if (resolution.kind === "provider_passthrough") {
        try {
            const wireText = sanitizeProviderPassthrough(resolution.sourceText);
            if (wireText !== resolution.wireText) {
                context.addIssue({
                    code: "custom",
                    path: ["wireText"],
                    message: "wireText 必须等于 sourceText 仅裁剪首尾 ASCII 空格后的结果",
                });
            }
            const validationTextHash = createProviderPassthroughValidationHash(resolution.sourceText);
            if (validationTextHash !== resolution.validationTextHash) {
                context.addIssue({
                    code: "custom",
                    path: ["validationTextHash"],
                    message: "validationTextHash 必须来自 NFKC validationText",
                });
            }
        } catch (error) {
            context.addIssue({
                code: "custom",
                path: ["wireText"],
                message: error instanceof Error ? error.message : "provider passthrough 非法",
            });
        }
    }
    if (resolution.kind === "replacement") {
        if (resolution.decisionProvenance.selectedBy === "resolver_top" && resolution.candidateRank !== 1) {
            context.addIssue({
                code: "custom",
                path: ["candidateRank"],
                message: "resolver_top 必须选择排名第一的 eligible candidate",
            });
        }
        if (resolution.decisionProvenance.selectedBy === "user_override"
            && resolution.decisionProvenance.selectedCandidateRank !== resolution.candidateRank) {
            context.addIssue({
                code: "custom",
                path: ["decisionProvenance", "selectedCandidateRank"],
                message: "selectedCandidateRank 必须与 replacement candidateRank 一致",
            });
        }
    }
});

export type SemanticTagResolution = z.infer<typeof SemanticTagResolutionSchema>;

/**
 * 产生 NovelAI 可见的受控库外原词。
 *
 * 只裁剪首尾 ASCII 空格；逗号、控制字符、宏、权重和参数语法全部阻断。
 */
export function sanitizeProviderPassthrough(sourceText: string): string {
    const wireText = sourceText.replace(/^ +| +$/gu, "");
    const validationText = sourceText.normalize("NFKC");
    const trimmedValidationText = validationText.replace(/^ +| +$/gu, "");
    if (!wireText || !trimmedValidationText) {
        throw new Error("provider passthrough 不能为空");
    }
    if (/[\u0000-\u001f\u007f]/u.test(validationText)) {
        throw new Error("provider passthrough 不能包含控制字符");
    }
    if (/,/u.test(validationText)) {
        throw new Error("provider passthrough 必须先按逗号拆成单项");
    }
    if (/(?:\{|\}|\[|\])|::|\$\{|\{%|%\}|--[\p{L}_]|[\p{L}_][\p{L}\p{N}_.-]*\s*[:=]/iu.test(validationText)) {
        throw new Error("provider passthrough 不能包含宏、权重或 Provider 参数语法");
    }
    if (/[<>*`]|(?:^|\s)[#>]\s|~~|!\[|\]\(/u.test(validationText)
        || /(?:^|[\s(\[{"'])_(?!_)(?=\S)(?:.*?\S)?_(?!_)(?=$|[\s)\]}"'.,!?;:])/u.test(validationText)
        || /(?:^|[\s(\[{"'])__(?=\S)(?:.*?\S)?__(?=$|[\s)\]}"'.,!?;:])/u.test(validationText)
        || /^(?:-{3,}|_{3,})$/u.test(trimmedValidationText)
        || /^(?:[-+]\s+|\d+[.)]\s+)/u.test(trimmedValidationText)) {
        throw new Error("provider passthrough 不能包含 XML 或 Markdown 语法");
    }
    return wireText;
}

/** 对仅用于校验的 NFKC 文本生成稳定 hash；该文本本身不得持久化。 */
export function createProviderPassthroughValidationHash(sourceText: string): string {
    return hashTextToImageContract({validationText: sourceText.normalize("NFKC")});
}

/** 计算 terminal resolution 的语义 hash；审计时间不参与语义身份。 */
export function createSemanticTagResolutionHash(input: SemanticTagResolution): string {
    const resolution = SemanticTagResolutionSchema.parse(input);
    const {resolvedAt: _resolvedAt, ...semanticEvidence} = resolution;
    return hashTextToImageContract({...semanticEvidence});
}
