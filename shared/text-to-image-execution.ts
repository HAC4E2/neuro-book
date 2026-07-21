import {z} from "zod";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {ProviderCapabilitySnapshotSchema, NovelAiProviderModelIdSchema} from "nbook/shared/text-to-image-provider-registry";
import {TextToImageRecipeSnapshotSchema} from "nbook/shared/text-to-image-recipe";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";
import {TextToImageReferenceSelectionSchema} from "nbook/shared/text-to-image-reference-asset";

export const ILLUSTRATION_COMPILED_REQUEST_SCHEMA_VERSION = "nbook.illustration-compiled-request/v1" as const;
export const ILLUSTRATION_EXECUTION_INPUT_SCHEMA_VERSION = "nbook.illustration-execution-input/v1" as const;
export const ILLUSTRATION_EXECUTION_MANIFEST_SCHEMA_VERSION = "nbook.illustration-execution-manifest/v1" as const;

const StableIdSchema = z.string().trim().min(1).max(200);
const ChapterPathSchema = z.string().regex(/^manuscript\/.+\/index\.md$/u);

export const IllustrationExecutionSourceSchema = z.object({
    projectId: StableIdSchema,
    chapterPath: ChapterPathSchema,
    placeholderId: StableIdSchema,
    shotId: StableIdSchema,
    shotOrigin: z.enum(["chapter-plan", "selection"]),
    anchorId: StableIdSchema,
    shotIntentHash: TextToImageContractHashSchema,
    sourceChapterHash: TextToImageContractHashSchema,
}).strict();

export type IllustrationExecutionSource = z.infer<typeof IllustrationExecutionSourceSchema>;

/** button origin 的稳定来源身份；seed、Job idempotency 与 lineage fence 共用。 */
export function createIllustrationExecutionSourceIdentityHash(input: IllustrationExecutionSource): string {
    const source = IllustrationExecutionSourceSchema.parse(input);
    return createTextToImageJobSourceIdentityHash({
        kind: "button",
        chapterPath: source.chapterPath,
        placeholderId: source.placeholderId,
        shotId: source.shotId,
        shotOrigin: source.shotOrigin,
    });
}

/** 所有生成来源的严格判别联合；不同来源不得伪造 button placeholder。 */
export const TextToImageJobOriginSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("button"),
        chapterPath: ChapterPathSchema,
        placeholderId: StableIdSchema,
        shotId: StableIdSchema,
        shotOrigin: z.enum(["chapter-plan", "selection"]),
    }).strict(),
    z.object({kind: z.literal("manual"), manualRequestId: StableIdSchema}).strict(),
    z.object({
        kind: z.literal("character"),
        characterId: StableIdSchema,
        characterRevisionHash: TextToImageContractHashSchema,
        purpose: z.string().trim().min(1).max(500),
    }).strict(),
    z.object({kind: z.literal("retry"), parentJobId: StableIdSchema, retryOrdinal: z.number().int().positive().max(1_000)}).strict(),
    z.object({
        kind: z.literal("reroll"),
        parentAssetId: StableIdSchema,
        variantIndex: z.number().int().min(1).max(31),
        reason: z.string().trim().min(1).max(500),
    }).strict(),
]);

export type TextToImageJobOrigin = z.infer<typeof TextToImageJobOriginSchema>;

/** 来源身份只覆盖判别联合本身；Recipe/Provider/Shot hash 属于 executionInputHash。 */
export function createTextToImageJobSourceIdentityHash(input: TextToImageJobOrigin): string {
    return hashTextToImageContract({
        schemaVersion: "nbook.text-to-image-job-source-identity/v1",
        origin: TextToImageJobOriginSchema.parse(input),
    });
}

export const IllustrationExecutionProviderSchema = z.object({
    ownerUserId: z.number().int().positive().safe(),
    providerId: z.number().int().positive().safe(),
    credentialRevision: z.number().int().positive().safe(),
}).strict();

export const IllustrationPatternExpansionSchema = z.object({
    patternId: StableIdSchema,
    renderHash: TextToImageContractHashSchema,
}).strict();

export const IllustrationCharacterExpansionSchema = z.object({
    characterId: StableIdSchema,
    renderTagFactsHash: TextToImageContractHashSchema,
    outfits: z.array(z.object({
        path: z.string().trim().min(1).max(500),
        renderTagFactsHash: TextToImageContractHashSchema,
    }).strict()).max(32),
}).strict();

const CompiledTagSourceSchema = z.object({
    kind: z.enum(["pattern", "shot-prefer", "shot-avoid", "character", "outfit", "recipe-style"]),
    sourceId: StableIdSchema,
}).strict();

/** Compiler 审计用的单个最终普通 Tag；wireText 已包含规范数值权重。 */
export const IllustrationCompiledTagSchema = z.object({
    wireText: z.string().trim().min(1).max(600),
    semanticText: z.string().trim().min(1).max(500),
    resolutionHashes: z.array(TextToImageContractHashSchema).min(1).max(64),
    weight: z.number().min(0.1).max(2),
    mandatory: z.boolean(),
    sources: z.array(CompiledTagSourceSchema).min(1).max(64),
}).strict();

