import {
    CharacterVisualFieldSchema,
    OutfitVisualSchema,
    parseCharacterVisualJson,
    type CharacterVisualField,
    type CharacterVisualFile,
    type OutfitVisual,
} from "nbook/server/text-to-image/character-visual.codec";
import {
    requestLlmCompletion,
} from "nbook/server/text-to-image/llm-chat";
import {TextToImageLlmProviderSettingsSchema} from "nbook/shared/dto/text-to-image.dto";

export type CharacterVisualDraftMode = "fill_empty" | "replace_visual";

export type GenerateCharacterVisualDraftInput = {
    provider: {
        baseUrl: string;
        credential: string;
        settings: Record<string, unknown>;
    };
    characterId: string;
    characterPage: string;
    existingSummary: string;
    mode: CharacterVisualDraftMode;
};

/** 角色字段中文标签 -> schema 键。 */
const CHARACTER_FIELD_LABELS: Record<string, keyof CharacterVisualField> = {
    "中文名称": "cnName",
    "英文名称": "enName",
    "角色特征": "profileTraits",
    "五官外貌": "facialAppearance",
    "五官外貌背面": "facialBack",
    "上半身SFW": "upperSfw",
    "上半身SFW背面": "upperBackSfw",
    "下半身SFW": "lowerSfw",
    "下半身SFW背面": "lowerBackSfw",
    "上半身NSFW": "upperNsfw",
    "上半身NSFW背面": "upperBackNsfw",
    "下半身NSFW": "lowerNsfw",
    "下半身NSFW背面": "lowerBackNsfw",
    "负面": "negativePrompt",
};

/** 服装字段中文标签 -> schema 键。 */
const OUTFIT_FIELD_LABELS: Record<string, keyof OutfitVisual> = {
    "中文名称": "cnName",
    "英文名称": "enName",
    "上半身": "upper",
    "上半身背面": "upperBack",
    "下半身": "lower",
    "下半身背面": "lowerBack",
};

const CHARACTER_FIELD_KEYS = Object.keys(CharacterVisualFieldSchema.shape) as Array<keyof CharacterVisualField>;
const OUTFIT_FIELD_KEYS = Object.keys(OutfitVisualSchema.shape) as Array<keyof OutfitVisual>;

/** LLM 草稿：characterId 尚未填充，交给 generateCharacterVisualDraft 收口。 */
type CharacterVisualDraft = {
    schema: "nbook.character-visual/v1";
    characterId: string;
    character: CharacterVisualField;
    outfits: OutfitVisual[];
    photos: string[];
};

/**
 * 角色视觉 system prompt：对齐 chatu8 角色/服装设计预设的 12+4 字段契约，
 * 输出同时接受 `<人物>/<服装>` 行式或 JSON 对象。
 */
export function buildCharacterVisualSystemPrompt(): string {
    return [
        "你是角色视觉设计师，把小说角色页转换成 Stable Diffusion / Danbooru 风格的英文绘图 tag。",
        "",
        "角色字段（每个字段一行 `字段名:内容`，内容全部使用英文 tag；中文名称、英文名称除外）：",
        "中文名称",
        "英文名称",
        "角色特征",
        "五官外貌",
        "五官外貌背面",
        "上半身SFW",
        "上半身SFW背面",
        "下半身SFW",
        "下半身SFW背面",
        "上半身NSFW",
        "上半身NSFW背面",
        "下半身NSFW",
        "下半身NSFW背面",
        "负面",
        "",
        "服装字段：",
        "中文名称",
        "英文名称",
        "上半身",
        "上半身背面",
        "下半身",
        "下半身背面",
        "",
        "POV 正背互斥规则：",
        "正面和背面互斥调用，生成时只会取其中一侧；共有特征（头发、体型、腿型等）必须在正背两个字段都重复写。",
        "背面只能写该视角可见的内容：五官背面不能写眼睛、鼻子、嘴巴；上半身背面不能写胸部；下半身背面不能写正面生殖器。",
        "",
        "SFW/NSFW 区别：",
        "SFW 字段用于穿衣场景，会与服装一起调用，禁止 bare/nude/naked 等裸露 tag，否则服装无法正确显示；只写穿衣状态可见的身体轮廓。",
        "NSFW 字段用于赤裸场景单独调用，可以写裸露与身体细节。",
        "",
        "Tag 语法：",
        "(tag) 表示轻微强调，(tag:1.5) 表示精确权重；多个词组成的特征用空格连接，多个 tag 用英文逗号分隔；避免中文 tag。",
        "角色设计只描述静态外貌特征，不包含表情、动作、姿势。每个字段控制在 10 个 tag 以内。",
        "",
        "输出格式：",
        "只输出一组 <人物>...</人物> 与 <服装>...</服装>（字段行格式 `字段名:内容`），",
        "或等价的 JSON 对象（character/outfits 键，字段名可用英文或中文标签），不要输出解释文字。",
    ].join("\n");
}

