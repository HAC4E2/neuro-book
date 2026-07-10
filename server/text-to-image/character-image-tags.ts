import YAML from "yaml";
import {z} from "zod";
import {requestTextToImageLlmCompletion} from "nbook/server/text-to-image/llm-provider";
import {parseTextToImageCharacterDraft} from "nbook/app/utils/text-to-image-character-design";
import {
    renderTextToImageCharacterImageTagsMarkdown,
    type TextToImageCharacterImageTag,
} from "nbook/app/utils/text-to-image-character-tags";
import {useAgentHarness} from "nbook/server/agent/http";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";
import {invalidateProjectWorkspaceIndexAfterMutation} from "nbook/server/workspace-files/project-workspace-index";
import {readWorkspaceTextFile, statWorkspacePath, writeWorkspaceTextFile, type WorkspaceFileNode} from "nbook/server/workspace-files/workspace-files";

export const CHARACTER_IMAGE_TAG_EXTRACTOR_PROFILE_KEY = "character-image-tag.extractor";

export const CharacterImageTagsGenerateRequestSchema = z.object({
    projectPath: z.string().trim().min(1),
    characterPath: z.string().trim().min(1),
    characterTitle: z.string().trim().default(""),
    characterMarkdown: z.string().default(""),
    taskPrompt: z.string().default(""),
    llm: z.object({
        apiBaseUrl: z.string().trim().min(1),
        apiKey: z.string().default(""),
        model: z.string().trim().min(1),
        parameters: z.object({
            temperature: z.number().default(0.7),
            topP: z.number().default(1),
            maxTokens: z.number().int().positive().default(4096),
        }),
    }),
});

export type CharacterImageTagsGenerateRequest = z.infer<typeof CharacterImageTagsGenerateRequestSchema>;

export type CharacterImageTagPaths = {
    characterDirectoryPath: string;
    detailPath: string;
    imageTagsPath: string;
    shouldCopyDetailFile: boolean;
};

export type CharacterImageAppearanceExtraction = {
    cnName: string;
    aliases: string[];
    enName: string;
    appearanceFacts: string;
    note: string;
};

export type CharacterImageTagsGenerateResult = {
    characterDirectoryPath: string;
    detailPath: string;
    imageTagsPath: string;
    content: string;
    node: WorkspaceFileNode;
    warnings: string[];
};

type CharacterImageTagDraft = {
    cnName?: string;
    enName?: string;
    profileTraits?: string;
    facialAppearance?: string;
    facialBack?: string;
    upperSfw?: string;
    upperBackSfw?: string;
    lowerSfw?: string;
    lowerBackSfw?: string;
    upperNsfw?: string;
    upperBackNsfw?: string;
    lowerNsfw?: string;
    lowerBackNsfw?: string;
    negativePrompt?: string;
};

/**
 * 生成或覆盖角色目录下的 image-tags.md。
 */
export async function generateCharacterImageTags(input: CharacterImageTagsGenerateRequest): Promise<CharacterImageTagsGenerateResult> {
    const root = await resolveWorkspaceRootInput({projectPath: input.projectPath});
    const characterMarkdown = input.characterMarkdown || await readWorkspaceTextFile(root, input.characterPath);
    const paths = resolveCharacterImageTagPaths({
        characterPath: input.characterPath,
        characterTitle: input.characterTitle,
    });
    const warnings: string[] = [];
    const extraction = await extractCharacterAppearanceWithAgent({
        projectPath: input.projectPath,
        characterPath: input.characterPath,
        characterTitle: input.characterTitle,
        characterMarkdown,
    }, warnings);
    const llmReply = await requestCharacterImageTagDraft(input, extraction);
    const draft = parseTextToImageCharacterDraft(llmReply) as CharacterImageTagDraft;
    const tag = buildCharacterImageTagFromDraft({
        id: createImageTagId(paths.imageTagsPath),
        sourcePath: paths.imageTagsPath,
        fallbackCnName: [extraction.cnName, ...extraction.aliases].filter(Boolean).join("|") || input.characterTitle,
        fallbackEnName: extraction.enName,
        draft,
    });
    const content = renderTextToImageCharacterImageTagsMarkdown(tag);
    if (paths.shouldCopyDetailFile) {
        await writeWorkspaceTextFile(root, paths.detailPath, characterMarkdown);
    }
    await writeWorkspaceTextFile(root, paths.imageTagsPath, content);
    invalidateProjectWorkspaceIndexAfterMutation({root});
    return {
        characterDirectoryPath: paths.characterDirectoryPath,
        detailPath: paths.detailPath,
        imageTagsPath: paths.imageTagsPath,
        content,
        node: await statWorkspacePath(root, paths.imageTagsPath),
        warnings,
    };
}

