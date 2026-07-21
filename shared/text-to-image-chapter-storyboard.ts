import {z} from "zod";
import {hashTextToImageContract, type TextToImageContractValue} from "nbook/shared/text-to-image-contract-hash";
import {
    IllustrationAnchorIdSchema,
    IllustrationPlanningOperationSchema,
    IllustrationPlanningTagQuerySnapshotSchema,
} from "nbook/shared/text-to-image-illustration-planning";
import {StoryboardStableIdSchema} from "nbook/shared/text-to-image-storyboard-preset";
import {
    SemanticTagResolutionSchema,
    TextToImageContractHashSchema,
    TextToImageModelScopeSchema,
} from "nbook/shared/text-to-image-tag-resolution";

export const CHAPTER_ILLUSTRATION_STORYBOARD_SCHEMA = "nbook.chapter-illustrations/v2" as const;

const StableVersionSchema = z.string().trim().min(1).max(160);
const ChapterSegmentSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u);
const ChapterPathSchema = z.string().superRefine((path, context) => {
    const segments = path.split("/");
    if (
        segments.length !== 4
        || segments[0] !== "manuscript"
        || segments[3] !== "index.md"
        || !ChapterSegmentSchema.safeParse(segments[1]).success
        || !ChapterSegmentSchema.safeParse(segments[2]).success
    ) {
        context.addIssue({
            code: "custom",
            message: "chapterPath 必须是 manuscript/<volume>/<chapter>/index.md",
        });
    }
});

const RecipeKeySchema = z.string().regex(
    /^lorebook\/instruction\/text-to-image\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}\/index\.md$/u,
);

/** 一次 Planning Apply 在 Storyboard 中的可执行发布投影。 */
export const ChapterIllustrationPublicationSchema = z.object({
    journalId: StoryboardStableIdSchema,
    status: z.enum(["pending", "applied"]),
    /** pending 时固定为空；applied 时记录该批次完成发布的 UTC 时间。 */
    appliedAt: z.string().datetime().nullable(),
}).strict().superRefine((publication, context) => {
    if (publication.status === "pending" && publication.appliedAt !== null) {
        context.addIssue({code: "custom", path: ["appliedAt"], message: "pending publication 不能携带 appliedAt"});
    }
    if (publication.status === "applied" && publication.appliedAt === null) {
        context.addIssue({code: "custom", path: ["appliedAt"], message: "applied publication 必须携带 appliedAt"});
    }
});

const ChapterIllustrationSelectionSchema = z.object({
    selectionHash: TextToImageContractHashSchema,
    startAnchorId: IllustrationAnchorIdSchema,
    endAnchorId: IllustrationAnchorIdSchema,
    insertAfterAnchorId: IllustrationAnchorIdSchema,
}).strict();

const ChapterIllustrationTagQuerySnapshotSchema = IllustrationPlanningTagQuerySnapshotSchema.extend({
    providerKind: z.literal("novelai"),
    modelScope: TextToImageModelScopeSchema,
    resultHash: TextToImageContractHashSchema,
}).strict();

/** 单次 Planning Run 发布到章节聚合中的全部冻结事实。 */
export const ChapterIllustrationPlanningSourceSchema = z.object({
    planningRunId: StoryboardStableIdSchema,
    operation: IllustrationPlanningOperationSchema,
    state: z.enum(["active", "stale", "superseded"]),
    publication: ChapterIllustrationPublicationSchema,
    chapterFileHashAtPlan: TextToImageContractHashSchema,
    planningRequestHash: TextToImageContractHashSchema,
    planningInputHash: TextToImageContractHashSchema,
    planningEvidenceHash: TextToImageContractHashSchema,
    sourceChapterHashAtPlan: TextToImageContractHashSchema,
    /** 仅 plan-selection 非空，且只保存稳定选区身份与可信锚点。 */
    selection: ChapterIllustrationSelectionSchema.nullable(),
    effectivePreset: z.object({
        presetId: StoryboardStableIdSchema,
        semanticHash: TextToImageContractHashSchema,
    }).strict(),
    effectivePatternSet: z.object({
        patternSetId: StoryboardStableIdSchema,
        planningHash: TextToImageContractHashSchema,
        candidateSetHash: TextToImageContractHashSchema,
    }).strict(),
    recipePlanningConstraints: z.object({
        key: RecipeKeySchema,
        constraintsHash: TextToImageContractHashSchema,
        capabilitySummaryHash: TextToImageContractHashSchema,
    }).strict(),
    tagQuerySnapshot: ChapterIllustrationTagQuerySnapshotSchema,
    director: z.object({
        profileVersion: StableVersionSchema,
        operationVersion: StableVersionSchema,
        modelConfigFingerprint: TextToImageContractHashSchema,
    }).strict(),
    contentBlockParserVersion: StableVersionSchema,
    planValidatorVersion: StableVersionSchema,
    systemPolicyVersion: StableVersionSchema,
    visualPlanningFactsHash: TextToImageContractHashSchema,
    contextSnapshotHash: TextToImageContractHashSchema,
    planPolicyHash: TextToImageContractHashSchema,
}).strict().superRefine((source, context) => {
    if (source.operation === "plan-selection" && source.selection === null) {
        context.addIssue({code: "custom", path: ["selection"], message: "plan-selection 必须保存 selection 身份"});
    }
    if (source.operation === "plan-chapter" && source.selection !== null) {
        context.addIssue({code: "custom", path: ["selection"], message: "plan-chapter 不能保存 selection 身份"});
    }
});

