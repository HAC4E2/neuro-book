import {z} from "zod";
import type {ProfileHomeFacade} from "nbook/server/agent/profiles/profile-home";
import {
    PendingStoryboardPackageSchema,
    ResolvedStoryboardPackageSchema,
    StoryboardImportResolutionGatePreviewSchema,
    StoryboardResolvedTagSchema,
    StoryboardTagResolutionDiffSchema,
} from "nbook/shared/text-to-image-storyboard-import";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";
import {StoryboardStableIdSchema} from "nbook/shared/text-to-image-storyboard-preset";

export const STORYBOARD_IMPORT_JOURNAL_SCHEMA_VERSION = "nbook.storyboard-import-journal/v1" as const;

export const StoryboardImportJournalStageSchema = z.enum([
    "prepared",
    "archive_written",
    "inspect_written",
    "candidates_written",
    "report_written",
    "completed",
]);

export type StoryboardImportJournalStage = z.infer<typeof StoryboardImportJournalStageSchema>;

const ResolvedFileHashesSchema = z.object({
    storyboardFileHash: TextToImageContractHashSchema,
    patternFileHash: TextToImageContractHashSchema,
    diffFileHash: TextToImageContractHashSchema,
}).strict();

const PreparedResolutionShape = {
    pendingCandidatePackageHash: TextToImageContractHashSchema,
    acceptedPreviewToken: TextToImageContractHashSchema,
    records: z.array(StoryboardResolvedTagSchema).max(100000),
    resolvedFiles: ResolvedFileHashesSchema,
    package: ResolvedStoryboardPackageSchema,
    diff: StoryboardTagResolutionDiffSchema,
} as const;

/** Tag resolution 的可恢复子 journal；prepared 先冻结 terminal bytes evidence，再写 resolved artifacts。 */
export const StoryboardImportResolutionJournalSchema = z.discriminatedUnion("state", [
    z.object({state: z.literal("not_started")}).strict(),
    z.object({state: z.literal("gate"), preview: StoryboardImportResolutionGatePreviewSchema}).strict(),
    z.object({state: z.literal("prepared"), ...PreparedResolutionShape}).strict(),
    z.object({state: z.literal("resolved"), ...PreparedResolutionShape}).strict(),
]).superRefine((resolution, context) => {
    if (resolution.state === "not_started" || resolution.state === "gate") return;
    if (resolution.package.previousCandidatePackageHash !== resolution.pendingCandidatePackageHash) {
        context.addIssue({code: "custom", path: ["package", "previousCandidatePackageHash"], message: "resolved package 必须绑定 pending package"});
    }
    if (resolution.records.length !== resolution.package.patterns.resolutionCount) {
        context.addIssue({code: "custom", path: ["records"], message: "records 数必须匹配 resolved package"});
    }
});

export type StoryboardImportResolutionJournal = z.infer<typeof StoryboardImportResolutionJournalSchema>;

/** 全局 TTP import 的可重放 journal；不含原始 secret 或当前 selector 写权限。 */
export const StoryboardImportJournalSchema = z.object({
    schemaVersion: z.literal(STORYBOARD_IMPORT_JOURNAL_SCHEMA_VERSION),
    importId: StoryboardStableIdSchema,
    presetId: StoryboardStableIdSchema,
    stage: StoryboardImportJournalStageSchema,
    source: z.object({
        projectPath: z.string().trim().min(1).max(500),
        relativePath: z.string().regex(/^upload\/[^/\\]+\.json$/iu),
        rawSourceHash: TextToImageContractHashSchema,
        sanitizedSourceHash: TextToImageContractHashSchema,
        converterVersion: z.string().trim().min(1).max(80),
    }).strict(),
    inspectHash: TextToImageContractHashSchema,
    candidateFiles: z.object({
        storyboardFileHash: TextToImageContractHashSchema,
        patternFileHash: TextToImageContractHashSchema,
    }).strict().nullable(),
    reportFileHash: TextToImageContractHashSchema.nullable(),
    package: PendingStoryboardPackageSchema.nullable(),
    resolution: StoryboardImportResolutionJournalSchema,
}).strict().superRefine((journal, context) => {
    const stageIndex = STORYBOARD_IMPORT_JOURNAL_STAGES.indexOf(journal.stage);
    if (stageIndex >= STORYBOARD_IMPORT_JOURNAL_STAGES.indexOf("candidates_written")
        && (!journal.candidateFiles || !journal.package)) {
        context.addIssue({code: "custom", path: ["candidateFiles"], message: "candidate 阶段必须冻结 pair 文件与 package"});
    }
    if (stageIndex >= STORYBOARD_IMPORT_JOURNAL_STAGES.indexOf("report_written") && !journal.reportFileHash) {
        context.addIssue({code: "custom", path: ["reportFileHash"], message: "report 阶段必须冻结 report file hash"});
    }
    if (journal.resolution.state !== "not_started") {
        if (!journal.package) {
            context.addIssue({code: "custom", path: ["resolution"], message: "Tag resolution 必须基于已冻结 pending package"});
        } else {
            const pendingHash = journal.resolution.state === "gate"
                ? journal.resolution.preview.pendingCandidatePackageHash
                : journal.resolution.pendingCandidatePackageHash;
            if (pendingHash !== journal.package.candidatePackageHash) {
                context.addIssue({code: "custom", path: ["resolution"], message: "Tag resolution 与 pending package hash 不一致"});
            }
        }
    }
});

export type StoryboardImportJournal = z.infer<typeof StoryboardImportJournalSchema>;

export const STORYBOARD_IMPORT_JOURNAL_STAGES: readonly StoryboardImportJournalStage[] = [
    "prepared",
    "archive_written",
    "inspect_written",
    "candidates_written",
    "report_written",
    "completed",
];

/** 返回 import 目录下 journal 的受限 Profile Home 相对路径。 */
export function storyboardImportJournalPath(importId: string): string {
    return `imports/ttp-storyboard/${StoryboardStableIdSchema.parse(importId)}/journal.json`;
}

/** 读取并严格验证 journal；不存在时返回 null。 */
export async function readStoryboardImportJournal(
    home: ProfileHomeFacade,
    importId: string,
): Promise<StoryboardImportJournal | null> {
    try {
        const text = await home.readText(storyboardImportJournalPath(importId));
        // journal 是持久化外部边界，先以 unknown 接收，再立即交给 strict schema 收窄。
        const parsed: unknown = JSON.parse(text);
        return StoryboardImportJournalSchema.parse(parsed);
    } catch (error) {
        if (isNotFoundError(error)) return null;
        throw error;
    }
}

/** 规范写入 journal；overwrite 只允许服务端推进/恢复同一 import。 */
export async function writeStoryboardImportJournal(
    home: ProfileHomeFacade,
    journal: StoryboardImportJournal,
    mode: "create" | "overwrite",
): Promise<boolean> {
    const parsed = StoryboardImportJournalSchema.parse(journal);
    const result = await home.writeText(
        storyboardImportJournalPath(parsed.importId),
        `${JSON.stringify(parsed, null, 4)}\n`,
        {mode},
    );
    return result.written;
}

/** 判断 journal 是否已经达到目标阶段。 */
export function storyboardImportStageReached(
    current: StoryboardImportJournalStage,
    target: StoryboardImportJournalStage,
): boolean {
    return STORYBOARD_IMPORT_JOURNAL_STAGES.indexOf(current) >= STORYBOARD_IMPORT_JOURNAL_STAGES.indexOf(target);
}

function isNotFoundError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
