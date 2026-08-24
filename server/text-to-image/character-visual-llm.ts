import {
    CharacterVisualFieldSchema,
    CharacterVisualFileSchema,
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
import {buildRequestMessages, type TextToImagePromptMode} from "nbook/server/text-to-image/llm-context";
import type {TextToImageContextEntry} from "nbook/shared/dto/text-to-image.dto";
import type {TextToImageRuntimePlaceholderContext} from "nbook/server/text-to-image/runtime-placeholder";
import type {TextToImageLlmTraceHandle} from "nbook/server/text-to-image/llm-trace";
import {stripLlmReasoningBlocks} from "nbook/server/text-to-image/llm-output";
import {
    buildCharacterVisualSystemPrompt,
    buildCharacterVisualUserPrompt,
    type CharacterVisualDraftMode,
} from "nbook/server/text-to-image/character-visual-prompt";
import {canonicalizeTriggerWords} from "nbook/server/text-to-image/character-trigger-words";

export {buildCharacterVisualSystemPrompt, buildCharacterVisualUserPrompt, type CharacterVisualDraftMode} from "nbook/server/text-to-image/character-visual-prompt";

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
    userRequirement?: string;
    contextEntries?: TextToImageContextEntry[];
    promptMode?: TextToImagePromptMode;
    runtime?: TextToImageRuntimePlaceholderContext;
    trace?: TextToImageLlmTraceHandle;
};

