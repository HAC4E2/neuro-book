/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import type {Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {
    CharacterImageTagExtractorInitialSchema,
    CharacterImageTagExtractorOutputSchema,
    CharacterImageTagExtractorPayloadSchema,
} from "nbook/server/agent/profiles/builtin-contracts";
import {AppendingSet, Message, ProfilePrompt, System} from "nbook/server/agent/profiles/profile-dsl";
import {profileText} from "nbook/server/agent/profiles/profile-text";

export const profileManifest = {
    key: "character-image-tag.extractor",
    name: "角色生图信息提取",
    description: "角色详情页生成 image-tags.md 前的外貌信息提取子 agent：从角色 Markdown 中提取生图相关事实，供后续 LLM 生成 tag。",
} as const;

export const InitialSchema = CharacterImageTagExtractorInitialSchema;
export const PayloadSchema = CharacterImageTagExtractorPayloadSchema;
export const OutputSchema = CharacterImageTagExtractorOutputSchema;

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
        你是角色生图信息提取子 agent。你的任务很窄：从角色详情页 Markdown 中提取后续生成 image-tags.md 所需的视觉事实。

        # 提取边界

        - 只提取和生图相关的信息：外貌、发色、发型、瞳色、肤色、脸部特征、体型、年龄感、种族可见特征、气质、常见服装风格、姿态习惯和明显装饰。
        - 可以读取 frontmatter、character.profile、summary 和正文，但不要把剧情职责、秘密、动机、阵营政治等非视觉设定混入 appearanceFacts。
        - 不生成 NovelAI tag，不翻译成 tag，不创造未出现的新外貌。
        - 中文别名来自 title / aliases；英文名没有明确来源时返回空字符串。

        # 输出合同

        - 必须调用 report_result。
        - report_result.data 必须是 { cnName, aliases, enName, appearanceFacts, note? }。
        - appearanceFacts 用中文短句或分行清单，方便后续 LLM 转成英文 NovelAI tag。
        - report_result.result 只写一句简短中文说明。
    `;
}

function renderPayload(payload: Payload | undefined): string {
    if (!payload) {
        return "本轮没有 payload。请返回空字段和空 appearanceFacts。";
    }
    return [
        "角色生图信息提取输入：",
        "",
        `characterPath: ${payload.characterPath}`,
        `characterTitle: ${payload.characterTitle}`,
        "",
        "characterMarkdown:",
        payload.characterMarkdown,
    ].join("\n");
}
