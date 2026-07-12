/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import type {Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {
    BodyImagePromptPlacerInitialSchema,
    BodyImagePromptPlacerOutputSchema,
    BodyImagePromptPlacerPayloadSchema,
} from "nbook/server/agent/profiles/builtin-contracts";
import {AppendingSet, Message, ProfilePrompt, System} from "nbook/server/agent/profiles/profile-dsl";
import {profileText} from "nbook/server/agent/profiles/profile-text";

export const profileManifest = {
    key: "body-image.prompt-placer",
    name: "正文生图插图定位",
    description: "正文生图后处理子 agent：根据章节段落和 LLM 生成的图片 prompt，返回每张图应插入到哪个段落后，不改写正文。",
} as const;

export const InitialSchema = BodyImagePromptPlacerInitialSchema;
export const PayloadSchema = BodyImagePromptPlacerPayloadSchema;
export const OutputSchema = BodyImagePromptPlacerOutputSchema;

export type Initial = Static<typeof InitialSchema>;
export type Payload = Static<typeof PayloadSchema>;
export type Output = Static<typeof OutputSchema>;

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    payloadSchema: PayloadSchema,
    outputSchema: OutputSchema,
    tools: toolset(
        builtin.result.main({dataSchema: OutputSchema}),
    ),
    context(ctx) {
        const payload = ctx.invocation?.payload as Payload | undefined;
        return (
            <ProfilePrompt>
                <System>{renderSystemPrompt()}</System>
                <AppendingSet>
                    <Message>{renderPayload(payload)}</Message>
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});

function renderSystemPrompt(): string {
    return profileText`
        你是正文生图插图定位子 agent。你的任务很窄：调用方已经让文生图 LLM 生成了图片 prompt，你只判断每个 prompt 应该插入到当前章节哪个段落后面。

        # 判断边界

        - 只从 payload.paragraphs 里选择 afterParagraphId，不要自造段落 id。
        - 只从 payload.prompts 里选择 promptId，不要自造图片 prompt。
        - 不改写正文，不重写 prompt，不生成新的 NovelAI tag。
        - 无法判断位置的 prompt 直接不返回；宁可少插，不要乱插。
        - 一个 prompt 最多返回一个 placement。
        - 优先把图片放在对应场景、动作、人物或环境描写段落之后。
        - 如果 prompt 明显是段落 A 的画面，不要因为顺序靠后就放到章节末尾。
        - 如果 LLM 回复格式混乱，只根据 prompt 内容、nearbyText、llmReply 与段落语义做保守判断。

        # 输出合同

        - 必须调用 report_result。
        - report_result.data 必须是 { placements, note? }。
        - placements[].promptId 必须来自 prompts[].id。
        - placements[].afterParagraphId 必须来自 paragraphs[].id。
        - confidence 使用 0 到 1 的数字；明确对应约 0.85 以上，语义推断约 0.6 到 0.85。
        - report_result.result 只写一句简短中文说明。
    `;
}

function renderPayload(payload: Payload | undefined): string {
    if (!payload) {
        return "本轮没有 payload。请返回空 placements。";
    }
    return [
        "正文生图插图定位输入：",
        "",
        `chapterPath: ${payload.chapterPath}`,
        "",
        "paragraphs:",
        JSON.stringify(payload.paragraphs, null, 2),
        "",
        "prompts:",
        JSON.stringify(payload.prompts, null, 2),
        "",
        "llmReply:",
        payload.llmReply,
        "",
        "chapterMarkdown:",
        payload.chapterMarkdown,
    ].join("\n");
}