/** 角色字段中文标签 -> schema 键。 */
const CHARACTER_FIELD_LABELS: Record<string, keyof CharacterVisualField> = {
    "中文名称": "cnName",
    "英文名称": "enName",
    "触发词": "triggerWords",
    "角色触发词": "triggerWords",
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

export type CharacterVisualDraftBatch = {
    drafts: CharacterVisualFile[];
    standaloneOutfits: Array<{
        outfit: OutfitVisual;
        ownerHint: string | null;
        sourceOrder: number;
    }>;
};

export type CharacterVisualDraftPresence = {
    draft: CharacterVisualFile;
    characterFields: Set<keyof CharacterVisualField>;
    outfitFields: Array<Set<keyof OutfitVisual>>;
};

export type CharacterVisualModifyResult = {
    visual: CharacterVisualFile;
    warnings: string[];
    changedFields: string[];
    mode: "merged" | "outfit_only";
    outfitCandidates?: CharacterVisualOutfitCandidate[];
};

export type CharacterVisualOutfitCandidate = {
    candidateId: string;
    sourceOrder: number;
    outfit: OutfitVisual;
    fields: Array<keyof OutfitVisual>;
    warnings: string[];
};

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

/** 瑙ｆ瀽瑙掕壊璁捐棰勮涓殑澶氫釜浜虹墿涓庣嫭绔嬫湇瑁咃紝淇濈暀鍘熷椤哄簭涓庡綊灞炴彁绀恒€?*/
export function parseCharacterVisualDraftBatch(text: string): CharacterVisualDraftBatch {
    const cleaned = cleanDraftText(text);
    const candidates = [cleaned, extractJsonText(cleaned)].filter((value): value is string => value !== null);
    let firstError: Error | null = null;
    for (const candidate of candidates) {
        try {
            return parseJsonDraftBatch(JSON.parse(candidate) as unknown);
        } catch (error) {
            firstError ??= toError(error);
        }
    }
    try {
        return parseLabeledDraftBatch(cleaned);
    } catch (error) {
        throw new Error(buildParseError(cleaned, firstError, toError(error)));
    }
}

/** 解析局部修改并保留“字段是否出现”的信息，避免完整 schema 的默认空字符串清空现有资料。 */
export function parseCharacterVisualDraftPresence(text: string): CharacterVisualDraftPresence {
    const draft = parseCharacterVisualDraft(text);
    const cleaned = cleanDraftText(text);
    const characterFields = new Set<keyof CharacterVisualField>();
    const outfitFields: Array<Set<keyof OutfitVisual>> = [];
    const jsonText = extractJsonText(cleaned);
    if (jsonText) {
        try {
            const raw = JSON.parse(jsonText) as unknown;
            const source = typeof raw === "object" && raw !== null && !Array.isArray(raw)
                ? unwrapDesignContainer(raw as Record<string, unknown>)
                : {};
            const characterSource = extractSection(source, "character", "人物")
                ?? (hasCharacterLabels(source) ? source : null);
            collectPresentFields(characterSource, CHARACTER_FIELD_LABELS, characterFields);
            for (const item of extractOutfits(source)) {
                const fields = new Set<keyof OutfitVisual>();
                collectPresentFields(item, OUTFIT_FIELD_LABELS, fields);
                outfitFields.push(fields);
            }
        } catch {
            // parseCharacterVisualDraft 已经给出结构错误；这里只保留可解析的行式回退。
        }
    }
    if (characterFields.size === 0 && /<人物>/u.test(cleaned)) {
        const block = extractFirstBlock(cleaned, "人物");
        if (block) collectLabeledPresentFields(block, CHARACTER_FIELD_LABELS, characterFields);
    }
    if (outfitFields.length === 0) {
        for (const block of extractBlocks(cleaned, "服装")) {
            const fields = new Set<keyof OutfitVisual>();
            collectLabeledPresentFields(block, OUTFIT_FIELD_LABELS, fields);
            outfitFields.push(fields);
        }
    }
    return {draft, characterFields, outfitFields};
}

/** 将 char_modify 的局部结果合并到指定视觉版本；身份、照片和未出现字段永远由现有文件保留。 */
export function mergeCharacterVisualPatch(
    current: CharacterVisualFile,
    parsed: CharacterVisualDraftPresence,
    selectedOutfitIndex: number | null = null,
): CharacterVisualModifyResult {
    const warnings: string[] = [];
    const changedFields: string[] = [];
    const character = {...current.character};
    const lockedFields = new Set<keyof CharacterVisualField>(["cnName", "enName", "triggerWords"]);
    for (const field of parsed.characterFields) {
        if (lockedFields.has(field)) {
            if (parsed.draft.character[field] !== current.character[field]) {
                warnings.push(`身份字段 ${field} 已保留当前值`);
            }
            continue;
        }
        const value = parsed.draft.character[field];
        if (value !== current.character[field]) changedFields.push(`character.${field}`);
        character[field] = value;
    }

    const outfits = current.outfits.map((outfit) => ({...outfit}));
    parsed.draft.outfits.forEach((draftOutfit, index) => {
        const fields = parsed.outfitFields[index] ?? new Set<keyof OutfitVisual>();
        if (fields.size === 0) {
            return;
        }
        const targetIndex = resolveOutfitTarget(outfits, draftOutfit, index, selectedOutfitIndex, warnings);
        if (targetIndex === null) {
            const created = OutfitVisualSchema.parse({});
            for (const field of fields) created[field] = draftOutfit[field];
            outfits.push(created);
            changedFields.push(`outfits[${outfits.length - 1}]`);
            return;
        }
        const target = outfits[targetIndex]!;
        for (const field of fields) {
            const value = draftOutfit[field];
            if (value !== target[field]) changedFields.push(`outfits[${targetIndex}].${field}`);
            target[field] = value;
        }
    });

    const visual = CharacterVisualFileSchema.parse({
        ...current,
        character,
        outfits,
    });
    return {visual, warnings, changedFields, mode: "merged"};
}

/** 纯服装回复只解析为候选，不提前按当前服装索引合并。 */
function collectOutfitCandidates(parsed: CharacterVisualDraftPresence): {
    candidates: CharacterVisualOutfitCandidate[];
    warnings: string[];
} {
    const candidates: CharacterVisualOutfitCandidate[] = [];
    const warnings: string[] = [];
    parsed.draft.outfits.forEach((outfit, index) => {
        const fields = [...(parsed.outfitFields[index] ?? new Set<keyof OutfitVisual>())];
        const hasName = [outfit.cnName, outfit.enName].some((value) => value.trim() !== "");
        const hasBodyTags = (["upper", "upperBack", "lower", "lowerBack"] as const)
            .some((field) => fields.includes(field) && outfit[field].trim() !== "");
        if (!hasName || !hasBodyTags) {
            warnings.push(`第 ${index + 1} 套服装缺少名称或身体字段，已跳过`);
            return;
        }
        candidates.push({
            candidateId: `outfit-${index + 1}`,
            sourceOrder: index,
            outfit,
            fields,
            warnings: [],
        });
    });
    return {candidates, warnings};
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
            maxTokens: settings.maxTokens,
            stream: settings.stream,
            sendImages: settings.sendImages,
            mergeSystemUser: settings.mergeSystemUser,
            retryCount: settings.retryCount,
            runtime: input.runtime,
            trace: input.trace,
            messages: buildRequestMessages(input.contextEntries ?? [], input.runtime ?? {}, [
                {role: "system", content: systemPrompt},
                {role: "user", content: userPrompt},
            ], input.promptMode),
        });
        try {
            const batch = parseCharacterVisualDraftBatch(content);
            if (batch.drafts.length !== 1) {
                throw new Error(`角色设计返回了 ${batch.drafts.length} 个人物；当前角色编辑器要求一次只确认一个人物批次`);
            }
            return finalizeDraft(batch.drafts[0]!, input, existing);
        } catch (error) {
            lastError = toError(error);
        }
    }

    throw new Error(`角色视觉草稿解析失败：重试 2 次后仍未成功；最后原因：${lastError?.message ?? "未知"}`);
}

