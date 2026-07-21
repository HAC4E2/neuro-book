import {z} from "zod";
import type {ProfileHomeFacade} from "nbook/server/agent/profiles/profile-home";
import {
    StoryboardPublishedPairSchema,
    StoryboardPublishTargetSchema,
} from "nbook/shared/text-to-image-storyboard-publish";
import {StoryboardStableIdSchema} from "nbook/shared/text-to-image-storyboard-preset";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";

export const STORYBOARD_GLOBAL_PUBLISH_JOURNAL_SCHEMA_VERSION = "nbook.storyboard-global-publish-journal/v1" as const;

export const StoryboardGlobalPublishStateSchema = z.enum([
    "prepared",
    "preset_published",
    "patterns_published",
    "published_not_selected",
    "selector_updated",
    "completed",
]);
export type StoryboardGlobalPublishState = z.infer<typeof StoryboardGlobalPublishStateSchema>;

const IsoTimestampSchema = z.string().datetime({offset: true});

/** 独立 global publish journal；不保存 secret，也不声称三文件原子事务。 */
export const StoryboardGlobalPublishJournalSchema = z.object({
    schemaVersion: z.literal(STORYBOARD_GLOBAL_PUBLISH_JOURNAL_SCHEMA_VERSION),
    publishId: StoryboardStableIdSchema,
    importId: StoryboardStableIdSchema,
    state: StoryboardGlobalPublishStateSchema,
    actorId: z.string().trim().min(1).max(160),
    requestedAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    target: StoryboardPublishTargetSchema,
    expectedResolvedPreviewToken: TextToImageContractHashSchema,
    publishPreviewToken: TextToImageContractHashSchema,
    sourceCandidatePackageHash: TextToImageContractHashSchema,
    publishedCandidatePackageHash: TextToImageContractHashSchema,
    diagnosticHash: TextToImageContractHashSchema,
    published: StoryboardPublishedPairSchema,
    previousSelectorKey: z.string().regex(/^storyboard-presets\/[a-z0-9][a-z0-9._-]{0,199}\.md$/u),
    expected: z.object({
        activePresetFileHash: TextToImageContractHashSchema.nullable(),
        activePatternFileHash: TextToImageContractHashSchema.nullable(),
        globalConfigHash: TextToImageContractHashSchema,
    }).strict(),
    staged: z.object({
        presetArchivePath: z.string().regex(/^imports\/chatu8-storyboard\/[a-z0-9][a-z0-9._-]{0,199}\/publishes\/[a-z0-9][a-z0-9._-]{0,199}\/approved\.storyboard\.md$/u),
        patternArchivePath: z.string().regex(/^imports\/chatu8-storyboard\/[a-z0-9][a-z0-9._-]{0,199}\/publishes\/[a-z0-9][a-z0-9._-]{0,199}\/approved\.tag-patterns\.md$/u),
        presetFileHash: TextToImageContractHashSchema,
        patternFileHash: TextToImageContractHashSchema,
    }).strict(),
    retryExpectedGlobalConfigHash: TextToImageContractHashSchema.nullable(),
    publishedAt: IsoTimestampSchema.nullable(),
    selectorUpdatedAt: IsoTimestampSchema.nullable(),
    completedAt: IsoTimestampSchema.nullable(),
}).strict().superRefine((journal, context) => {
    if ((journal.state === "published_not_selected") !== (journal.retryExpectedGlobalConfigHash !== null)) {
        context.addIssue({code: "custom", path: ["retryExpectedGlobalConfigHash"], message: "只有 published_not_selected 保存下一次 selector CAS hash"});
    }
    if (["preset_published", "patterns_published", "published_not_selected", "selector_updated", "completed"].includes(journal.state)
        && journal.publishedAt === null) {
        context.addIssue({code: "custom", path: ["publishedAt"], message: "已发布阶段必须记录 publishedAt"});
    }
    if (["selector_updated", "completed"].includes(journal.state) && journal.selectorUpdatedAt === null) {
        context.addIssue({code: "custom", path: ["selectorUpdatedAt"], message: "selector 阶段必须记录 selectorUpdatedAt"});
    }
    if ((journal.state === "completed") !== (journal.completedAt !== null)) {
        context.addIssue({code: "custom", path: ["completedAt"], message: "completedAt 必须与 completed state 一致"});
    }
});

export type StoryboardGlobalPublishJournal = z.infer<typeof StoryboardGlobalPublishJournalSchema>;

/** publish journal 相对路径。 */
export function storyboardGlobalPublishJournalPath(importId: string, publishId: string): string {
    return `${storyboardGlobalPublishDirectory(importId, publishId)}/journal.json`;
}

/** staged approved pair 所在的 create-only archive 目录。 */
export function storyboardGlobalPublishDirectory(importId: string, publishId: string): string {
    return `imports/chatu8-storyboard/${StoryboardStableIdSchema.parse(importId)}/publishes/${StoryboardStableIdSchema.parse(publishId)}`;
}

/** strict 读取 publish journal；不存在返回 null。 */
export async function readStoryboardGlobalPublishJournal(
    home: ProfileHomeFacade,
    importId: string,
    publishId: string,
): Promise<StoryboardGlobalPublishJournal | null> {
    try {
        const text = await home.readText(storyboardGlobalPublishJournalPath(importId, publishId));
        // journal 是持久外部边界，必须先以 unknown 接收再 strict parse。
        const value: unknown = JSON.parse(text);
        return StoryboardGlobalPublishJournalSchema.parse(value);
    } catch (error) {
        if (isNotFoundError(error)) return null;
        throw error;
    }
}

/** 规范写入 publish journal。 */
export async function writeStoryboardGlobalPublishJournal(
    home: ProfileHomeFacade,
    journal: StoryboardGlobalPublishJournal,
    mode: "create" | "overwrite",
): Promise<boolean> {
    const parsed = StoryboardGlobalPublishJournalSchema.parse(journal);
    const result = await home.writeText(
        storyboardGlobalPublishJournalPath(parsed.importId, parsed.publishId),
        `${JSON.stringify(parsed, null, 4)}\n`,
        {mode},
    );
    return result.written;
}

function isNotFoundError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
