import {z} from "zod";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {StoryboardStableIdSchema} from "nbook/shared/text-to-image-storyboard-preset";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";

export const STORYBOARD_GLOBAL_PUBLISH_PREVIEW_SCHEMA_VERSION = "nbook.storyboard-global-publish-preview/v1" as const;
export const STORYBOARD_GLOBAL_PUBLISH_RECEIPT_SCHEMA_VERSION = "nbook.storyboard-global-publish-receipt/v1" as const;

const ProfileResourcePathSchema = z.string().regex(/^(storyboard-presets|tag-patterns)\/[a-z0-9][a-z0-9._-]{0,199}\.md$/u);

/** 发布目标必须显式确认替换当前逻辑 preset，或给出新的逻辑 presetId。 */
export const StoryboardPublishTargetSchema = z.discriminatedUnion("mode", [
    z.object({
        mode: z.literal("candidate"),
        confirmReplaceActive: z.boolean(),
    }).strict(),
    z.object({
        mode: z.literal("save_as"),
        presetId: StoryboardStableIdSchema,
    }).strict(),
]);
export type StoryboardPublishTarget = z.infer<typeof StoryboardPublishTargetSchema>;

export const StoryboardPublishedPairSchema = z.object({
    presetId: StoryboardStableIdSchema,
    patternSetId: StoryboardStableIdSchema,
    packageId: StoryboardStableIdSchema,
    resourceKey: StoryboardStableIdSchema,
    storyboardSemanticHash: TextToImageContractHashSchema,
    patternPlanningHash: TextToImageContractHashSchema,
    patternRenderHash: TextToImageContractHashSchema,
    presetPath: ProfileResourcePathSchema,
    patternPath: ProfileResourcePathSchema,
}).strict().superRefine((pair, context) => {
    if (pair.presetId !== pair.patternSetId) {
        context.addIssue({code: "custom", path: ["patternSetId"], message: "published companion 必须共享逻辑 identity"});
    }
    const expectedPresetPath = `storyboard-presets/${pair.resourceKey}.md`;
    const expectedPatternPath = `tag-patterns/${pair.resourceKey}.md`;
    if (pair.presetPath !== expectedPresetPath) {
        context.addIssue({code: "custom", path: ["presetPath"], message: "presetPath 必须由 resourceKey 派生"});
    }
    if (pair.patternPath !== expectedPatternPath) {
        context.addIssue({code: "custom", path: ["patternPath"], message: "patternPath 必须由 resourceKey 派生"});
    }
});
export type StoryboardPublishedPair = z.infer<typeof StoryboardPublishedPairSchema>;

export const StoryboardActivePairSchema = StoryboardPublishedPairSchema.extend({
    presetFileHash: TextToImageContractHashSchema,
    patternFileHash: TextToImageContractHashSchema,
}).strict();
export type StoryboardActivePair = z.infer<typeof StoryboardActivePairSchema>;

const StoryboardGlobalPublishPreviewBaseSchema = z.object({
    schemaVersion: z.literal(STORYBOARD_GLOBAL_PUBLISH_PREVIEW_SCHEMA_VERSION),
    state: z.enum(["ready", "conflict"]),
    importId: StoryboardStableIdSchema,
    target: StoryboardPublishTargetSchema,
    sourceCandidatePackageHash: TextToImageContractHashSchema,
    publishedCandidatePackageHash: TextToImageContractHashSchema,
    diagnosticHash: TextToImageContractHashSchema,
    published: StoryboardPublishedPairSchema,
    previousSelectorKey: ProfileResourcePathSchema,
    active: StoryboardActivePairSchema.nullable(),
    expected: z.object({
        activePresetFileHash: TextToImageContractHashSchema.nullable(),
        activePatternFileHash: TextToImageContractHashSchema.nullable(),
        globalConfigHash: TextToImageContractHashSchema,
    }).strict(),
    conflict: z.object({
        code: z.literal("PRESET_ID_CONFLICT"),
        activePresetId: StoryboardStableIdSchema,
        message: z.string().trim().min(1).max(500),
    }).strict().nullable(),
    confirmGlobalRequired: z.literal(true),
}).strict();

/** 计算发布预览 token；token 自身不进入 hash。 */
export function createStoryboardGlobalPublishPreviewToken(
    input: z.input<typeof StoryboardGlobalPublishPreviewBaseSchema> & {publishPreviewToken?: string},
): string {
    const {publishPreviewToken: _publishPreviewToken, ...candidate} = input;
    return hashTextToImageContract(StoryboardGlobalPublishPreviewBaseSchema.parse(candidate));
}

