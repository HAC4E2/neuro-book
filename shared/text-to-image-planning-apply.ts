import {z} from "zod";
import {hashTextToImageContract, type TextToImageContractValue} from "nbook/shared/text-to-image-contract-hash";
import {StoryboardStableIdSchema} from "nbook/shared/text-to-image-storyboard-preset";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";

export const IllustrationPlanningApplyStateSchema = z.enum([
    "prepared",
    "storyboard_written",
    "chapter_written",
    "storyboard_applied",
    "completed",
    "rolled_back",
    "apply_conflict",
]);
export type IllustrationPlanningApplyState = z.infer<typeof IllustrationPlanningApplyStateSchema>;

const ChapterPathSchema = z.string().regex(
    /^manuscript\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}\/index\.md$/u,
);
const MarkdownSnapshotSchema = z.string().max(10_000_000);

/** 可恢复 Planning Apply 的完整确定性快照；后续阶段不得重新编译或重新分配 identity。 */
export const IllustrationPlanningApplyPayloadSchema = z.object({
    schemaVersion: z.literal("nbook.illustration-planning-apply/v1"),
    journalId: StoryboardStableIdSchema,
    workflowId: StoryboardStableIdSchema,
    projectId: StoryboardStableIdSchema,
    chapterPath: ChapterPathSchema,
    sourceChapterHash: TextToImageContractHashSchema,
    planHash: TextToImageContractHashSchema,
    expectedChapterHash: TextToImageContractHashSchema,
    expectedStoryboardHash: TextToImageContractHashSchema.nullable(),
    /** illustrations.md 尚不存在时固定为空。 */
    storyboardBefore: MarkdownSnapshotSchema.nullable(),
    stagedStoryboard: MarkdownSnapshotSchema,
    stagedStoryboardHash: TextToImageContractHashSchema,
    appliedStoryboard: MarkdownSnapshotSchema,
    appliedStoryboardHash: TextToImageContractHashSchema,
    chapterBefore: MarkdownSnapshotSchema,
    chapterAfter: MarkdownSnapshotSchema,
    chapterAfterHash: TextToImageContractHashSchema,
    newPlaceholderIds: z.array(StoryboardStableIdSchema).max(1000),
    supersededPlaceholderIds: z.array(StoryboardStableIdSchema).max(1000),
    planningRequestHash: TextToImageContractHashSchema,
    planningInputHash: TextToImageContractHashSchema,
    planningEvidenceHash: TextToImageContractHashSchema,
}).strict().superRefine((payload, context) => {
    if ((payload.storyboardBefore === null) !== (payload.expectedStoryboardHash === null)) {
        context.addIssue({
            code: "custom",
            path: ["expectedStoryboardHash"],
            message: "storyboardBefore 与 expectedStoryboardHash 必须同时为空或同时存在",
        });
    }
    addUniqueIssues(payload.newPlaceholderIds, ["newPlaceholderIds"], "new placeholder", context);
    addUniqueIssues(payload.supersededPlaceholderIds, ["supersededPlaceholderIds"], "superseded placeholder", context);
    const superseded = new Set(payload.supersededPlaceholderIds);
    payload.newPlaceholderIds.forEach((placeholderId, index) => {
        if (superseded.has(placeholderId)) {
            context.addIssue({
                code: "custom",
                path: ["newPlaceholderIds", index],
                message: "同一 placeholder 不能同时新增和 supersede",
            });
        }
    });
});

export type IllustrationPlanningApplyPayload = z.infer<typeof IllustrationPlanningApplyPayloadSchema>;

/** Planning Apply 持久化记录的严格共享投影。 */
export const IllustrationPlanningApplyJournalSchema = z.object({
    id: StoryboardStableIdSchema,
    workflowId: StoryboardStableIdSchema,
    projectId: StoryboardStableIdSchema,
    chapterPath: ChapterPathSchema,
    state: IllustrationPlanningApplyStateSchema,
    expectedChapterHash: TextToImageContractHashSchema,
    expectedStoryboardHash: TextToImageContractHashSchema.nullable(),
    stagedStoryboardHash: TextToImageContractHashSchema,
    appliedStoryboardHash: TextToImageContractHashSchema,
    chapterAfterHash: TextToImageContractHashSchema,
    payload: IllustrationPlanningApplyPayloadSchema,
    /** 无错误时为空；apply_conflict/rolled_back 可保存稳定诊断。 */
    errorCode: z.string().trim().min(1).max(160).nullable(),
    /** 无错误时为空；非空时是面向诊断的有限文本。 */
    errorMessage: z.string().trim().min(1).max(2000).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
}).strict();
export type IllustrationPlanningApplyJournal = z.infer<typeof IllustrationPlanningApplyJournalSchema>;

export class PlanningApplyContractError extends Error {
    constructor(
        readonly code: "PLANNING_APPLY_STATE_CONFLICT" | "PLANNING_APPLY_CONFLICT" | "PLANNING_APPLY_NOT_FOUND",
        message: string,
    ) {
        super(`${code}: ${message}`);
        this.name = "PlanningApplyContractError";
    }
}

const TRANSITIONS: Record<IllustrationPlanningApplyState, IllustrationPlanningApplyState[]> = {
    prepared: ["storyboard_written", "rolled_back", "apply_conflict"],
    storyboard_written: ["chapter_written", "rolled_back", "apply_conflict"],
    chapter_written: ["storyboard_applied", "apply_conflict"],
    storyboard_applied: ["completed", "apply_conflict"],
    completed: [],
    rolled_back: [],
    apply_conflict: [],
};

/** 校验并返回唯一允许的下一阶段。 */
export function assertPlanningApplyTransition(
    from: IllustrationPlanningApplyState,
    to: IllustrationPlanningApplyState,
): IllustrationPlanningApplyState {
    const current = IllustrationPlanningApplyStateSchema.parse(from);
    const next = IllustrationPlanningApplyStateSchema.parse(to);
    if (!TRANSITIONS[current].includes(next)) {
        throw new PlanningApplyContractError("PLANNING_APPLY_STATE_CONFLICT", `不允许 ${current} -> ${next}`);
    }
    return next;
}

/** 为 create-only prepare 与恢复重放生成完整 payload 指纹。 */
export function createPlanningApplyPayloadHash(input: IllustrationPlanningApplyPayload): string {
    return hashTextToImageContract(
        IllustrationPlanningApplyPayloadSchema.parse(input) as TextToImageContractValue,
    );
}

/** 为列表字段添加稳定重复值错误。 */
function addUniqueIssues(
    values: string[],
    path: Array<string | number>,
    label: string,
    context: z.RefinementCtx,
): void {
    const seen = new Set<string>();
    values.forEach((value, index) => {
        if (seen.has(value)) {
            context.addIssue({code: "custom", path: [...path, index], message: `${label} placeholder 不能重复`});
        }
        seen.add(value);
    });
}
