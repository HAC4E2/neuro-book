import {z} from "zod";
import {IllustrationCompiledRequestSchema} from "nbook/shared/text-to-image-execution";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";

export const ILLUSTRATION_EXECUTION_PREVIEW_VERSION = "nbook.illustration-execution-preview/v1" as const;
export const ILLUSTRATION_PLACEHOLDER_STATUS_VERSION = "nbook.illustration-placeholder-status/v1" as const;

const StableIdSchema = z.string().trim().min(1).max(200);

/** Preview 只公开用户确认所需摘要，不公开完整 Prompt、secret 或可编辑生成参数。 */
const IllustrationExecutionPreviewRequestSchema = z.object({
    source: IllustrationCompiledRequestSchema.shape.source,
    sourceIdentityHash: TextToImageContractHashSchema,
    model: IllustrationCompiledRequestSchema.shape.model,
    width: z.number().int().min(64).max(4096),
    height: z.number().int().min(64).max(4096),
    seed: z.number().int().min(0).max(4_294_967_295),
    compiledRequestHash: TextToImageContractHashSchema,
    /** P5：高级标量“已生效”标记，供 Preview 展示哪些开关会进入本次生成。 */
    advanced: z.object({
        aiDefaultCharacterPosition: z.boolean(),
        variety: z.boolean(),
        smeaMode: z.enum(["auto", "off", "on"]),
        smeaDyn: z.boolean(),
        decrisper: z.boolean(),
    }).strict(),
    /** P5：参考资源摘要，只公开计数与是否存在 inpaint，不泄 contentHash 以外的信息。 */
    references: z.object({
        vibeCount: z.number().int().min(0).max(16),
        characterCount: z.number().int().min(0).max(1),
        hasInpaint: z.boolean(),
    }).strict(),
}).strict();

/** 单按钮与批量共用的短生命周期、零写入 Execution Preview。 */
export const IllustrationExecutionPreviewSchema = z.object({
    schemaVersion: z.literal(ILLUSTRATION_EXECUTION_PREVIEW_VERSION),
    kind: z.enum(["single", "batch"]),
    previewToken: z.string().trim().min(1).max(4_096),
    expiresAt: z.number().int().positive().safe(),
    targetHash: TextToImageContractHashSchema,
    executionInputHashes: z.array(TextToImageContractHashSchema).min(1).max(32),
    manifestHash: TextToImageContractHashSchema,
    outputCount: z.number().int().min(1).max(32),
    recipe: z.object({
        recipeId: z.string().trim().min(1).max(120),
        title: z.string().trim().min(1).max(200),
        recipeSourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
    }).strict(),
    provider: IllustrationCompiledRequestSchema.shape.provider,
    requests: z.array(IllustrationExecutionPreviewRequestSchema).min(1).max(32),
    knownCost: z.number().nonnegative().nullable(),
    tokenLowerBound: z.number().int().nonnegative().nullable(),
    warnings: z.array(z.string().trim().min(1).max(500)).max(64),
}).strict();

export type IllustrationExecutionPreview = z.infer<typeof IllustrationExecutionPreviewSchema>;

/** 正文 V2 placeholder 可见的有限状态；compiling 是无持久化 Preview 请求的瞬时投影。 */
export const IllustrationPlaceholderStateSchema = z.enum([
    "ready",
    "stale",
    "compiling",
    "queued",
    "running",
    "failed",
    "outcome_unknown",
]);

export type IllustrationPlaceholderState = z.infer<typeof IllustrationPlaceholderStateSchema>;

const IllustrationPlaceholderJobSchema = z.object({
    jobId: StableIdSchema,
    status: z.enum([
        "queued",
        "running",
        "completing",
        "succeeded",
        "failed",
        "canceled",
        "interrupted",
        "configuration_stale",
        "outcome_unknown",
    ]),
    sourceInsertStatus: z.enum(["not_applicable", "pending", "inserted", "missing"]),
    errorCode: z.string().trim().min(1).max(200).nullable(),
    errorMessage: z.string().max(4_000).nullable(),
    updatedAt: z.string().datetime(),
}).strict();

/** GET status 的严格只读投影；Job/Manifest 仍以 Project SQLite 为唯一运行真相源。 */
export const IllustrationPlaceholderStatusSchema = z.object({
    schemaVersion: z.literal(ILLUSTRATION_PLACEHOLDER_STATUS_VERSION),
    placeholderId: StableIdSchema,
    status: IllustrationPlaceholderStateSchema,
    stateHash: TextToImageContractHashSchema,
    /** 只有当前已发布 target 通过结构校验且尚无 Job 时非空。 */
    sourceIdentityHash: TextToImageContractHashSchema.nullable(),
    job: IllustrationPlaceholderJobSchema.nullable(),
    errorCode: z.string().trim().min(1).max(200).nullable(),
    errorMessage: z.string().max(4_000).nullable(),
}).strict().superRefine((status, context) => {
    if (status.status === "ready" && (status.sourceIdentityHash === null || status.job !== null)) {
        context.addIssue({code: "custom", path: ["status"], message: "ready 必须绑定当前 source identity 且没有持久 Job"});
    }
    if (status.job !== null && status.sourceIdentityHash !== null) {
        context.addIssue({code: "custom", path: ["sourceIdentityHash"], message: "持久 Job 状态不能伪装当前 preview source identity"});
    }
});

export type IllustrationPlaceholderStatus = z.infer<typeof IllustrationPlaceholderStatusSchema>;
