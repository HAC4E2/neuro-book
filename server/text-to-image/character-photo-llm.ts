import {
    requestLlmCompletion,
} from "nbook/server/text-to-image/llm-chat";
import {TextToImageLlmProviderSettingsSchema} from "nbook/shared/dto/text-to-image.dto";
import {buildContextMessages} from "nbook/server/text-to-image/llm-context";
import type {TextToImageContextEntry} from "nbook/shared/dto/text-to-image.dto";
import type {TextToImageRuntimePlaceholderContext} from "nbook/server/text-to-image/runtime-placeholder";

const CHARACTER_PHOTO_PROMPT_PATTERN = /image###([\s\S]*?)###/iu;

/** 提取 LLM 回复中的角色照片完整 tag；找不到标记或内容为空时抛错。 */
export function extractCharacterPhotoPrompt(text: string): string {
    const match = CHARACTER_PHOTO_PROMPT_PATTERN.exec(text);
    if (!match) {
        throw new Error("角色照片 prompt 中未找到 image###...### 标记");
    }
    const prompt = (match[1] ?? "").trim();
    if (prompt === "") {
        throw new Error("角色照片 prompt 的 image###...### 内容为空");
    }
    return prompt;
}

function buildCharacterPhotoSystemPrompt(): string {
    return [
        "你是角色展示图 prompt 设计师，把角色视觉资料和服装资料转换成一张角色照片/头像的 NovelAI 生图 tag。",
        "",
        "输出格式（只允许这一种输出）：",
        "image###...完整 tag...###",
        "- `...` 处是可直接交给 NovelAI 的完整英文 tag 串；",
        "- 不要输出 <image>、<imgthink>、解释文字或多余空行。",
        "",
        "角色约束：",
        "- 外貌、体型必须来自角色视觉资料，服装必须来自服装资料，不得自创与资料冲突的内容；",
        "- 服装资料为空时，按用户需求补一个自然合适的服装。",
        "",
        "Tag 规范：",
        "- 全部使用英文 Stable Diffusion / Danbooru 风格 tag，多个 tag 用英文逗号分隔；",
        "- 开头写人物数量（如 1girl、1boy）和镜头用途（头像可用 portrait, upper body）；",
        "- 表情、动作、背景按用户需求补充；没有指定时生成自然微笑、柔和光线的角色展示；",
        "- 权重使用 (tag) 或 (tag:1.5)，禁止分号、中文标点、自然语言短句；",
        "- 穿内衣不算 nsfw，穿内衣内裤算 sfw；除非用户明确要求，默认生成 SFW 角色展示；",
        "- tag 串不要换行。",
    ].join("\n");
}

function buildCharacterPhotoUserPrompt(input: {
    characterText: string;
    outfitText: string;
    userRequirement: string;
}): string {
    return [
        "角色视觉资料：",
        "---",
        input.characterText.trim() === "" ? "（无）" : input.characterText,
        "---",
        "服装资料：",
        "---",
        input.outfitText.trim() === "" ? "（无）" : input.outfitText,
        "---",
        "用户需求：",
        input.userRequirement.trim() === "" ? "（无）" : input.userRequirement,
        "---",
        "请只输出 image###...完整 tag...### 格式的英文 tag 串。",
    ].join("\n");
}

/** 调用 LLM 生成角色照片 prompt，并提取 image###...### 内的完整 tag。 */
export async function generateCharacterPhotoPrompt(input: {
    provider: {
        baseUrl: string;
        credential: string;
        settings: Record<string, unknown>;
    };
    characterText: string;
    outfitText: string;
    userRequirement: string;
    contextEntries?: TextToImageContextEntry[];
    runtime?: TextToImageRuntimePlaceholderContext;
    complete?: typeof requestLlmCompletion;
}): Promise<string> {
    // provider.baseUrl 是运行时显式传入的连接地址；settings 里同名字段仅作兼容备件。
    const settings = TextToImageLlmProviderSettingsSchema.parse({
        ...input.provider.settings,
        baseUrl: input.provider.baseUrl,
    });
    const complete = input.complete ?? requestLlmCompletion;
    const content = await complete({
        baseUrl: input.provider.baseUrl,
        credential: input.provider.credential,
        model: settings.model,
        temperature: settings.temperature,
        topP: settings.topP,
        maxTokens: 2048,
        stream: false,
        sendImages: settings.sendImages,
        mergeSystemUser: settings.mergeSystemUser,
        retryCount: settings.retryCount,
        runtime: input.runtime,
        messages: [
            ...buildContextMessages(input.contextEntries ?? [], input.runtime ?? {}),
            {role: "system", content: buildCharacterPhotoSystemPrompt()},
            {role: "user", content: buildCharacterPhotoUserPrompt(input)},
        ],
    });
    return extractCharacterPhotoPrompt(content);
}
