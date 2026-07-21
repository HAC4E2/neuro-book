import {z} from "zod";
import {StoryboardStableIdSchema} from "nbook/shared/text-to-image-storyboard-preset";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";

export const PROJECT_OVERLAY_EDITOR_SCHEMA_VERSION = "nbook.project-overlay-editor/v1" as const;
export const ProjectOverlayPresetIdSchema = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);

const NullableHashSchema = TextToImageContractHashSchema.nullable();
const ReviewStateSchema = z.enum(["pending", "approved", "stale", "rejected"]);
const EffectiveStatusSchema = z.enum(["applied", "skipped_stale", "rejected_conflict"]);
const ProjectOverlayDiagnosticSchema = z.object({
    code: z.enum([
        "STORYBOARD_OVERLAY_CONFLICT",
        "STORYBOARD_PRESET_STALE",
        "TAG_PATTERN_SET_STALE",
        "TAG_PATTERN_OVERLAY_CONFLICT",
    ]),
    message: z.string().trim().min(1).max(500),
}).strict();

/** 当前 Global selector 指向的 immutable companion 摘要。 */
export const ProjectOverlayBasePairSchema = z.object({
    presetId: ProjectOverlayPresetIdSchema,
    patternSetId: ProjectOverlayPresetIdSchema,
    packageId: StoryboardStableIdSchema,
    resourceKey: StoryboardStableIdSchema,
    presetPath: z.string().regex(/^storyboard-presets\/[a-z0-9][a-z0-9._-]{0,199}\.md$/u),
    patternPath: z.string().regex(/^tag-patterns\/[a-z0-9][a-z0-9._-]{0,199}\.md$/u),
    storyboardSemanticHash: TextToImageContractHashSchema,
    patternPlanningHash: TextToImageContractHashSchema,
    patternRenderHash: TextToImageContractHashSchema,
    presetFileHash: TextToImageContractHashSchema,
    patternFileHash: TextToImageContractHashSchema,
}).strict();
export type ProjectOverlayBasePair = z.infer<typeof ProjectOverlayBasePairSchema>;

const ProjectStoryboardOverlayEditorSchema = z.object({
    kind: z.literal("storyboard"),
    path: z.string().regex(/^agents\/illustration\.director\/storyboard-overrides\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.md$/u),
    exists: z.boolean(),
    markdown: z.string().max(4 * 1024 * 1024),
    fileHash: NullableHashSchema,
    semanticHash: TextToImageContractHashSchema,
    reviewState: ReviewStateSchema,
    operationCount: z.number().int().min(0).max(10000),
    effectiveStatus: EffectiveStatusSchema,
    effectivePresetHash: TextToImageContractHashSchema,
    diagnostics: z.array(ProjectOverlayDiagnosticSchema).max(10000),
}).strict();

const ProjectTagPatternOverlayEditorSchema = z.object({
    kind: z.literal("patterns"),
    path: z.string().regex(/^agents\/illustration\.director\/tag-pattern-overrides\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.md$/u),
    exists: z.boolean(),
    markdown: z.string().max(16 * 1024 * 1024),
    fileHash: NullableHashSchema,
    planningHash: TextToImageContractHashSchema,
    renderHash: TextToImageContractHashSchema,
    reviewState: ReviewStateSchema,
    operationCount: z.number().int().min(0).max(10000),
    effectiveStatus: EffectiveStatusSchema,
    effectivePlanningHash: TextToImageContractHashSchema,
    effectiveRenderHash: TextToImageContractHashSchema,
    diagnostics: z.array(ProjectOverlayDiagnosticSchema).max(10000),
}).strict();

/** 文生图分页读取的 Project overlay 单一编辑快照。 */
export const ProjectOverlayEditorSnapshotSchema = z.object({
    schemaVersion: z.literal(PROJECT_OVERLAY_EDITOR_SCHEMA_VERSION),
    projectPath: z.string().trim().min(1).max(500),
    base: ProjectOverlayBasePairSchema,
    storyboard: ProjectStoryboardOverlayEditorSchema,
    patterns: ProjectTagPatternOverlayEditorSchema,
}).strict();
export type ProjectOverlayEditorSnapshot = z.infer<typeof ProjectOverlayEditorSnapshotSchema>;

/** Project overlay 保存入口；路径、base bytes、actor 与批准 hash 均由服务端决定。 */
export const ProjectOverlaySaveRequestSchema = z.object({
    projectPath: z.string().trim().min(1).max(500),
    presetId: ProjectOverlayPresetIdSchema,
    kind: z.enum(["storyboard", "patterns"]),
    markdown: z.string().min(1).max(16 * 1024 * 1024),
    expectedFileHash: NullableHashSchema,
    mode: z.enum(["draft", "apply"]),
}).strict();
export type ProjectOverlaySaveRequest = z.infer<typeof ProjectOverlaySaveRequestSchema>;