const ControlledConceptSchema = StoryboardStableIdSchema;
const OutfitRefSchema = z.string().regex(
    /^lorebook\/character\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}\/outfits\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.md$/u,
);

/** 已通过服务端 closure 校验并冻结到章节聚合中的镜头语义。 */
export const ChapterIllustrationShotSchema = z.object({
    shotId: StoryboardStableIdSchema,
    state: z.enum(["active", "stale", "superseded"]),
    shotIntentHash: TextToImageContractHashSchema,
    placeholderId: StoryboardStableIdSchema,
    publication: ChapterIllustrationPublicationSchema,
    origin: z.object({
        kind: z.enum(["chapter-plan", "selection"]),
        planningRunId: StoryboardStableIdSchema,
    }).strict(),
    anchorId: IllustrationAnchorIdSchema,
    insertAfterAnchorId: IllustrationAnchorIdSchema,
    purpose: z.string().trim().min(1).max(500),
    characterIds: z.array(StoryboardStableIdSchema).max(8),
    outfitRefs: z.array(OutfitRefSchema).max(16),
    action: z.record(StoryboardStableIdSchema, ControlledConceptSchema),
    composition: z.object({
        shotSize: z.enum(["close-up", "medium", "wide"]),
        cameraAngle: z.enum(["low", "eye-level", "high"]),
        viewpoint: z.enum(["first-person", "third-person"]),
        canvasIntent: z.enum(["portrait", "landscape", "square"]),
        subjectPlacement: ControlledConceptSchema,
    }).strict(),
    continuity: z.object({
        timeOfDay: ControlledConceptSchema,
        palette: ControlledConceptSchema,
    }).strict(),
    tagPatternRefs: z.array(StoryboardStableIdSchema).max(3),
    tagResolutions: z.record(StoryboardStableIdSchema, SemanticTagResolutionSchema),
    tagDelta: z.object({
        prefer: z.array(StoryboardStableIdSchema).max(8),
        avoid: z.array(StoryboardStableIdSchema).max(8),
    }).strict(),
}).strict().superRefine((shot, context) => {
    addUniqueIssues(shot.characterIds, ["characterIds"], "characterId", context);
    addUniqueIssues(shot.outfitRefs, ["outfitRefs"], "outfitRef", context);
    addUniqueIssues(shot.tagPatternRefs, ["tagPatternRefs"], "tagPatternRef", context);
    const resolutionRefs = [...shot.tagDelta.prefer, ...shot.tagDelta.avoid];
    addUniqueIssues(resolutionRefs, ["tagDelta"], "Tag resolution ref", context);
    const resolutionKeys = Object.keys(shot.tagResolutions);
    for (const resolutionRef of resolutionRefs) {
        if (!(resolutionRef in shot.tagResolutions)) {
            context.addIssue({code: "custom", path: ["tagDelta"], message: `Tag ref 未冻结 resolution：${resolutionRef}`});
        }
    }
    for (const resolutionKey of resolutionKeys) {
        if (!resolutionRefs.includes(resolutionKey)) {
            context.addIssue({code: "custom", path: ["tagResolutions", resolutionKey], message: `unused resolution snapshot：${resolutionKey}`});
        }
    }
});

const ChapterIllustrationStoryboardBaseSchema = z.object({
    schema: z.literal(CHAPTER_ILLUSTRATION_STORYBOARD_SCHEMA),
    chapterPath: ChapterPathSchema,
    revisionId: StoryboardStableIdSchema,
    sourceChapterHash: TextToImageContractHashSchema,
    planHash: TextToImageContractHashSchema,
    planningSources: z.array(ChapterIllustrationPlanningSourceSchema).max(1000),
    shots: z.array(ChapterIllustrationShotSchema).max(1000),
}).strict();