/**
 * 解析角色详情页对应的生图角色目录。现有 index.md 内容节点不移动。
 */
export function resolveCharacterImageTagPaths(input: {
    characterPath: string;
    characterTitle: string;
}): CharacterImageTagPaths {
    const characterPath = normalizeWorkspacePath(input.characterPath);
    if (characterPath.toLocaleLowerCase().endsWith("/index.md")) {
        const characterDirectoryPath = characterPath.slice(0, -"/index.md".length);
        return {
            characterDirectoryPath,
            detailPath: `${characterDirectoryPath}/index.md`,
            imageTagsPath: `${characterDirectoryPath}/image-tags.md`,
            shouldCopyDetailFile: false,
        };
    }
    const parentPath = characterPath.includes("/") ? characterPath.slice(0, characterPath.lastIndexOf("/")) : "";
    const characterDirectoryPath = [parentPath, sanitizeCharacterDirectoryName(input.characterTitle || stripExtension(basename(characterPath)))].filter(Boolean).join("/");
    return {
        characterDirectoryPath,
        detailPath: `${characterDirectoryPath}/index.md`,
        imageTagsPath: `${characterDirectoryPath}/image-tags.md`,
        shouldCopyDetailFile: true,
    };
}

/**
 * 将 LLM 角色草稿补齐为标准 image-tags 数据。
 */
export function buildCharacterImageTagFromDraft(input: {
    id: string;
    sourcePath: string;
    fallbackCnName: string;
    fallbackEnName: string;
    draft: CharacterImageTagDraft;
}): TextToImageCharacterImageTag {
    const cnName = readDraftField(input.draft.cnName, input.fallbackCnName);
    return {
        id: input.id,
        sourcePath: input.sourcePath,
        cnName,
        cnAliases: cnName.split(/[|｜]/u).map((item) => item.trim()).filter(Boolean),
        enName: readDraftField(input.draft.enName, input.fallbackEnName),
        profileTraits: readDraftField(input.draft.profileTraits),
        facialAppearance: readDraftField(input.draft.facialAppearance),
        facialBack: readDraftField(input.draft.facialBack),
        upperSfw: readDraftField(input.draft.upperSfw),
        upperBackSfw: readDraftField(input.draft.upperBackSfw),
        lowerSfw: readDraftField(input.draft.lowerSfw),
        lowerBackSfw: readDraftField(input.draft.lowerBackSfw),
        upperNsfw: readDraftField(input.draft.upperNsfw),
        upperBackNsfw: readDraftField(input.draft.upperBackNsfw),
        lowerNsfw: readDraftField(input.draft.lowerNsfw),
        lowerBackNsfw: readDraftField(input.draft.lowerBackNsfw),
        negativePrompt: readDraftField(input.draft.negativePrompt),
        outfits: [],
    };
}

async function extractCharacterAppearanceWithAgent(input: {
    projectPath: string;
    characterPath: string;
    characterTitle: string;
    characterMarkdown: string;
}, warnings: string[]): Promise<CharacterImageAppearanceExtraction> {
    try {
        return await invokeCharacterImageTagExtractor(input);
    } catch (error) {
        warnings.push(`角色外貌提取子 agent 调用失败，已退回本地字段提取：${error instanceof Error ? error.message : String(error)}`);
        return fallbackExtractCharacterAppearance(input.characterMarkdown, input.characterTitle);
    }
}