const IllustrationCompiledCharacterSchema = z.object({
    characterId: StableIdSchema,
    center: z.object({x: z.number().min(0).max(1), y: z.number().min(0).max(1)}).strict(),
    prompt: z.string(),
    negativePrompt: z.string(),
}).strict();

const IllustrationExpansionSnapshotSchema = z.object({
    patternSnapshots: z.array(IllustrationPatternExpansionSchema).max(3),
    characterSnapshots: z.array(IllustrationCharacterExpansionSchema).max(8),
    resolutionValidationHash: TextToImageContractHashSchema,
    positive: z.array(IllustrationCompiledTagSchema).max(2048),
    negative: z.array(IllustrationCompiledTagSchema).max(2048),
    characters: z.array(z.object({
        characterId: StableIdSchema,
        positive: z.array(IllustrationCompiledTagSchema).max(1024),
        negative: z.array(IllustrationCompiledTagSchema).max(1024),
    }).strict()).max(8),
}).strict();

const IllustrationCompiledRequestBaseSchema = z.object({
    schemaVersion: z.literal(ILLUSTRATION_COMPILED_REQUEST_SCHEMA_VERSION),
    compilerVersion: StableIdSchema,
    executionPolicyVersion: StableIdSchema,
    providerKind: z.literal("novelai"),
    source: IllustrationExecutionSourceSchema,
    provider: IllustrationExecutionProviderSchema,
    capabilitySnapshot: ProviderCapabilitySnapshotSchema,
    model: NovelAiProviderModelIdSchema,
    action: z.literal("generate"),
    prompt: z.string().trim().min(1).max(200_000),
    negativePrompt: z.string().max(200_000),
    characterPrompts: z.array(IllustrationCompiledCharacterSchema).max(8),
    parameters: z.object({
        sampler: z.string().trim().min(1).max(80),
        noiseSchedule: z.string().trim().min(1).max(80),
        steps: z.number().int().min(1).max(50),
        promptGuidance: z.number().min(0).max(20),
        promptGuidanceRescale: z.number().min(0).max(1),
        width: z.number().int().min(64).max(4096),
        height: z.number().int().min(64).max(4096),
        seed: z.number().int().min(0).max(4_294_967_295),
        count: z.literal(1),
        aiDefaultCharacterPosition: z.boolean(),
        variety: z.boolean(),
        smeaMode: z.enum(["auto", "off", "on"]),
        smeaDyn: z.boolean(),
        decrisper: z.boolean(),
        qualityToggle: z.boolean(),
        ucPreset: z.number().int().min(0).max(4),
    }).strict(),
    /** P5 参考资源：Compiler 冻结后的 contentHash + 权重；不含 bytes。 */
    references: z.object({
        /** NovelAI 归一化 Vibe 权重开关；Compiler 默认开启。 */
        normalizeVibeStrengths: z.boolean(),
        vibeReferences: z.array(TextToImageReferenceSelectionSchema).max(16),
        characterReferences: z.array(TextToImageReferenceSelectionSchema).max(1),
        inpaint: TextToImageReferenceSelectionSchema.nullable(),
    }).strict(),
    recipeSnapshot: TextToImageRecipeSnapshotSchema,
    expansion: IllustrationExpansionSnapshotSchema,
}).strict();

export type IllustrationCompiledRequestBase = z.infer<typeof IllustrationCompiledRequestBaseSchema>;

/** CompiledRequest 自带内容 hash，Job/adapter 只能消费通过此 schema 的 snapshot。 */
export const IllustrationCompiledRequestSchema = IllustrationCompiledRequestBaseSchema.extend({
    compiledRequestHash: TextToImageContractHashSchema,
}).strict().superRefine((request, context) => {
    const {compiledRequestHash, ...base} = request;
    if (compiledRequestHash !== createIllustrationCompiledRequestHash(base)) {
        context.addIssue({code: "custom", path: ["compiledRequestHash"], message: "compiledRequestHash 与请求内容不一致"});
    }
    if (request.capabilitySnapshot.modelScope.kind !== "novelai-model"
        || request.capabilitySnapshot.modelScope.modelId !== request.model) {
        context.addIssue({code: "custom", path: ["capabilitySnapshot", "modelScope"], message: "capability snapshot 必须绑定 CompiledRequest model"});
    }
});

export type IllustrationCompiledRequest = z.infer<typeof IllustrationCompiledRequestSchema>;

/** 对完整、已规范化的上游请求计算语义 hash。 */
export function createIllustrationCompiledRequestHash(input: IllustrationCompiledRequestBase): string {
    return hashTextToImageContract(IllustrationCompiledRequestBaseSchema.parse(input));
}

