import {
    buildBodyImageSystemPrompt,
    buildBodyImageUserPrompt,
} from "nbook/server/text-to-image/body-image-prompt";
import {
    requestLlmCompletion,
} from "nbook/server/text-to-image/llm-chat";
import {TextToImageLlmProviderSettingsSchema} from "nbook/shared/dto/text-to-image.dto";
import {applyReplacementProfile} from "nbook/server/text-to-image/sensitive-word-replacement";

/** L1 正文生图块：五要素契约，不落盘。 */
export type BodyImageBlock = {
    regex: string;
    title: string;
    tagThink: string;
    size: string;
    prompts: string;
};

const IMAGE_PATTERN = /<image>([\s\S]*?)<\/image>/giu;

/**
 * 解析 LLM 返回的 `<image>...</image>` 块。
 * 支持外层 `<content>/<images>` 包裹与块内五要素子标签；解析失败抛错。
 */
export function parseBodyImageBlocks(text: string): BodyImageBlock[] {
    const blocks: BodyImageBlock[] = [];
    for (const match of text.matchAll(IMAGE_PATTERN)) {
        blocks.push(parseBodyImageBlock(match[1] ?? ""));
    }
    if (blocks.length === 0) {
        throw new Error("未找到 <image> 块");
    }
    return blocks;
}

/** 调用 LLM 生成正文生图块；解析失败最多重试 2 次，仍失败抛错。 */
export async function generateBodyImageBlocks(input: {
    provider: {
        baseUrl: string;
        credential: string;
        settings: Record<string, unknown>;
    };
    chapterContent: string;
    characterSummary: string;
    textReplacementRules?: string;
    aiReplacementRules?: string;
    complete?: typeof requestLlmCompletion;
}): Promise<BodyImageBlock[]> {
    const settings = TextToImageLlmProviderSettingsSchema.parse(input.provider.settings);
    const complete = input.complete ?? requestLlmCompletion;
    const systemPrompt = buildBodyImageSystemPrompt();
    const userPrompt = buildBodyImageUserPrompt({
        chapterContent: applyReplacementProfile({
            text: input.chapterContent,
            rulesText: input.textReplacementRules ?? "",
            kind: "text",
        }),
        characterSummary: input.characterSummary,
    });
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const content = await complete({
            baseUrl: input.provider.baseUrl,
            credential: input.provider.credential,
            model: settings.model,
            temperature: settings.temperature,
            topP: settings.topP,
            maxTokens: 4096,
            stream: false,
            sendImages: settings.sendImages,
            mergeSystemUser: settings.mergeSystemUser,
            retryCount: settings.retryCount,
            messages: [
                {role: "system", content: systemPrompt},
                {role: "user", content: userPrompt},
            ],
        });
        try {
            return parseBodyImageBlocks(applyReplacementProfile({
                text: content,
                rulesText: input.aiReplacementRules ?? "",
                kind: "ai",
            }));
        } catch (error) {
            lastError = toError(error);
        }
    }

    throw new Error(`正文生图块解析失败：重试 2 次后仍未成功；最后原因：${lastError?.message ?? "未知"}`);
}

function parseBodyImageBlock(block: string): BodyImageBlock {
    const regex = extractTag(block, "regex");
    const prompts = extractTag(block, "prompts");
    if (regex === "" || prompts === "") {
        throw new Error("image 块必须包含非空的 <regex> 与 <prompts>");
    }
    return {
        regex,
        title: extractTag(block, "title_styled"),
        tagThink: extractTag(block, "Tag_think"),
        size: extractTag(block, "size"),
        prompts,
    };
}

function extractTag(block: string, tag: string): string {
    const pattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "iu");
    return pattern.exec(block)?.[1]?.trim() ?? "";
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