async function invokeCharacterImageTagExtractor(input: {
    projectPath: string;
    characterPath: string;
    characterTitle: string;
    characterMarkdown: string;
}): Promise<CharacterImageAppearanceExtraction> {
    const harness = useAgentHarness();
    const projectSlug = normalizeProjectSlug(input.projectPath);
    const existingSessions = await harness.listSessions({
        projectPath: projectSlug,
        profileKey: CHARACTER_IMAGE_TAG_EXTRACTOR_PROFILE_KEY,
        includeArchived: false,
        includeSystem: true,
        limit: 1,
    });
    const sessionId = existingSessions[0]?.sessionId ?? (await harness.createAgent({
        profileKey: CHARACTER_IMAGE_TAG_EXTRACTOR_PROFILE_KEY,
        initial: {},
        workspaceRoot: "workspace",
        workspaceKey: projectSlug,
        projectPath: projectSlug,
        title: "角色生图信息提取",
    })).sessionId;
    const result = await harness.invokeAgent({
        sessionId,
        mode: "prompt",
        message: {text: "从角色详情页提取用于生图 tag 生成的外貌信息，只返回 report_result.data。"},
        payload: {
            characterPath: input.characterPath,
            characterTitle: input.characterTitle,
            characterMarkdown: input.characterMarkdown,
        } satisfies JsonValue,
        caller: {kind: "system", profileKey: CHARACTER_IMAGE_TAG_EXTRACTOR_PROFILE_KEY},
    });
    if (result.status !== "completed") {
        throw new Error(result.error ?? `角色生图信息提取子 agent 未完成：${result.status}`);
    }
    return readExtraction(result.reportResult?.data, input.characterMarkdown, input.characterTitle);
}

function readExtraction(data: unknown, characterMarkdown: string, characterTitle: string): CharacterImageAppearanceExtraction {
    if (!data || typeof data !== "object") {
        throw new Error("角色生图信息提取子 agent 没有返回对象。");
    }
    const record = data as Record<string, unknown>;
    const fallback = fallbackExtractCharacterAppearance(characterMarkdown, characterTitle);
    return {
        cnName: readString(record.cnName, fallback.cnName),
        aliases: readStringArray(record.aliases).length > 0 ? readStringArray(record.aliases) : fallback.aliases,
        enName: readString(record.enName, fallback.enName),
        appearanceFacts: readString(record.appearanceFacts, fallback.appearanceFacts),
        note: readString(record.note, ""),
    };
}

function fallbackExtractCharacterAppearance(characterMarkdown: string, characterTitle: string): CharacterImageAppearanceExtraction {
    const parsed = parseMarkdownDocument(characterMarkdown);
    const character = readRecord(parsed.frontmatter.character);
    const profile = readRecord(character.profile);
    const aliases = readStringArray(parsed.frontmatter.aliases);
    const cnName = readString(parsed.frontmatter.title, characterTitle);
    const lines = [
        renderFact("角色名", cnName),
        renderFact("别名", aliases.join("|")),
        renderFact("简介", readString(parsed.frontmatter.summary, "")),
        renderFact("性别", readString(profile.gender, "")),
        renderFact("年龄", readString(profile.age, "")),
        renderFact("种族", readString(profile.race, "")),
        renderFact("身份", readString(profile.identity, "")),
        renderFact("外貌", readString(profile.appearance, "")),
        renderFact("身体特征", readStringArray(profile.bodyFeatures).join(", ")),
        renderFact("服装风格", readString(profile.clothingStyle, "")),
        renderFact("气质", readString(profile.temperament, "")),
        renderFact("性格特征", readStringArray(profile.personalityTraits).join(", ")),
        renderFact("正文补充", parsed.body.trim().slice(0, 3000)),
    ].filter(Boolean);
    return {
        cnName,
        aliases,
        enName: "",
        appearanceFacts: lines.join("\n"),
        note: "fallback",
    };
}

