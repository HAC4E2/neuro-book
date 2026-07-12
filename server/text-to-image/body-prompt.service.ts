import {randomUUID} from "node:crypto";
import {z} from "zod";
import {resolveBodyImagePromptPlacements} from "nbook/server/text-to-image/body-image-prompt-placement";
import {resolveProjectBodyImageCharacterTagContext} from "nbook/server/text-to-image/body-image-character-tags";
import {TextToImageChapterConflictError, TextToImageChapterService, type TextToImageChapterParagraph} from "nbook/server/text-to-image/chapter.service";
import {requestTextToImageLlmCompletion, type TextToImageLlmProviderConnection} from "nbook/server/text-to-image/llm-provider";
import {compileTextToImagePrompt} from "nbook/server/text-to-image/prompt-compiler";

const PromptRuleSchema = z.object({
    id: z.string().default(""),
    name: z.string().default(""),
    enabled: z.boolean().default(true),
    target: z.enum(["positive", "negative"]).default("positive"),
    matchMode: z.enum(["plain", "regex"]).default("plain"),
    mode: z.enum(["replace", "append", "prepend", "delete"]).default("replace"),
    trigger: z.string().default(""),
    replacement: z.string().default(""),
});

export const BodyPromptRequestSchema = z.object({
    projectPath: z.string().trim().min(1),
    chapterPath: z.string().trim().min(1),
    chapterHash: z.string().regex(/^[a-f0-9]{64}$/u),
    llmProviderId: z.number().int().positive(),
    taskPrompt: z.string().default(""),
    defaultNegativePrompt: z.string().default(""),
    promptRules: z.array(PromptRuleSchema).default([]),
    parameters: z.object({
        temperature: z.number().default(0.7),
        topP: z.number().default(1),
        maxTokens: z.number().int().positive().default(4096),
    }),
});

export type BodyPromptRequest = z.infer<typeof BodyPromptRequestSchema>;

type BodyPromptProvider = TextToImageLlmProviderConnection & {model: string};

/** 服务端正文提示词编排：章节快照 -> LLM -> 定位子 agent -> 带锁占位符写入。 */
export class TextToImageBodyPromptService {
    constructor(private readonly chapters = new TextToImageChapterService()) {}