/** 生成已有视觉资料的局部修改预览；LLM 未返回的字段不会参与覆盖。 */
export async function generateCharacterVisualModifyPreview(
    input: GenerateCharacterVisualDraftInput & {selectedOutfitIndex?: number | null},
    complete: typeof requestLlmCompletion = requestLlmCompletion,
): Promise<CharacterVisualModifyResult> {
    const current = parseCharacterVisualJson(input.existingSummary);
    const settings = TextToImageLlmProviderSettingsSchema.parse({
        ...input.provider.settings,
        baseUrl: input.provider.baseUrl,
    });
    const systemPrompt = buildCharacterVisualSystemPrompt();
    const userPrompt = buildCharacterVisualUserPrompt({...input, mode: "modify_visual"});
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const content = await complete({
            baseUrl: input.provider.baseUrl,
            credential: input.provider.credential,
            model: settings.model,
            temperature: settings.temperature,
            topP: settings.topP,
            maxTokens: settings.maxTokens,
            stream: settings.stream,
            sendImages: settings.sendImages,
            mergeSystemUser: settings.mergeSystemUser,
            retryCount: settings.retryCount,
            runtime: input.runtime,
            trace: input.trace,
            messages: buildRequestMessages(input.contextEntries ?? [], input.runtime ?? {}, [
                {role: "system", content: systemPrompt},
                {role: "user", content: userPrompt},
            ], input.promptMode),
        });
        try {
            const parsed = parseCharacterVisualDraftPresence(content);
            const outfitResult = collectOutfitCandidates(parsed);
            if (parsed.characterFields.size === 0 && parsed.draft.outfits.length > 0) {
                if (outfitResult.candidates.length === 0) {
                    throw new Error("纯服装回复没有完整可用的服装块");
                }
                return {
                    visual: current,
                    warnings: outfitResult.warnings,
                    changedFields: [],
                    mode: "outfit_only",
                    outfitCandidates: outfitResult.candidates,
                };
            }
            return mergeCharacterVisualPatch(current, parsed, input.selectedOutfitIndex ?? null);
        } catch (error) {
            lastError = toError(error);
        }
    }
    throw new Error(`角色视觉修改解析失败：重试 2 次后仍未成功；最后原因：${lastError?.message ?? "未知"}`);
}

function cleanDraftText(text: string): string {
    return stripLlmReasoningBlocks(text)
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

function parseJsonDraftBatch(raw: unknown): CharacterVisualDraftBatch {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("JSON root must be an object");
    }
    const source = unwrapDesignContainer(raw as Record<string, unknown>);
    const characterItems = firstArray(source, ["characters", "\u4eba\u7269", "roles", "\u89d2\u8272", "\u4eba\u7269\u5217\u8868"]);
    if (!characterItems) {
        return {drafts: [parseDraftJsonObject(raw)], standaloneOutfits: []};
    }
    if (characterItems.length === 0) {
        throw new Error("character design must contain at least one character");
    }
    const drafts = characterItems.map((item) => parseDraftJsonObject(item));
    const standaloneOutfits: CharacterVisualDraftBatch["standaloneOutfits"] = [];
    const globalOutfits = extractOutfits(source);
    globalOutfits.forEach((rawOutfit, index) => {
        const outfit = OutfitVisualSchema.parse(mapFields(rawOutfit, OUTFIT_FIELD_LABELS));
        const ownerHint = extractOutfitOwner(rawOutfit);
        const ownerIndex = ownerHint === null
            ? -1
            : drafts.findIndex((draft) => draftIdentityMatches(draft, ownerHint));
        if (ownerIndex >= 0) {
            drafts[ownerIndex]!.outfits.push(outfit);
        } else {
            standaloneOutfits.push({outfit, ownerHint, sourceOrder: drafts.length + index});
        }
    });
    return {drafts, standaloneOutfits};
}

function firstArray(source: Record<string, unknown>, keys: string[]): unknown[] | null {
    for (const key of keys) {
        const value = source[key];
        if (Array.isArray(value)) return value;
    }
    return null;
}

