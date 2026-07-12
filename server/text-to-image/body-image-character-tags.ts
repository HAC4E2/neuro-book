import fs from "node:fs/promises";
import path from "node:path";
import {consola} from "consola";
import {z} from "zod";
import {
    parseTextToImageCharacterImageTags,
    renderTextToImageCharacterTagsForLlm,
    type TextToImageCharacterImageTag,
} from "nbook/app/utils/text-to-image-character-tags";
import {parseTextToImageOutfitTags} from "nbook/app/utils/text-to-image-outfit-tags";
import type {TextToImagePromptReplacementRule} from "nbook/app/utils/text-to-image-prompt-engine";
import {useAgentHarness} from "nbook/server/agent/http";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {resolveProjectAbsolutePath} from "nbook/server/workspace-files/project-workspace";

export const BODY_IMAGE_CHARACTER_DETECTOR_PROFILE_KEY = "body-image.character-detector";

export const BodyImageCharacterTagsRequestSchema = z.object({
    projectPath: z.string().trim().min(1),
    chapterPath: z.string().trim().optional().default(""),
    chapterMarkdown: z.string().default(""),
    promptRules: z.array(z.object({
        id: z.string().default(""),
        name: z.string().default(""),
        enabled: z.boolean().default(true),
        target: z.enum(["positive", "negative"]).default("positive"),
        matchMode: z.enum(["plain", "regex"]).default("plain"),
        mode: z.enum(["replace", "append", "prepend", "delete"]).default("replace"),
        trigger: z.string().default(""),
        replacement: z.string().default(""),
    })).default([]),
});

export type BodyImageCharacterTagsRequest = z.infer<typeof BodyImageCharacterTagsRequestSchema>;

export type BodyImageCharacterMatch = {
    id: string;
    sourcePath: string;
    reason: string;
    confidence: number;
};

export type BodyImageCharacterTagContext = {
    matchedCharacters: TextToImageCharacterImageTag[];
    detectorMatches: BodyImageCharacterMatch[];
    requestVariables: Record<string, string>;
    warnings: string[];
};

export type BodyImageCharacterDetect = (input: {
    chapterMarkdown: string;
    candidates: TextToImageCharacterImageTag[];
}) => Promise<BodyImageCharacterMatch[]>;

/**
 * 组装正文生图 LLM 请求变量，只注入识别器命中的角色 image-tags。
 */
export async function buildBodyImageCharacterTagContext(input: {
    chapterMarkdown: string;
    candidates: TextToImageCharacterImageTag[];
    promptRules: TextToImagePromptReplacementRule[];
    detect?: BodyImageCharacterDetect;
}): Promise<BodyImageCharacterTagContext> {
    const warnings: string[] = [];
    const detectorMatches = await resolveDetectorMatches(input, warnings);
    const matchedCharacters = detectorMatches
        .map((match) => input.candidates.find((candidate) => candidate.id === match.id || candidate.sourcePath === match.sourcePath))
        .filter((candidate): candidate is TextToImageCharacterImageTag => Boolean(candidate));
    const characterImageTags = renderTextToImageCharacterTagsForLlm(matchedCharacters);
    const detectorReport = detectorMatches.length > 0
        ? detectorMatches.map((match) => `${match.sourcePath}: ${match.reason} (${match.confidence.toFixed(2)})`).join("\n")
        : "未识别到相关角色。";

    return {
        matchedCharacters,
        detectorMatches,
        requestVariables: {
            characterImageTags,
            characterDetectorReport: detectorReport,
            characters: characterImageTags,
            outfits: "",
            promptRules: JSON.stringify(input.promptRules.map((rule) => ({
                id: rule.id,
                name: rule.name,
                enabled: rule.enabled,
                target: rule.target,
                matchMode: rule.matchMode,
                mode: rule.mode,
                trigger: rule.trigger,
                replacement: rule.replacement,
            })), null, 2),
        },
        warnings,
    };
}

/**
 * 无模型或识别器失败时的本地保底：章节正文包含任意中文别名即命中。
 */
export function fallbackDetectBodyImageCharacterTags(chapterMarkdown: string, candidates: TextToImageCharacterImageTag[]): BodyImageCharacterMatch[] {
    return candidates
        .filter((candidate) => characterAliases(candidate).some((alias) => aliasMatchesChapter(alias, chapterMarkdown)))
        .map((candidate) => ({
            id: candidate.id,
            sourcePath: candidate.sourcePath,
            reason: "正文命中角色中文名称别名。",
            confidence: 0.7,
        }));
}