const IllustrationExecutionInputSchema = z.object({
    schemaVersion: z.literal(ILLUSTRATION_EXECUTION_INPUT_SCHEMA_VERSION),
    source: IllustrationExecutionSourceSchema,
    publicationJournalId: StableIdSchema,
    patternSnapshots: z.array(IllustrationPatternExpansionSchema).max(3),
    characterSnapshots: z.array(IllustrationCharacterExpansionSchema).max(8),
    recipeSnapshot: TextToImageRecipeSnapshotSchema,
    provider: IllustrationExecutionProviderSchema,
    capabilitySnapshot: ProviderCapabilitySnapshotSchema,
    resolutionValidationHash: TextToImageContractHashSchema,
    executionNonce: StableIdSchema,
    variantIndex: z.number().int().min(0).max(31),
    outputIndex: z.number().int().min(0).max(31),
    outputCount: z.number().int().min(1).max(32),
    seed: z.number().int().min(0).max(4_294_967_295),
    compilerVersion: StableIdSchema,
    executionPolicyVersion: StableIdSchema,
}).strict();

export type IllustrationExecutionInput = Omit<z.infer<typeof IllustrationExecutionInputSchema>, "schemaVersion">;

/** executionInputHash 只覆盖当前 target 的全部服务端执行事实，不含 secret。 */
export function createIllustrationExecutionInputHash(input: IllustrationExecutionInput): string {
    return hashTextToImageContract(IllustrationExecutionInputSchema.parse({
        schemaVersion: ILLUSTRATION_EXECUTION_INPUT_SCHEMA_VERSION,
        ...input,
    }));
}

const IllustrationExecutionManifestHashInputSchema = z.object({
    schemaVersion: z.literal(ILLUSTRATION_EXECUTION_MANIFEST_SCHEMA_VERSION),
    executionInputHashes: z.array(TextToImageContractHashSchema).min(1).max(32),
    recipeSnapshot: TextToImageRecipeSnapshotSchema,
    compiledRequests: z.array(IllustrationCompiledRequestSchema).min(1).max(32),
    outputCount: z.number().int().min(1).max(32),
    knownCost: z.number().nonnegative().nullable(),
    tokenLowerBound: z.number().int().nonnegative().nullable(),
}).strict();

export type IllustrationExecutionManifestHashInput = Omit<z.infer<typeof IllustrationExecutionManifestHashInputSchema>, "schemaVersion">;

/** 候选 manifest hash；Task 7 授权事务会把同一值写入 immutable Manifest。 */
export function createIllustrationExecutionManifestHash(input: IllustrationExecutionManifestHashInput): string {
    return hashTextToImageContract(IllustrationExecutionManifestHashInputSchema.parse({
        schemaVersion: ILLUSTRATION_EXECUTION_MANIFEST_SCHEMA_VERSION,
        ...input,
    }));
}

/** 用户确认时唯一可提交的输出/费用/Token 上限；null 表示对应预算当前不可得。 */
export const IllustrationExecutionAuthorizationSchema = z.object({
    authorizedOutputCount: z.number().int().min(1).max(32),
    authorizedCostLimit: z.number().nonnegative().nullable(),
    authorizedTokenLimit: z.number().int().nonnegative().nullable(),
}).strict();

export type IllustrationExecutionAuthorization = z.infer<typeof IllustrationExecutionAuthorizationSchema>;

const IllustrationExecutionApprovalHashInputSchema = z.object({
    schemaVersion: z.literal("nbook.illustration-execution-approval/v1"),
    executionManifestHash: TextToImageContractHashSchema,
    authorization: IllustrationExecutionAuthorizationSchema,
    actorUserId: z.number().int().positive().safe(),
    approvedAt: z.string().datetime(),
}).strict();

export type IllustrationExecutionApprovalHashInput = Omit<
    z.infer<typeof IllustrationExecutionApprovalHashInputSchema>,
    "schemaVersion"
>;

/** Approval hash 绑定 manifest、精确上限、actor 与授权时间。 */
export function createIllustrationExecutionApprovalHash(input: IllustrationExecutionApprovalHashInput): string {
    return hashTextToImageContract(IllustrationExecutionApprovalHashInputSchema.parse({
        schemaVersion: "nbook.illustration-execution-approval/v1",
        ...input,
    }));
}

/** 原子注册成功后的稳定 receipt；重复 authorize 必须返回同一份内容。 */
export const IllustrationExecutionRegistrationReceiptSchema = z.object({
    schemaVersion: z.literal("nbook.illustration-execution-registration-receipt/v1"),
    manifestId: StableIdSchema,
    executionManifestHash: TextToImageContractHashSchema,
    approvalId: StableIdSchema,
    approvalHash: TextToImageContractHashSchema,
    registrationState: z.literal("jobs_registered"),
    dispatchState: z.enum(["ready", "dispatch_pending"]),
    jobIds: z.array(StableIdSchema).min(1).max(32),
    dispatchKeys: z.array(TextToImageContractHashSchema).min(1).max(32),
    registeredAt: z.string().datetime(),
}).strict();

export type IllustrationExecutionRegistrationReceipt = z.infer<typeof IllustrationExecutionRegistrationReceiptSchema>;