/** 无副作用发布预览，绑定 pair、冲突选择与三个 expected hash。 */
export const StoryboardGlobalPublishPreviewSchema = StoryboardGlobalPublishPreviewBaseSchema.extend({
    publishPreviewToken: TextToImageContractHashSchema,
}).strict().superRefine((preview, context) => {
    if ((preview.state === "conflict") !== (preview.conflict !== null)) {
        context.addIssue({code: "custom", path: ["state"], message: "conflict state 与冲突证据不一致"});
    }
    if (preview.publishPreviewToken !== createStoryboardGlobalPublishPreviewToken(preview)) {
        context.addIssue({code: "custom", path: ["publishPreviewToken"], message: "publishPreviewToken 与当前发布事实不一致"});
    }
});
export type StoryboardGlobalPublishPreview = z.infer<typeof StoryboardGlobalPublishPreviewSchema>;

/** 发布预览请求只选择逻辑目标，不允许客户端提交目标路径或 pair bytes。 */
export const StoryboardGlobalPublishPreviewRequestSchema = z.object({
    projectPath: z.string().trim().min(1).max(500),
    importId: StoryboardStableIdSchema,
    expectedResolvedPreviewToken: TextToImageContractHashSchema,
    target: StoryboardPublishTargetSchema,
}).strict();
export type StoryboardGlobalPublishPreviewRequest = z.infer<typeof StoryboardGlobalPublishPreviewRequestSchema>;

/** 真正发布必须回显 preview 中的全部并发保护事实并显式确认 global scope。 */
export const StoryboardGlobalPublishRequestSchema = StoryboardGlobalPublishPreviewRequestSchema.extend({
    publishPreviewToken: TextToImageContractHashSchema,
    candidatePackageHash: TextToImageContractHashSchema,
    diagnosticHash: TextToImageContractHashSchema,
    expectedActivePresetFileHash: TextToImageContractHashSchema.nullable(),
    expectedActivePatternFileHash: TextToImageContractHashSchema.nullable(),
    expectedGlobalConfigHash: TextToImageContractHashSchema,
    targetScope: z.literal("global"),
    confirmGlobal: z.literal(true),
}).strict();
export type StoryboardGlobalPublishRequest = z.infer<typeof StoryboardGlobalPublishRequestSchema>;

export const StoryboardGlobalPublishReceiptSchema = z.object({
    schemaVersion: z.literal(STORYBOARD_GLOBAL_PUBLISH_RECEIPT_SCHEMA_VERSION),
    publishId: StoryboardStableIdSchema,
    importId: StoryboardStableIdSchema,
    state: z.enum(["published_not_selected", "completed"]),
    published: StoryboardPublishedPairSchema,
    previousSelectorKey: ProfileResourcePathSchema,
    currentSelectorKey: ProfileResourcePathSchema,
    retryExpectedGlobalConfigHash: TextToImageContractHashSchema.nullable(),
    publishedAt: z.string().datetime({offset: true}),
    completedAt: z.string().datetime({offset: true}).nullable(),
}).strict().superRefine((receipt, context) => {
    if ((receipt.state === "published_not_selected") !== (receipt.retryExpectedGlobalConfigHash !== null)) {
        context.addIssue({code: "custom", path: ["retryExpectedGlobalConfigHash"], message: "只有 published_not_selected 可重试 selector"});
    }
});
export type StoryboardGlobalPublishReceipt = z.infer<typeof StoryboardGlobalPublishReceiptSchema>;

/** 已发布两份 immutable files 后，只重试 selector CAS 的显式请求。 */
export const StoryboardGlobalSelectorRetryRequestSchema = z.object({
    projectPath: z.string().trim().min(1).max(500),
    importId: StoryboardStableIdSchema,
    publishId: StoryboardStableIdSchema,
    expectedActivePresetFileHash: TextToImageContractHashSchema.nullable(),
    expectedActivePatternFileHash: TextToImageContractHashSchema.nullable(),
    expectedGlobalConfigHash: TextToImageContractHashSchema,
    targetScope: z.literal("global"),
    confirmGlobal: z.literal(true),
}).strict();
export type StoryboardGlobalSelectorRetryRequest = z.infer<typeof StoryboardGlobalSelectorRetryRequestSchema>;