export type ChapterIllustrationStoryboard = z.infer<typeof ChapterIllustrationStoryboardBaseSchema>;
export type ChapterIllustrationPlanningSource = z.infer<typeof ChapterIllustrationPlanningSourceSchema>;
export type ChapterIllustrationShot = z.infer<typeof ChapterIllustrationShotSchema>;

/**
 * 章节 Storyboard 的严格 V2 真相源。
 *
 * 这里同时关闭跨 run 引用、publication 批次错配和 planHash 伪造出口。
 */
export const ChapterIllustrationStoryboardSchema = ChapterIllustrationStoryboardBaseSchema.superRefine((storyboard, context) => {
    const sources = new Map<string, ChapterIllustrationPlanningSource>();
    storyboard.planningSources.forEach((source, index) => {
        if (sources.has(source.planningRunId)) {
            context.addIssue({code: "custom", path: ["planningSources", index, "planningRunId"], message: "planningRunId 不能重复"});
        }
        sources.set(source.planningRunId, source);
    });
    addUniqueIssues(storyboard.shots.map((shot) => shot.shotId), ["shots"], "shotId", context);
    addUniqueIssues(storyboard.shots.map((shot) => shot.placeholderId), ["shots"], "placeholderId", context);

    const shotCounts = new Map<string, number>();
    storyboard.shots.forEach((shot, index) => {
        const source = sources.get(shot.origin.planningRunId);
        if (!source) {
            context.addIssue({code: "custom", path: ["shots", index, "origin", "planningRunId"], message: "origin planningRunId 不存在"});
            return;
        }
        const expectedKind = source.operation === "plan-chapter" ? "chapter-plan" : "selection";
        if (shot.origin.kind !== expectedKind) {
            context.addIssue({code: "custom", path: ["shots", index, "origin", "kind"], message: "origin kind 与 Planning operation 不一致"});
        }
        if (shot.state !== source.state) {
            context.addIssue({code: "custom", path: ["shots", index, "state"], message: "shot state 与所属 planning source 不一致"});
        }
        if (
            shot.publication.journalId !== source.publication.journalId
            || shot.publication.status !== source.publication.status
            || shot.publication.appliedAt !== source.publication.appliedAt
        ) {
            context.addIssue({code: "custom", path: ["shots", index, "publication"], message: "shot publication 与所属 planning source 不一致"});
        }
        shotCounts.set(source.planningRunId, (shotCounts.get(source.planningRunId) ?? 0) + 1);
    });
    storyboard.planningSources.forEach((source, index) => {
        if (source.operation === "plan-selection" && (shotCounts.get(source.planningRunId) ?? 0) !== 1) {
            context.addIssue({code: "custom", path: ["planningSources", index], message: "plan-selection source 必须且只能拥有一个 shot"});
        }
    });

    if (storyboard.planHash !== createChapterIllustrationPlanHash(storyboard)) {
        context.addIssue({code: "custom", path: ["planHash"], message: "planHash 与当前 Storyboard 语义不一致"});
    }
});

type PlanHashInput = {
    chapterPath: string;
    sourceChapterHash: string;
    planningSources: z.input<typeof ChapterIllustrationPlanningSourceSchema>[];
    shots: z.input<typeof ChapterIllustrationShotSchema>[];
    revisionId?: string;
    planHash?: string;
};

/**
 * 计算聚合语义 hash；revision、publication 状态/时间与 Markdown 正文均不参与。
 */
export function createChapterIllustrationPlanHash(input: PlanHashInput): string {
    const chapterPath = ChapterPathSchema.parse(input.chapterPath);
    const sourceChapterHash = TextToImageContractHashSchema.parse(input.sourceChapterHash);
    const planningSources = input.planningSources.map((source) => {
        const parsed = ChapterIllustrationPlanningSourceSchema.parse(source);
        const {publication: _publication, ...semanticSource} = parsed;
        return semanticSource;
    });
    const shots = input.shots.map((shot) => {
        const parsed = ChapterIllustrationShotSchema.parse(shot);
        const {publication: _publication, ...semanticShot} = parsed;
        return semanticShot;
    });
    return hashTextToImageContract({
        schema: CHAPTER_ILLUSTRATION_STORYBOARD_SCHEMA,
        chapterPath,
        sourceChapterHash,
        planningSources,
        shots,
    } as TextToImageContractValue);
}

/** 为数组字段添加稳定的重复值错误。 */
function addUniqueIssues(
    values: string[],
    path: Array<string | number>,
    label: string,
    context: z.RefinementCtx,
): void {
    const seen = new Set<string>();
    values.forEach((value, index) => {
        if (seen.has(value)) {
            context.addIssue({code: "custom", path: [...path, index], message: `${label} 不能重复`});
        }
        seen.add(value);
    });
}