function extractOutfitOwner(raw: Record<string, unknown>): string | null {
    for (const key of ["owner", "characterId", "character", "所属人物", "归属人物", "角色"]) {
        const value = raw[key];
        if (typeof value === "string" && value.trim() !== "") return value.trim();
    }
    return null;
}

function draftIdentityMatches(draft: CharacterVisualFile, ownerHint: string): boolean {
    return [draft.characterId, draft.character.cnName, draft.character.enName]
        .some((value) => value.trim() !== "" && value.trim() === ownerHint);
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

function collectPresentFields<T extends string>(
    raw: Record<string, unknown> | null,
    labels: Record<string, T>,
    target: Set<T>,
): void {
    if (!raw) return;
    for (const key of Object.keys(raw)) {
        const mapped = labels[key] ?? (Object.values(labels).includes(key as T) ? key as T : undefined);
        if (mapped !== undefined) target.add(mapped);
    }
}

function collectLabeledPresentFields<T extends string>(
    block: string,
    labels: Record<string, T>,
    target: Set<T>,
): void {
    for (const line of block.split(/\r?\n/u)) {
        const match = /^\s*([^:：]{1,40})\s*[:：]/u.exec(line);
        if (!match) continue;
        const label = match[1]?.trim() ?? "";
        const mapped = labels[label];
        if (mapped) target.add(mapped);
    }
}

function resolveOutfitTarget(
    outfits: OutfitVisual[],
    draft: OutfitVisual,
    draftIndex: number,
    selectedOutfitIndex: number | null,
    warnings: string[],
): number | null {
    if (draftIndex === 0 && selectedOutfitIndex !== null) {
        if (selectedOutfitIndex < 0 || selectedOutfitIndex >= outfits.length) {
            throw new Error(`selectedOutfitIndex 超出当前服装范围：${selectedOutfitIndex}`);
        }
        return selectedOutfitIndex;
    }
    const names = [draft.cnName, draft.enName].map((value) => value.trim()).filter(Boolean);
    if (names.length > 0) {
        const matches = outfits
            .map((outfit, index) => ({outfit, index}))
            .filter(({outfit}) => names.includes(outfit.cnName) || names.includes(outfit.enName));
        if (matches.length === 1) return matches[0]!.index;
        if (matches.length > 1) throw new Error(`服装“${names.join(" / ")}”匹配到多个现有服装`);
        warnings.push(`未找到服装“${names.join(" / ")}”，将创建新服装`);
        return null;
    }
    if (outfits.length === 1) return 0;
    if (outfits.length === 0) return null;
    throw new Error("返回服装未包含名称，无法确定要修改的服装");
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

function parseLabeledDraftBatch(text: string): CharacterVisualDraftBatch {
    const characterBlocks = extractBlocks(text, "人物");
    if (characterBlocks.length <= 1) {
        return {drafts: [parseLabeledDraft(text)], standaloneOutfits: []};
    }
    const drafts: CharacterVisualFile[] = characterBlocks.map((block) => ({
        schema: "nbook.character-visual/v1" as const,
        characterId: "",
        character: CharacterVisualFieldSchema.parse(parseLabeledLines(block, CHARACTER_FIELD_LABELS)),
        outfits: [],
        photos: [],
    }));
    const standaloneOutfits: CharacterVisualDraftBatch["standaloneOutfits"] = [];
    extractBlocks(text, "服装").forEach((block, index) => {
        const outfit = OutfitVisualSchema.parse(parseLabeledLines(block, OUTFIT_FIELD_LABELS));
        const ownerHint = extractLabeledOutfitOwner(block);
        const ownerIndex = ownerHint === null
            ? -1
            : drafts.findIndex((draft) => draftIdentityMatches(draft, ownerHint));
        if (ownerIndex >= 0) {
            drafts[ownerIndex]!.outfits.push(outfit);
        } else if (ownerHint === null && drafts.length === 1) {
            drafts[0]!.outfits.push(outfit);
        } else {
            standaloneOutfits.push({outfit, ownerHint, sourceOrder: drafts.length + index});
        }
    });
    return {drafts, standaloneOutfits};
}

function extractLabeledOutfitOwner(block: string): string | null {
    const match = /^\s*(?:owner|characterId|所属人物|归属人物|角色)\s*[:：]\s*(.+?)\s*$/imu.exec(block);
    return match?.[1]?.trim() || null;
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
            if (fieldKey in result) {
                throw new Error(`字段“${label}”重复出现`);
            }
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
        character: {
            ...character,
            // 严格 `|` 合同：LLM 输出逗号触发词时抛错触发重试，而不是把逗号数据写进 Project。
            triggerWords: canonicalizeTriggerWords(character.triggerWords ?? ""),
        },
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