/**
 * 从 Project Workspace 的 lorebook 目录递归读取 image-tags.md。
 */
export async function listProjectCharacterImageTags(projectPathInput: string): Promise<TextToImageCharacterImageTag[]> {
    const projectPath = normalizeBodyImageProjectPath(projectPathInput);
    const projectRoot = resolveProjectAbsolutePath(projectPath);
    const tagPaths = await findImageTagFiles(path.join(projectRoot, "lorebook"));
    const tags: TextToImageCharacterImageTag[] = [];
    for (const absolutePath of tagPaths) {
        const relativePath = path.relative(projectRoot, absolutePath).split(path.sep).join("/");
        const content = await fs.readFile(absolutePath, "utf-8");
        const tag = parseTextToImageCharacterImageTags(content, {
            id: createImageTagId(relativePath),
            sourcePath: relativePath,
        });
        tags.push(await hydrateCharacterOutfits(projectRoot, tag));
    }
    return tags;
}

/**
 * 跟随角色 image-tags.md 中的显式索引读取独立服装文件，路径必须留在当前 Project Workspace 内。
 */
export async function hydrateCharacterOutfits(
    projectRoot: string,
    character: TextToImageCharacterImageTag,
): Promise<TextToImageCharacterImageTag> {
    const resolvedRoot = path.resolve(projectRoot);
    const outfits = await Promise.all(character.outfits.map(async (outfit) => {
        const absolutePath = path.resolve(resolvedRoot, outfit.sourcePath);
        const relativePath = path.relative(resolvedRoot, absolutePath);
        if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
            return outfit;
        }
        try {
            const content = await fs.readFile(absolutePath, "utf-8");
            return parseTextToImageOutfitTags(content, {sourcePath: outfit.sourcePath});
        } catch (error) {
            if (isNotFoundError(error)) {
                return outfit;
            }
            throw error;
        }
    }));
    return {...character, outfits};
}

/**
 * 读取 Project image-tags，并调用专用子 agent 识别章节相关角色。
 */
export async function resolveProjectBodyImageCharacterTagContext(input: BodyImageCharacterTagsRequest): Promise<BodyImageCharacterTagContext> {
    const candidates = await listProjectCharacterImageTags(input.projectPath);
    return buildBodyImageCharacterTagContext({
        chapterMarkdown: input.chapterMarkdown,
        candidates,
        promptRules: input.promptRules,
        detect: (payload) => detectBodyImageCharactersWithAgent({
            projectPath: normalizeBodyImageProjectPath(input.projectPath),
            chapterPath: input.chapterPath,
            chapterMarkdown: payload.chapterMarkdown,
            candidates: payload.candidates,
        }),
    });
}

async function resolveDetectorMatches(input: {
    chapterMarkdown: string;
    candidates: TextToImageCharacterImageTag[];
    detect?: BodyImageCharacterDetect;
}, warnings: string[]): Promise<BodyImageCharacterMatch[]> {
    if (input.candidates.length === 0) {
        return [];
    }
    if (!input.detect) {
        return fallbackDetectBodyImageCharacterTags(input.chapterMarkdown, input.candidates);
    }
    try {
        const matches = await input.detect({
            chapterMarkdown: input.chapterMarkdown,
            candidates: input.candidates,
        });
        return normalizeMatches(matches, input.candidates);
    } catch (error) {
        warnings.push(`角色识别子 agent 调用失败，已退回名称命中：${error instanceof Error ? error.message : String(error)}`);
        return fallbackDetectBodyImageCharacterTags(input.chapterMarkdown, input.candidates);
    }
}

