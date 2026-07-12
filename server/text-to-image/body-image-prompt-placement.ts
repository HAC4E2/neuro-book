import {z} from "zod";
import {useAgentHarness} from "nbook/server/agent/http";
import type {JsonValue} from "nbook/server/agent/messages/types";

export const BODY_IMAGE_PROMPT_PLACER_PROFILE_KEY = "body-image.prompt-placer";

export const BodyImagePromptPlacementParagraphSchema = z.object({
    id: z.string().trim().min(1),
    index: z.number().int().nonnegative(),
    text: z.string().default(""),
});

export const BodyImagePromptPlacementPromptSchema = z.object({
    id: z.string().trim().min(1),
    order: z.number().int().nonnegative(),
    prompt: z.string().trim().min(1),
    responseIndex: z.number().int().nonnegative(),
    nearbyText: z.string().default(""),
});

export const BodyImagePromptPlacementSchema = z.object({
    promptId: z.string().trim().min(1),
    afterParagraphId: z.string().trim().min(1),
    characterIds: z.array(z.string().trim().min(1)).default([]),
    view: z.enum(["front", "back"]).default("front"),
    framing: z.enum(["face", "upper", "lower", "full"]).default("full"),
    rating: z.enum(["sfw", "nsfw"]).default("sfw"),
    outfitName: z.string().default(""),
    reason: z.string().default(""),
    confidence: z.number().min(0).max(1).default(0.8),
});

export const BodyImagePromptPlacementRequestSchema = z.object({
    projectPath: z.string().trim().min(1),
    chapterPath: z.string().trim().optional().default(""),
    chapterMarkdown: z.string().default(""),
    paragraphs: z.array(BodyImagePromptPlacementParagraphSchema).default([]),
    prompts: z.array(BodyImagePromptPlacementPromptSchema).default([]),
    characterIds: z.array(z.string().trim().min(1)).default([]),
    llmReply: z.string().default(""),
});

export type BodyImagePromptPlacementParagraph = z.infer<typeof BodyImagePromptPlacementParagraphSchema>;
export type BodyImagePromptPlacementPrompt = z.infer<typeof BodyImagePromptPlacementPromptSchema>;
export type BodyImagePromptPlacement = z.infer<typeof BodyImagePromptPlacementSchema>;
export type BodyImagePromptPlacementRequest = z.infer<typeof BodyImagePromptPlacementRequestSchema>;

export type BodyImagePromptPlacementResponse = {
    placements: BodyImagePromptPlacement[];
    warnings: string[];
};

/**
 * 调用正文生图插图定位子 agent，并把结果规整为可直接插入正文的 paragraph placement。
 */
export async function resolveBodyImagePromptPlacements(input: BodyImagePromptPlacementRequest): Promise<BodyImagePromptPlacementResponse> {
    const warnings: string[] = [];
    if (!input.paragraphs.length || !input.prompts.length) {
        return {placements: [], warnings};
    }
    try {
        const placements = await placeBodyImagePromptsWithAgent(input);
        return {
            placements: normalizeBodyImagePromptPlacements({
                paragraphs: input.paragraphs,
                prompts: input.prompts,
                placements,
                characterIds: input.characterIds,
            }),
            warnings,
        };
    } catch (error) {
        warnings.push(`正文生图插图定位子 agent 调用失败，已只使用明确上下文命中的插入点：${error instanceof Error ? error.message : String(error)}`);
        return {
            placements: fallbackPlaceBodyImagePrompts({
                paragraphs: input.paragraphs,
                prompts: input.prompts,
                characterIds: input.characterIds,
            }),
            warnings,
        };
    }
}

/**
 * 过滤子 agent 返回的无效位置，确保 prompt 和段落都来自本次请求。
 */
export function normalizeBodyImagePromptPlacements(input: {
    paragraphs: BodyImagePromptPlacementParagraph[];
    prompts: BodyImagePromptPlacementPrompt[];
    placements: BodyImagePromptPlacement[];
    characterIds?: string[];
}): BodyImagePromptPlacement[] {
    const paragraphIds = new Set(input.paragraphs.map((paragraph) => paragraph.id));
    const promptIds = new Set(input.prompts.map((prompt) => prompt.id));
    const allowedCharacterIds = new Set(input.characterIds ?? []);
    const seenPromptIds = new Set<string>();
    const normalized: BodyImagePromptPlacement[] = [];
    for (const placement of input.placements) {
        const promptId = placement.promptId.trim();
        const afterParagraphId = placement.afterParagraphId.trim();
        if (!promptIds.has(promptId) || !paragraphIds.has(afterParagraphId) || seenPromptIds.has(promptId)) {
            continue;
        }
        seenPromptIds.add(promptId);
        normalized.push({
            promptId,
            afterParagraphId,
            characterIds: (placement.characterIds ?? []).filter((characterId) => allowedCharacterIds.has(characterId)),
            view: placement.view ?? "front",
            framing: placement.framing ?? "full",
            rating: placement.rating ?? "sfw",
            outfitName: placement.outfitName?.trim() ?? "",
            reason: placement.reason.trim() || "子 agent 判定该插图适合放在此段落后。",
            confidence: clampConfidence(placement.confidence),
        });
    }
    return normalized;
}