/**
 * 组装角色视觉 user prompt。
 * fill_empty 只补空字段并保留既有内容；replace_visual 按角色页整体重写。
 */
export function buildCharacterVisualUserPrompt(input: {
    characterPage: string;
    existingSummary: string;
    mode: CharacterVisualDraftMode;
}): string {
    const modeInstruction = input.mode === "fill_empty"
        ? "本次是补全模式：只补全为空或缺失的字段；已有非空内容必须逐字保留，不要改写、精简或删除。"
        : "本次是整体重写模式：根据角色资料重新设计全部字段，不受既有内容限制。";
    return [
        "以下是角色资料页：",
        "---",
        input.characterPage,
        "---",
        "既有角色视觉摘要（空表示没有）：",
        input.existingSummary.trim() === "" ? "（无）" : input.existingSummary,
        "---",
        modeInstruction,
        "请只输出 <人物>...</人物> 与 <服装>...</服装> 或 JSON 对象。",
    ].join("\n");
}

/**
 * 解析 LLM 返回的角色视觉草稿。
 * 支持 JSON 对象（含中文标签/`角色设计` 包裹）与 `<人物>/<服装>` 行式；
 * 解析失败抛错，错误信息包含输入片段与原因。
 */
export function parseCharacterVisualDraft(text: string): CharacterVisualFile {
    const cleaned = cleanDraftText(text);
    const jsonResult = tryParseJsonDraft(cleaned);
    if (jsonResult.draft) {
        return jsonResult.draft;
    }
    try {
        return parseLabeledDraft(cleaned);
    } catch (lineError) {
        throw new Error(buildParseError(cleaned, jsonResult.error, toError(lineError)));
    }
}

/**
 * 调用 LLM 生成角色视觉草稿并解析。
 * complete 供测试注入；解析失败最多重试 2 次，仍失败抛错。
 */
export async function generateCharacterVisualDraft(
    input: GenerateCharacterVisualDraftInput,
    complete: typeof requestLlmCompletion = requestLlmCompletion,
): Promise<CharacterVisualFile> {
    // provider.baseUrl 是运行态显式传入的连接地址；settings 里同名字段仅作兼容备份。
    const settings = TextToImageLlmProviderSettingsSchema.parse({
        ...input.provider.settings,
        baseUrl: input.provider.baseUrl,
    });
    const existing = parseExistingSummary(input.existingSummary);
    const systemPrompt = buildCharacterVisualSystemPrompt();
    const userPrompt = buildCharacterVisualUserPrompt(input);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const content = await complete({
            baseUrl: input.provider.baseUrl,
            credential: input.provider.credential,
            model: settings.model,
            temperature: settings.temperature,
            topP: settings.topP,
            maxTokens: 4096,
            stream: settings.stream,
            sendImages: settings.sendImages,
            mergeSystemUser: settings.mergeSystemUser,
            retryCount: settings.retryCount,
            messages: [
                {role: "system", content: systemPrompt},
                {role: "user", content: userPrompt},
            ],
        });
        try {
            return finalizeDraft(parseCharacterVisualDraft(content), input, existing);
        } catch (error) {
            lastError = toError(error);
        }
    }

    throw new Error(`角色视觉草稿解析失败：重试 2 次后仍未成功；最后原因：${lastError?.message ?? "未知"}`);
}

