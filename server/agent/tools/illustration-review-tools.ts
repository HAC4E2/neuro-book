import {Type, type Static} from "typebox";
import {Value} from "typebox/value";
import {defineAgentTool, type AgentToolDefinition, type ToolExecutionContext} from "nbook/server/agent/tools/types";
import {
    findAllTextToImagePromptMarkdown,
    findTextToImagePromptMarkdown,
    type TextToImagePromptPayload,
} from "nbook/shared/text-to-image-markdown";
import {TextToImageChapterService} from "nbook/server/text-to-image/chapter.service";
import type {IllustrationPlanningToolContext} from "nbook/shared/text-to-image-illustration-planning";

const ListIllustrationsSchema = Type.Object({}, {additionalProperties: false});
const GetIllustrationDetailSchema = Type.Object({
    placeholderId: Type.String({minLength: 1, maxLength: 200}),
}, {additionalProperties: false});

type ListIllustrationsInput = Static<typeof ListIllustrationsSchema>;
type GetIllustrationDetailInput = Static<typeof GetIllustrationDetailSchema>;

type ReviewRun = {
    projectPath: string;
    chapterPath: string;
    chapterMarkdown: string;
    chapterHash: string;
    placeholders: Array<{raw: string; payload: TextToImagePromptPayload}>;
};

const activeReviewRuns = new Map<string, Promise<ReviewRun>>();

/** attempt 结束后释放 in-memory run-scoped 数据。 */
export function releaseIllustrationReviewToolEvidence(invocationId: string): void {
    activeReviewRuns.delete(invocationId);
}

/** P6：插图审查只读窄工具——只看 V2 占位符载荷与章节正文，不查 Project SQLite。 */
export function createIllustrationReviewAgentToolDefinitions(): AgentToolDefinition[] {
    const chapterService = new TextToImageChapterService();

    const useRun = async (context: ToolExecutionContext): Promise<ReviewRun> => {
        const runKey = context.invocationId ?? `review-session-${String(context.sessionId)}`;
        const existing = activeReviewRuns.get(runKey);
        if (existing) return existing;

        const projectPath = requireReviewProjectPath(context);
        // toolContext.contextId 是章节路径（planning input builder 写入）
        const chapterPath = String((context as Record<string, unknown>).chapterPath ?? "");
        if (!chapterPath || !chapterPath.includes(".md")) throw new Error("REVIEW_CANDIDATES_CHAPTER_REQUIRED");
        const snapshot = await chapterService.snapshot(projectPath, chapterPath);
        const placeholders = findAllTextToImagePromptMarkdown(snapshot.markdown);
        const pending: ReviewRun = {
            projectPath: projectPath,
            chapterPath,
            chapterMarkdown: snapshot.markdown,
            chapterHash: snapshot.hash,
            placeholders,
        };
        activeReviewRuns.set(runKey, Promise.resolve(pending));
        return pending;
    };

    return [
        defineAgentTool({
            key: "list_chapter_illustrations",
            name: "list_chapter_illustrations",
            label: "列出章节插图",
            description: "列出章节中所有 :illustration V2 占位符。返回 placeholderId、shotId、shotIntentHash、origin 与 anchorId。不查询项目数据库。",
            parameters: ListIllustrationsSchema,
            validationSchema: ListIllustrationsSchema,
            executionMode: "parallel",
            async executeWithContext(context, _toolCallId, _params) {
                const run = await useRun(context);
                const items = run.placeholders.map((ph) => ({
                    placeholderId: ph.payload.id,
                    shotId: ph.payload.shotId,
                    shotIntentHash: ph.payload.shotIntentHash,
                    origin: ph.payload.origin,
                    anchorId: ph.payload.anchorId,
                    sourceChapterHash: ph.payload.sourceChapterHash,
                }));
                return {
                    content: [{type: "text" as const, text: JSON.stringify({chapterPath: run.chapterPath, illustrations: items, count: items.length}, null, 2)}],
                    details: {count: items.length, chapterPath: run.chapterPath},
                };
            },
        }),
        defineAgentTool({
            key: "get_illustration_detail",
            name: "get_illustration_detail",
            label: "读取插图详情",
            description: "读取单条插图占位符的完整 V2 载荷与周围上下文段落（前后各一个段落）。不查询项目数据库，不泄露 secret。",
            parameters: GetIllustrationDetailSchema,
            validationSchema: GetIllustrationDetailSchema,
            executionMode: "parallel",
            async executeWithContext(context, _toolCallId, params) {
                const input = Value.Parse(GetIllustrationDetailSchema, params) as GetIllustrationDetailInput;
                const run = await useRun(context);
                const found = findTextToImagePromptMarkdown(run.chapterMarkdown, input.placeholderId);
                if (!found) {
                    return {
                        content: [{type: "text" as const, text: JSON.stringify({error: "NOT_FOUND", placeholderId: input.placeholderId})}],
                        details: {placeholderId: input.placeholderId, found: false},
                    };
                }
                // 提取周围段落上下文（placeholder 前后各一段）
                const parts = run.chapterMarkdown.split(/\n\n+/g);
                const rawIndex = parts.findIndex((p) => p.includes(found.raw));
                const contextBefore = rawIndex > 0 ? parts[rawIndex - 1]?.slice(0, 500) ?? "" : "";
                const contextAfter = rawIndex >= 0 && rawIndex < parts.length - 1 ? parts[rawIndex + 1]?.slice(0, 500) ?? "" : "";
                return {
                    content: [{type: "text" as const, text: JSON.stringify({
                        placeholderId: input.placeholderId,
                        payload: found.payload,
                        contextBefore,
                        contextAfter,
                    }, null, 2)}],
                    details: {placeholderId: input.placeholderId, found: true},
                };
            },
        }),
    ];
}

/** 全局 registry 使用的生产 runtime 构造入口。 */
export function createIllustrationReviewAgentTools() {
    return createIllustrationReviewAgentToolDefinitions().map((definition) => definition.runtime());
}

/** 上游 ToolExecutionContext 用 currentProject 表达 Project scope；转回 text-to-image projectPath。 */
function requireReviewProjectPath(context: import("nbook/server/agent/tools/types").ToolExecutionContext): string {
    if (!context.currentProject) throw new Error("REVIEW_CANDIDATES_PROJECT_REQUIRED");
    return `workspace/${context.currentProject.workspace.ref.projectRoot}`;
}