async function requestCharacterImageTagDraft(input: CharacterImageTagsGenerateRequest, extraction: CharacterImageAppearanceExtraction): Promise<string> {
    const content = await requestTextToImageLlmCompletion({
        apiBaseUrl: input.llm.apiBaseUrl,
        apiKey: input.llm.apiKey,
        model: input.llm.model,
        parameters: input.llm.parameters,
        stream: false,
        messages: buildCharacterImageTagLlmMessages(input, extraction),
    });
    if (!content) {
        throw new Error("LLM 没有返回可用角色 tag。");
    }
    return content;
}

function buildCharacterImageTagLlmMessages(input: CharacterImageTagsGenerateRequest, extraction: CharacterImageAppearanceExtraction): Array<{role: "system" | "user"; content: string}> {
    const systemPrompt = input.taskPrompt.trim() || [
        "你是 NovelAI 角色 image-tags.md 生成助手。",
        "调用方已经用子 agent 提取了角色外貌事实。请只根据这些事实生成生图相关 tags。",
        "只返回 JSON，不要解释，不要 Markdown。JSON 结构必须是 {\"character\": {...}}。",
        "字段使用中文字段名：角色中文名称、角色英文名称、角色特征、五官外貌、五官外貌背面、上半身SFW、上半身背面SFW、下半身SFW、下半身背面SFW、上半身NSFW、上半身NSFW背面、下半身NSFW、下半身NSFW背面、负面提示词。",
    ].join("\n");
    return [
        {role: "system", content: systemPrompt},
        {
            role: "user",
            content: JSON.stringify({
                task: "characterImageTags",
                request: {
                    characterPath: input.characterPath,
                    characterTitle: input.characterTitle,
                    cnName: extraction.cnName,
                    aliases: extraction.aliases,
                    enName: extraction.enName,
                    appearanceFacts: extraction.appearanceFacts,
                },
            }, null, 2),
        },
    ];
}

function parseMarkdownDocument(content: string): {frontmatter: Record<string, unknown>; body: string} {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
    if (!match) {
        return {frontmatter: {}, body: content};
    }
    try {
        const parsed = YAML.parse(match[1] ?? "", {logLevel: "silent"}) as unknown;
        return {
            frontmatter: readRecord(parsed),
            body: content.slice(match[0].length),
        };
    } catch {
        return {frontmatter: {}, body: content.slice(match[0].length)};
    }
}

function normalizeWorkspacePath(value: string): string {
    return value.trim().replaceAll("\\", "/").replace(/^workspace\/[^/]+\//u, "").replace(/\/+$/u, "");
}

function sanitizeCharacterDirectoryName(value: string): string {
    const sanitized = value
        .trim()
        .replace(/[\\/:*?"<>|\u0000-\u001F]+/gu, "-")
        .replace(/\s+/gu, "-")
        .replace(/-+/gu, "-")
        .replace(/^-|-$/gu, "");
    return sanitized || "unnamed-character";
}

function createImageTagId(imageTagsPath: string): string {
    return imageTagsPath.replace(/\/image-tags\.md$/iu, "").replace(/[^A-Za-z0-9_-]+/gu, "-").replace(/^-|-$/gu, "");
}

function normalizeProjectSlug(projectPath: string): string {
    return projectPath.trim().replaceAll("\\", "/").replace(/^workspace\//u, "").replace(/\/+$/u, "");
}

function stripExtension(value: string): string {
    return value.replace(/\.[^.]+$/u, "");
}

function basename(value: string): string {
    return value.includes("/") ? value.slice(value.lastIndexOf("/") + 1) : value;
}

function readDraftField(value: string | undefined, fallback = ""): string {
    return typeof value === "string" && value.trim() ? value.trim() : fallback.trim();
}

function readRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function renderFact(label: string, value: string): string {
    return value.trim() ? `${label}: ${value.trim()}` : "";
}