/**
 * 子 agent 不可用时，只把带有明确 nearbyText 的 prompt 放到命中段落后。
 */
export function fallbackPlaceBodyImagePrompts(input: {
    paragraphs: BodyImagePromptPlacementParagraph[];
    prompts: BodyImagePromptPlacementPrompt[];
    characterIds?: string[];
}): BodyImagePromptPlacement[] {
    const placements: BodyImagePromptPlacement[] = [];
    for (const prompt of input.prompts) {
        const nearbyText = prompt.nearbyText.trim();
        if (!nearbyText) {
            continue;
        }
        const paragraph = input.paragraphs.find((item) => nearbyText.includes(item.text.trim()) || item.text.includes(nearbyText));
        if (!paragraph) {
            continue;
        }
        placements.push({
            promptId: prompt.id,
            afterParagraphId: paragraph.id,
            characterIds: [],
            view: "front",
            framing: "full",
            rating: "sfw",
            outfitName: "",
            reason: "LLM 回复上下文明确命中该段落。",
            confidence: 0.7,
        });
    }
    return normalizeBodyImagePromptPlacements({
        paragraphs: input.paragraphs,
        prompts: input.prompts,
        placements,
        characterIds: input.characterIds,
    });
}

async function placeBodyImagePromptsWithAgent(input: BodyImagePromptPlacementRequest): Promise<BodyImagePromptPlacement[]> {
    const harness = useAgentHarness();
    const projectSlug = normalizeProjectSlug(input.projectPath);
    const existingSessions = await harness.listSessions({
        projectPath: projectSlug,
        profileKey: BODY_IMAGE_PROMPT_PLACER_PROFILE_KEY,
        includeArchived: false,
        includeSystem: true,
        limit: 1,
    });
    const sessionId = existingSessions[0]?.sessionId ?? (await harness.createAgent({
        profileKey: BODY_IMAGE_PROMPT_PLACER_PROFILE_KEY,
        initial: {},
        workspaceRoot: "workspace",
        workspaceKey: projectSlug,
        projectPath: projectSlug,
        title: "正文生图插图定位",
    })).sessionId;
    const result = await harness.invokeAgent({
        sessionId,
        mode: "prompt",
        message: {text: "为正文生图 prompt 选择最适合插入的段落，只返回 report_result.data。"},
        payload: {
            chapterPath: input.chapterPath,
            chapterMarkdown: input.chapterMarkdown,
            paragraphs: input.paragraphs,
            prompts: input.prompts,
            llmReply: input.llmReply,
        } satisfies JsonValue,
        caller: {kind: "system", profileKey: BODY_IMAGE_PROMPT_PLACER_PROFILE_KEY},
    });
    if (result.status !== "completed") {
        throw new Error(result.error ?? `正文生图插图定位子 agent 未完成：${result.status}`);
    }
    return readAgentPlacements(result.reportResult?.data);
}

function readAgentPlacements(data: unknown): BodyImagePromptPlacement[] {
    if (!data || typeof data !== "object" || !("placements" in data) || !Array.isArray(data.placements)) {
        throw new Error("正文生图插图定位子 agent 没有返回 placements。");
    }
    return data.placements
        .filter((item): item is Partial<BodyImagePromptPlacement> => Boolean(item) && typeof item === "object")
        .map((item) => ({
            promptId: typeof item.promptId === "string" ? item.promptId : "",
            afterParagraphId: typeof item.afterParagraphId === "string" ? item.afterParagraphId : "",
            characterIds: Array.isArray(item.characterIds) ? item.characterIds.filter((value): value is string => typeof value === "string") : [],
            view: item.view === "back" ? "back" : "front",
            framing: item.framing === "face" || item.framing === "upper" || item.framing === "lower" ? item.framing : "full",
            rating: item.rating === "nsfw" ? "nsfw" : "sfw",
            outfitName: typeof item.outfitName === "string" ? item.outfitName : "",
            reason: typeof item.reason === "string" ? item.reason : "",
            confidence: typeof item.confidence === "number" ? item.confidence : 0.8,
        }));
}

function normalizeProjectSlug(projectPath: string): string {
    const normalized = projectPath.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/gu, "");
    return normalized.startsWith("workspace/") ? normalized.slice("workspace/".length) : normalized;
}

function clampConfidence(value: number): number {
    if (!Number.isFinite(value)) {
        return 0.8;
    }
    return Math.min(1, Math.max(0, value));
}