async function detectBodyImageCharactersWithAgent(input: {
    projectPath: string;
    chapterPath: string;
    chapterMarkdown: string;
    candidates: TextToImageCharacterImageTag[];
}): Promise<BodyImageCharacterMatch[]> {
    const harness = useAgentHarness();
    const projectSlug = input.projectPath.slice("workspace/".length);
    const sessionId = (await harness.createAgent({
        profileKey: BODY_IMAGE_CHARACTER_DETECTOR_PROFILE_KEY,
        initial: {},
        workspaceRoot: "workspace",
        workspaceKey: projectSlug,
        projectPath: projectSlug,
        title: "正文生图角色识别",
    })).sessionId;

    try {
        const result = await harness.invokeAgent({
        sessionId,
        mode: "prompt",
        message: {text: "识别这段正文中实际出现或语义相关的角色，只返回 report_result.data。"},
        payload: {
            chapterPath: input.chapterPath,
            chapterMarkdown: input.chapterMarkdown,
            candidates: input.candidates.map((candidate) => ({
                id: candidate.id,
                sourcePath: candidate.sourcePath,
                cnName: candidate.cnName,
                cnAliases: candidate.cnAliases,
                enName: candidate.enName,
            })),
        } satisfies JsonValue,
        caller: {kind: "system", profileKey: BODY_IMAGE_CHARACTER_DETECTOR_PROFILE_KEY},
    });
    if (result.status !== "completed") {
        throw new Error(result.error ?? `角色识别子 agent 未完成：${result.status}`);
    }
        return readAgentMatches(result.reportResult?.data);
    } finally {
        await harness.runCommand(sessionId, {command: "archive", reason: "text-to-image one-shot completed"}).catch((error) => {
            consola.warn({sessionId, error}, "正文生图角色识别 one-shot 会话归档失败");
        });
    }
}

function readAgentMatches(data: unknown): BodyImageCharacterMatch[] {
    if (!data || typeof data !== "object" || !("matches" in data) || !Array.isArray(data.matches)) {
        throw new Error("角色识别子 agent 没有返回 matches。");
    }
    return data.matches
        .filter((item): item is Partial<BodyImageCharacterMatch> => Boolean(item) && typeof item === "object")
        .map((item) => ({
            id: typeof item.id === "string" ? item.id : "",
            sourcePath: typeof item.sourcePath === "string" ? item.sourcePath : "",
            reason: typeof item.reason === "string" ? item.reason : "子 agent 判定相关。",
            confidence: typeof item.confidence === "number" ? item.confidence : 0.8,
        }));
}

function normalizeMatches(matches: BodyImageCharacterMatch[], candidates: TextToImageCharacterImageTag[]): BodyImageCharacterMatch[] {
    const seen = new Set<string>();
    const normalized: BodyImageCharacterMatch[] = [];
    for (const match of matches) {
        const candidate = candidates.find((item) => item.id === match.id || item.sourcePath === match.sourcePath);
        if (!candidate || seen.has(candidate.id)) {
            continue;
        }
        seen.add(candidate.id);
        normalized.push({
            id: candidate.id,
            sourcePath: candidate.sourcePath,
            reason: match.reason.trim() || "识别器判定相关。",
            confidence: clampConfidence(match.confidence),
        });
    }
    return normalized;
}

async function findImageTagFiles(root: string): Promise<string[]> {
    const entries = await fs.readdir(root, {withFileTypes: true}).catch((error) => {
        if (isNotFoundError(error)) {
            return [];
        }
        throw error;
    });
    const result: string[] = [];
    for (const entry of entries) {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            result.push(...await findImageTagFiles(fullPath));
            continue;
        }
        if (entry.isFile() && entry.name.toLocaleLowerCase() === "image-tags.md") {
            result.push(fullPath);
        }
    }
    return result.sort((left, right) => left.localeCompare(right));
}

function normalizeBodyImageProjectPath(input: string): string {
    const normalized = input.trim().replaceAll("\\", "/").replace(/\/+$/gu, "");
    return normalized.startsWith("workspace/") ? normalized : `workspace/${normalized}`;
}

function createImageTagId(relativePath: string): string {
    return relativePath.replace(/\/image-tags\.md$/iu, "").replace(/[^A-Za-z0-9_-]+/gu, "-").replace(/^-|-$/gu, "");
}

function clampConfidence(value: number): number {
    if (!Number.isFinite(value)) {
        return 0.8;
    }
    return Math.min(1, Math.max(0, value));
}

function characterAliases(candidate: TextToImageCharacterImageTag): string[] {
    return [...candidate.cnAliases, candidate.cnName, candidate.enName]
        .flatMap((value) => value.split(/[|｜]/u))
        .map((alias) => alias.trim())
        .filter((alias) => unicodeLetterCount(alias) >= 2);
}

function aliasMatchesChapter(alias: string, chapterMarkdown: string): boolean {
    const escaped = escapeRegExp(alias);
    if (/\p{Script=Han}/u.test(alias)) {
        return new RegExp(`(^|[^\\p{Script=Han}])${escaped}($|[^\\p{Script=Han}])`, "u").test(chapterMarkdown);
    }
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu").test(chapterMarkdown);
}

function unicodeLetterCount(value: string): number {
    return [...value].filter((character) => /\p{L}/u.test(character)).length;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isNotFoundError(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