function cleanDraftText(text: string): string {
    return text
        .trim()
        .replace(/```json\s*/giu, "")
        .replace(/```/gu, "")
        .trim();
}

function tryParseJsonDraft(text: string): {draft: CharacterVisualDraft | null; error: Error | null} {
    const candidates = [text, extractJsonText(text)].filter((value): value is string => value !== null);
    let firstError: Error | null = null;
    for (const candidate of candidates) {
        try {
            return {draft: parseDraftJsonObject(JSON.parse(candidate) as unknown), error: null};
        } catch (error) {
            firstError ??= toError(error);
        }
    }
    return {draft: null, error: firstError};
}

function extractJsonText(text: string): string | null {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) {
        return null;
    }
    const candidate = text.slice(start, end + 1);
    try {
        JSON.parse(candidate);
        return candidate;
    } catch {
        return null;
    }
}

function parseDraftJsonObject(raw: unknown): CharacterVisualDraft {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("JSON 顶层必须是对象");
    }
    const source = unwrapDesignContainer(raw as Record<string, unknown>);
    const characterSource = extractSection(source, "character", "人物")
        ?? (hasCharacterLabels(source) ? source : {} as Record<string, unknown>);
    const outfitsSource = extractOutfits(source);
    const character = CharacterVisualFieldSchema.parse(
        mapFields(characterSource, CHARACTER_FIELD_LABELS),
    );
    const outfits = outfitsSource.map((item) => OutfitVisualSchema.parse(
        mapFields(item, OUTFIT_FIELD_LABELS),
    ));
    const characterId = typeof source.characterId === "string" ? source.characterId.trim() : "";
    return {
        schema: "nbook.character-visual/v1",
        characterId,
        character,
        outfits,
        photos: normalizeStringArray(source.photos),
    };
}

function unwrapDesignContainer(raw: Record<string, unknown>): Record<string, unknown> {
    for (const key of ["角色设计", "design", "draft"]) {
        const value = raw[key];
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            return value as Record<string, unknown>;
        }
    }
    return raw;
}

function extractSection(
    raw: Record<string, unknown>,
    ...keys: string[]
): Record<string, unknown> | null {
    for (const key of keys) {
        const value = raw[key];
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            return value as Record<string, unknown>;
        }
    }
    return null;
}

function extractOutfits(raw: Record<string, unknown>): Array<Record<string, unknown>> {
    for (const key of ["outfits", "服装"]) {
        const value = raw[key];
        if (Array.isArray(value)) {
            return value.map((item) => {
                if (typeof item !== "object" || item === null || Array.isArray(item)) {
                    throw new Error(`${key} 数组项必须是对象`);
                }
                return item as Record<string, unknown>;
            });
        }
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            return [value as Record<string, unknown>];
        }
    }
    return hasOutfitLabels(raw) ? [raw] : [];
}

function hasCharacterLabels(raw: Record<string, unknown>): boolean {
    return Object.keys(raw).some((key) => key in CHARACTER_FIELD_LABELS);
}

function hasOutfitLabels(raw: Record<string, unknown>): boolean {
    return Object.keys(raw).some((key) => key in OUTFIT_FIELD_LABELS);
}

function mapFields(
    raw: Record<string, unknown>,
    labels: Record<string, string>,
): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
        result[labels[key] ?? key] = normalizeValue(value);
    }
    return result;
}

function normalizeValue(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (value === null || value === undefined) return "";
    if (Array.isArray(value)) {
        return value.map(normalizeValue).filter((item) => item !== "").join(", ");
    }
    return String(value);
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => typeof item === "string" ? item.trim() : String(item))
        .filter((item) => item !== "");
}