    async generate(input: BodyPromptRequest, provider: BodyPromptProvider): Promise<{inserted: number; skipped: number; promptIds: string[]; warnings: string[]}> {
        const snapshot = await this.chapters.snapshot(input.projectPath, input.chapterPath);
        if (snapshot.hash !== input.chapterHash) {
            throw new TextToImageChapterConflictError();
        }
        const characterContext = await resolveProjectBodyImageCharacterTagContext({
            projectPath: input.projectPath,
            chapterPath: input.chapterPath,
            chapterMarkdown: snapshot.markdown,
            promptRules: input.promptRules,
        });
        const reply = await requestTextToImageLlmCompletion({
            ...provider,
            parameters: input.parameters,
            stream: false,
            messages: buildMessages(snapshot.markdown, input.taskPrompt, characterContext.requestVariables.characterImageTags ?? ""),
        });
        const prompts = extractImagePrompts(reply);
        if (prompts.length === 0) {
            return {inserted: 0, skipped: 0, promptIds: [], warnings: [...characterContext.warnings, "LLM 回复中没有有效的 <image>...</image> 块。"]};
        }
        const paragraphs = collectParagraphs(snapshot.markdown);
        const placement = await resolveBodyImagePromptPlacements({
            projectPath: input.projectPath,
            chapterPath: input.chapterPath,
            chapterMarkdown: snapshot.markdown,
            paragraphs: paragraphs.map((paragraph, index) => ({id: paragraph.id, index, text: paragraph.text})),
            prompts: prompts.map((prompt, order) => ({id: prompt.id, order, prompt: prompt.prompt, responseIndex: order, nearbyText: ""})),
            characterIds: characterContext.matchedCharacters.map((character) => character.id),
            llmReply: reply,
        });
        const acceptedPlacements = placement.placements.filter((item) => item.confidence >= 0.65);
        const rejectedPlacements = placement.placements.length - acceptedPlacements.length;
        const promptById = new Map(prompts.map((prompt) => [prompt.id, prompt]));
        const compilerWarnings: string[] = [];
        const result = await this.chapters.insertPrompts({
            projectPath: input.projectPath,
            chapterPath: input.chapterPath,
            expectedHash: snapshot.hash,
            paragraphs,
            prompts: acceptedPlacements.flatMap((item) => {
                const prompt = promptById.get(item.promptId);
                if (!prompt) {
                    return [];
                }
                const compiled = compileTextToImagePrompt({
                    basePrompt: prompt.prompt,
                    baseNegativePrompt: input.defaultNegativePrompt,
                    resolution: {
                        promptId: prompt.id,
                        afterParagraphId: item.afterParagraphId,
                        characterIds: item.characterIds.length > 0
                            ? item.characterIds
                            : characterContext.matchedCharacters.map((character) => character.id),
                        view: item.view,
                        framing: item.framing,
                        rating: item.rating,
                        outfitName: item.outfitName,
                        reason: item.reason,
                        confidence: item.confidence,
                    },
                    characters: characterContext.matchedCharacters,
                    promptRules: input.promptRules,
                });
                compilerWarnings.push(...compiled.warnings);
                return [{
                    afterParagraphId: item.afterParagraphId,
                    payload: {
                        id: prompt.id,
                        prompt: compiled.prompt,
                        negativePrompt: compiled.negativePrompt,
                        characterIds: compiled.characterPrompts.map((character) => character.characterId),
                        sourceChapterHash: snapshot.hash,
                    },
                }];
            }),
        });
        return {
            inserted: result.inserted,
            skipped: result.skipped,
            promptIds: acceptedPlacements.map((item) => item.promptId),
            warnings: [
                ...characterContext.warnings,
                ...placement.warnings,
                ...compilerWarnings,
                ...(rejectedPlacements > 0 ? [`已跳过 ${rejectedPlacements} 个低于 0.65 置信度的插图定位结果。`] : []),
            ],
        };
    }
}

function buildMessages(chapterMarkdown: string, taskPrompt: string, characterTags: string): Array<{role: "system" | "user"; content: string}> {
    return [
        {
            role: "system",
            content: "你是正文文生图提示词助手。仅从当前正文提取适合插图的 NovelAI 英文 tags。每个结果必须使用 <image> 和 </image> 包裹。不要改写正文，不要输出解释。",
        },
        ...(characterTags.trim() ? [{role: "system" as const, content: `仅可使用下列已命中的角色 image-tags：\n${characterTags}`} ] : []),
        ...(taskPrompt.trim() ? [{role: "system" as const, content: taskPrompt.trim()}] : []),
        {role: "user" as const, content: chapterMarkdown},
    ];
}

function extractImagePrompts(reply: string): Array<{id: string; prompt: string}> {
    const pattern = /<image>\s*([\s\S]*?)\s*<\/image>/giu;
    const prompts: Array<{id: string; prompt: string}> = [];
    for (const match of reply.matchAll(pattern)) {
        const prompt = (match[1] ?? "").trim();
        if (prompt) {
            prompts.push({id: `tti-${randomUUID()}`, prompt});
        }
    }
    return prompts;
}

function collectParagraphs(markdown: string): TextToImageChapterParagraph[] {
    const paragraphs: TextToImageChapterParagraph[] = [];
    const pattern = /(^|\n\n+)([^\n][\s\S]*?)(?=\n\n+|$)/gu;
    let index = 0;
    for (const match of markdown.matchAll(pattern)) {
        const prefix = match[1] ?? "";
        const text = match[2] ?? "";
        const start = (match.index ?? 0) + prefix.length;
        const end = start + text.length;
        if (text.trim()) {
            paragraphs.push({id: `p-${index + 1}`, start, end, text});
            index += 1;
        }
    }
    return paragraphs;
}
