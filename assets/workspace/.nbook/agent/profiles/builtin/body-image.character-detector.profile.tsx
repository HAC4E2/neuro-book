/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import type {Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {
    BodyImageCharacterDetectorInitialSchema,
    BodyImageCharacterDetectorOutputSchema,
    BodyImageCharacterDetectorPayloadSchema,
} from "nbook/server/agent/profiles/builtin-contracts";
import {AppendingSet, Message, ProfilePrompt, System} from "nbook/server/agent/profiles/profile-dsl";
import {profileText} from "nbook/server/agent/profiles/profile-text";

export const profileManifest = {
    key: "body-image.character-detector",
    name: "正文生图角色识别",
    description: "正文生图前的角色筛选子 agent：根据章节正文和候选 image-tags，只返回实际相关角色，供正文文生图提示词注入。",
} as const;

export const InitialSchema = BodyImageCharacterDetectorInitialSchema;
export const PayloadSchema = BodyImageCharacterDetectorPayloadSchema;
export const OutputSchema = BodyImageCharacterDetectorOutputSchema;

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
    compaction: {},
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
        你是正文生图角色识别子 agent。你的任务很窄：根据调用方提供的章节正文和候选角色，判断哪些角色的 image-tags 应该注入正文生图 LLM 请求变量。

        # 判断边界

        - 只从 candidates 中选择角色，不要自造角色。
        - 角色中文名称可以包含多个别名，任意别名在正文中出现通常视为命中。
        - 允许根据代称、上下文延续、对话归属做谨慎语义判断，但不要把只是设定背景或未参与当前章节画面的角色选入。
        - 如果正文只提到服装、地点、物品，不要因此选择无关角色。
        - 输出只用于正文生图 tag 注入；宁可少选，也不要把全角色列表都注入。

        # 输出合同

        - 必须调用 report_result。
        - report_result.data 必须是 { matches, note? }。
        - matches 只包含相关角色；没有相关角色就返回空数组。
        - matches[].id 和 matches[].sourcePath 必须来自 candidates 原值。
        - confidence 使用 0 到 1 的数字；明确点名约 0.9 以上，语义推断约 0.6 到 0.85。
        - report_result.result 只写一句简短中文说明。
    `;
}

function renderPayload(payload: Payload | undefined): string {
    if (!payload) {
        return "本轮没有 payload。请返回空 matches。";
    }
    return [
        "正文生图角色识别输入：",
        "",
        `chapterPath: ${payload.chapterPath}`,
        "",
        "candidates:",
        JSON.stringify(payload.candidates, null, 2),
        "",
        "chapterMarkdown:",
        payload.chapterMarkdown,
    ].join("\n");
}