function parseLabeledDraft(text: string): CharacterVisualDraft {
    const characterBlock = extractFirstBlock(text, "人物");
    const outfitBlocks = extractBlocks(text, "服装");
    if (!characterBlock && outfitBlocks.length === 0) {
        throw new Error("未找到 <人物>/<服装> 块");
    }
    const character = CharacterVisualFieldSchema.parse(
        characterBlock
            ? parseLabeledLines(characterBlock, CHARACTER_FIELD_LABELS)
            : {},
    );
    const outfits = outfitBlocks.map((block) => OutfitVisualSchema.parse(
        parseLabeledLines(block, OUTFIT_FIELD_LABELS),
    ));
    return {
        schema: "nbook.character-visual/v1",
        characterId: "",
        character,
        outfits,
        photos: [],
    };
}

function extractBlocks(text: string, tag: string): string[] {
    const pattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "gu");
    const blocks: string[] = [];
    for (const match of text.matchAll(pattern)) {
        blocks.push(match[1]?.trim() ?? "");
    }
    return blocks;
}

function extractFirstBlock(text: string, tag: string): string | null {
    return extractBlocks(text, tag)[0] ?? null;
}

function parseLabeledLines(
    block: string,
    labels: Record<string, string>,
): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of block.split(/\r?\n/u)) {
        const match = /^\s*([^:：]{1,40})\s*[:：]\s*(.*)$/u.exec(line);
        if (!match) {
            continue;
        }
        const label = match[1]?.trim() ?? "";
        const fieldKey = labels[label];
        if (fieldKey) {
            result[fieldKey] = (match[2] ?? "").trim();
        }
    }
    return result;
}

function buildParseError(text: string, jsonError: Error | null, lineError: Error): string {
    const preview = text.length > 200 ? `${text.slice(0, 200)}...` : text;
    const reasons = [
        jsonError ? `JSON：${jsonError.message}` : null,
        `行式：${lineError.message}`,
    ].filter((item): item is string => item !== null);
    return `角色视觉草稿解析失败：${reasons.join("；")}；输入片段：${preview}`;
}

function parseExistingSummary(summary: string): CharacterVisualFile | null {
    if (summary.trim() === "") {
        return null;
    }
    try {
        return parseCharacterVisualJson(summary);
    } catch {
        return null;
    }
}

function finalizeDraft(
    draft: CharacterVisualDraft,
    input: GenerateCharacterVisualDraftInput,
    existing: CharacterVisualFile | null,
): CharacterVisualFile {
    const fillFromExisting = input.mode === "fill_empty" && existing !== null;
    const character = fillFromExisting && isEmptyCharacter(draft.character)
        ? existing!.character
        : fillFromExisting
            ? fillEmptyFields(draft.character, existing!.character, CHARACTER_FIELD_KEYS)
            : draft.character;
    const outfits = fillFromExisting
        ? draft.outfits.length > 0
            ? mergeOutfits(draft.outfits, existing!.outfits)
            : existing!.outfits
        : draft.outfits;
    return {
        schema: "nbook.character-visual/v1",
        characterId: input.characterId,
        character,
        outfits,
        photos: draft.photos.length > 0 ? draft.photos : existing?.photos ?? [],
    };
}

function isEmptyCharacter(character: CharacterVisualField): boolean {
    return CHARACTER_FIELD_KEYS.every((key) => character[key].trim() === "");
}

function fillEmptyFields<T extends Record<string, string>>(
    draft: T,
    existing: T,
    keys: Array<keyof T>,
): T {
    const merged = {...draft};
    for (const key of keys) {
        if ((merged[key] ?? "").trim() === "" && (existing[key] ?? "").trim() !== "") {
            merged[key] = existing[key];
        }
    }
    return merged;
}

function mergeOutfits(draft: OutfitVisual[], existing: OutfitVisual[]): OutfitVisual[] {
    return draft.map((outfit, index) => {
        const previous = existing[index];
        return previous
            ? fillEmptyFields(outfit, previous, OUTFIT_FIELD_KEYS)
            : outfit;
    });
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
