import {z} from "zod";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";

const RawTagFieldSchema = z.string().trim().max(120000).superRefine((value, context) => {
    if (!value) return;
    const tags = value.split(",");
    if (tags.length > 20) {
        context.addIssue({code: "custom", message: "每个视觉字段最多 20 个 tag"});
    }
    tags.forEach((tag, index) => {
        if (!tag.trim()) {
            context.addIssue({code: "custom", path: [index], message: "tag 不能为空"});
        }
    });
});

const CharacterVisualRawFieldsSchema = z.object({
    profileTraits: RawTagFieldSchema,
    facialAppearance: RawTagFieldSchema,
    facialBack: RawTagFieldSchema,
    upperSfw: RawTagFieldSchema,
    upperBackSfw: RawTagFieldSchema,
    lowerSfw: RawTagFieldSchema,
    lowerBackSfw: RawTagFieldSchema,
    upperNsfw: RawTagFieldSchema,
    upperBackNsfw: RawTagFieldSchema,
    lowerNsfw: RawTagFieldSchema,
    lowerBackNsfw: RawTagFieldSchema,
    negativePrompt: RawTagFieldSchema,
}).strict();

const OutfitVisualRawFieldsSchema = z.object({
    upper: RawTagFieldSchema,
    upperBack: RawTagFieldSchema,
    lower: RawTagFieldSchema,
    lowerBack: RawTagFieldSchema,
}).strict();

/** Director 尚未 materialize 的角色视觉 tag 草稿。 */
export const CharacterVisualRawDraftSchema = z.object({
    names: z.object({
        cn: z.string().trim().min(1).max(160),
        en: z.string().trim().min(1).max(160),
    }).strict(),
    fields: CharacterVisualRawFieldsSchema,
}).strict();
export type CharacterVisualRawDraft = z.infer<typeof CharacterVisualRawDraftSchema>;

/** Director 尚未 materialize 的一套服装视觉 tag 草稿。 */
export const OutfitVisualRawDraftSchema = z.object({
    names: z.object({
        cn: z.string().trim().min(1).max(160),
        en: z.string().trim().min(1).max(160),
    }).strict(),
    fields: OutfitVisualRawFieldsSchema,
}).strict();
export type OutfitVisualRawDraft = z.infer<typeof OutfitVisualRawDraftSchema>;

export const CharacterVisualDirectorDiagnosticSchema = z.object({
    code: z.enum(["SOURCE_FACTS_INSUFFICIENT", "AMBIGUOUS_VISUAL_FACT", "UNSUPPORTED_DYNAMIC_CONTENT"]),
    message: z.string().trim().min(1).max(1000),
}).strict();
export type CharacterVisualDirectorDiagnostic = z.infer<typeof CharacterVisualDirectorDiagnosticSchema>;

/** 已通过 policy 的 raw tag 在 materialize 时被排除的可见诊断。 */
export const CharacterVisualDirectWriteDiagnosticSchema = z.object({
    code: z.literal("TAG_REVIEW_EXCLUDED"),
    owner: z.string().trim().min(1).max(500),
    field: z.string().trim().min(1).max(160),
    sourceText: z.string().trim().min(1).max(120000),
    message: z.string().trim().min(1).max(1000),
}).strict();
export type CharacterVisualDirectWriteDiagnostic = z.infer<typeof CharacterVisualDirectWriteDiagnosticSchema>;

/** 浏览器对角色视觉直写操作发起的幂等请求。 */
export const CharacterVisualDirectWriteRequestSchema = z.object({
    projectPath: z.string().trim().min(1).max(500),
    characterPath: z.string()
        .regex(/^lorebook\/character\/[^/\\]+\/index\.md$/u)
        .max(500),
    sourceCharacterFileHash: TextToImageContractHashSchema,
    idempotencyKey: z.string().uuid(),
}).strict();
export type CharacterVisualDirectWriteRequest = z.infer<typeof CharacterVisualDirectWriteRequestSchema>;

/** illustration.director 对一次角色视觉生成的严格输出。 */
export const CharacterVisualDirectorOutputSchema = z.object({
    schemaVersion: z.literal("nbook.character-visual-director-output/v2"),
    operation: z.literal("generate-character-visual"),
    state: z.enum(["completed", "blocked"]),
    sourceCharacterFileHash: TextToImageContractHashSchema,
    summary: z.string().trim().min(1).max(2000),
    character: CharacterVisualRawDraftSchema.nullable(),
    outfits: z.array(OutfitVisualRawDraftSchema).max(64),
    diagnostics: z.array(CharacterVisualDirectorDiagnosticSchema).max(256),
}).strict().superRefine((output, context) => {
    if ((output.character !== null) !== (output.state === "completed")) {
        context.addIssue({code: "custom", path: ["character"], message: "completed 必须包含 character，blocked 必须为 null"});
    }
    if (output.state === "blocked" && output.outfits.length > 0) {
        context.addIssue({code: "custom", path: ["outfits"], message: "blocked 不得包含 outfits"});
    }
});
export type CharacterVisualDirectorOutput = z.infer<typeof CharacterVisualDirectorOutputSchema>;

export const CHARACTER_VISUAL_OPERATION_RUNNING_CODE = "CHARACTER_VISUAL_OPERATION_RUNNING" as const;

export const CHARACTER_VISUAL_DIRECT_WRITE_TERMINAL_ERROR_CODES = [
    "ILLUSTRATION_DIRECTOR_MODEL_NOT_CONFIGURED",
    "CHARACTER_VISUAL_SOURCE_STALE",
    "CHARACTER_VISUAL_TARGET_STALE",
    "CHARACTER_VISUAL_DIRECTOR_FAILED",
    "CHARACTER_VISUAL_DURABLE_INVOCATION_MISSING",
    "CHARACTER_VISUAL_INVOCATION_ORPHANED",
    "CHARACTER_VISUAL_DIRECTOR_OUTPUT_INVALID",
    "CHARACTER_VISUAL_POLICY_BLOCKED",
    "CHARACTER_VISUAL_OUTFIT_NAME_INVALID",
    "CHARACTER_VISUAL_OUTFIT_CONFLICT",
    "CHARACTER_VISUAL_OPERATION_CONFLICT",
] as const;

export const CharacterVisualDirectWriteTerminalErrorCodeSchema = z.enum(CHARACTER_VISUAL_DIRECT_WRITE_TERMINAL_ERROR_CODES);
export const CharacterVisualDirectWriteErrorCodeSchema = z.union([
    CharacterVisualDirectWriteTerminalErrorCodeSchema,
    z.literal(CHARACTER_VISUAL_OPERATION_RUNNING_CODE),
]);
export type CharacterVisualDirectWriteErrorCode = z.infer<typeof CharacterVisualDirectWriteErrorCodeSchema>;

/** 角色视觉直写完成后由 HTTP 返回的唯一成功结果。 */
export const CharacterVisualDirectWriteResultSchema = z.object({
    state: z.literal("completed"),
    operationId: z.string().trim().min(1).max(200),
    sessionId: z.number().int().positive(),
    invocationId: z.string().trim().min(1).max(200),
    characterImageTagsPath: z.string().trim().min(1).max(500),
    outfitPaths: z.array(z.string().trim().min(1).max(500)).max(64),
    diagnostics: z.array(CharacterVisualDirectWriteDiagnosticSchema).max(256),
    fileHashes: z.record(z.string().min(1).max(500), TextToImageContractHashSchema),
}).strict();
export type CharacterVisualDirectWriteResult = z.infer<typeof CharacterVisualDirectWriteResultSchema>;
