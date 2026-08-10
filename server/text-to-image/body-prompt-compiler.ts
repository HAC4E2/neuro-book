import {
    listCharacterGroups,
    listCharacterVisualIds,
    readCharacterVisual,
} from "nbook/server/text-to-image/character-visual.service";
import {buildCharacterTriggerWords} from "nbook/server/text-to-image/body-character-scanner";
import type {
    CharacterVisualField,
    CharacterVisualFile,
    OutfitVisual,
} from "nbook/server/text-to-image/character-visual.codec";
import {
    CharacterVisualFieldSchema,
    OutfitVisualSchema,
} from "nbook/server/text-to-image/character-visual.codec";

const BODY_PROMPT_CODE_PATTERN = /\$\{([\s\S]*?)\}\$|\$(?!\{)([^$\r\n]+)\$/gu;
const LEGACY_BODY_MARKER_PATTERN = /(?:^|-)(?:sfw|nsfw|hidden|upperbody|lowerbody|front|back)(?:-|$)/iu;

const INLINE_CHARACTER_FIELD_ALIASES: Record<string, keyof CharacterVisualField> = {
    "中文名称": "cnName",
    "中文名": "cnName",
    "英文名称": "enName",
    "英文名": "enName",
    "触发名": "triggerWords",
    "触发词": "triggerWords",
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
    "负面提示词": "negativePrompt",
};

const INLINE_OUTFIT_FIELD_ALIASES: Record<string, keyof OutfitVisual> = {
    "中文名称": "cnName",
    "中文名": "cnName",
    "英文名称": "enName",
    "英文名": "enName",
    "服装名称": "cnName",
    "上半身": "upper",
    "上半身背面": "upperBack",
    "下半身": "lower",
    "下半身背面": "lowerBack",
};

type BodyPromptCode = {
    name: string;
    characterId: string | null;
    groupId: string | null;
    outfit: string | null;
    inlineCharacter: CharacterVisualField | null;
    inlineOutfit: OutfitVisual | null;
    angle: "front" | "back";
    angleText: string;
    upperBody: "nsfw" | "sfw" | "visible" | "hidden";
    lowerBody: "nsfw" | "sfw" | "visible" | "hidden";
};

export type CompiledBodyPrompt = {
    prompt: string;
    negativePrompt: string;
};

/**
 * 队列生成前展开正文占位符里的 `${...}$` 角色/服装调用代码。
 * 角色来源为 `lorebook/character/<id>/visual.json`；找不到时抛错，避免把 JSON 原文发给 NovelAI。
 */
export async function compileBodyPrompt(
    projectRoot: string,
    prompt: string,
    options: {temporaryCharacters?: CharacterVisualFile[]} = {},
): Promise<CompiledBodyPrompt> {
    const negativeParts: string[] = [];
    let output = "";
    let cursor = 0;

    for (const match of prompt.matchAll(BODY_PROMPT_CODE_PATTERN)) {
        const index = match.index ?? 0;
        output += prompt.slice(cursor, index);
        const jsonCode = match[1];
        const legacyCode = match[2];
        if (jsonCode === undefined && (legacyCode === undefined || !LEGACY_BODY_MARKER_PATTERN.test(legacyCode))) {
            output += match[0];
            cursor = index + match[0].length;
            continue;
        }
        const code = jsonCode !== undefined
            ? parseBodyPromptCode(jsonCode)
            : parseLegacyBodyPromptCode(legacyCode ?? "");
        const visual = await resolveCharacterVisual(projectRoot, code, options.temporaryCharacters ?? []);
        const outfit = await resolveOutfit(projectRoot, visual, code);
        const tags = buildCharacterTags(visual, outfit, code);
        if (visual && (visual.character.negativePrompt ?? "").trim() !== "") {
            negativeParts.push((visual.character.negativePrompt ?? "").trim());
        }
        output += tags.join(", ");
        cursor = index + match[0].length;
    }
    output += prompt.slice(cursor);
    const lastOpenCode = prompt.lastIndexOf("${");
    const lastClosedCode = prompt.lastIndexOf("}$");
    if (lastOpenCode > lastClosedCode) {
        throw new Error(`角色调用代码不是合法 JSON：${prompt.slice(lastOpenCode + 2)}`);
    }

    return {
        prompt: output,
        negativePrompt: negativeParts.join(", "),
    };
}

/** Collect inline character DNA from a single prompt without touching project storage. */
export function extractTemporaryCharacterRegistry(prompt: string): CharacterVisualFile[] {
    const result: CharacterVisualFile[] = [];
    for (const match of prompt.matchAll(BODY_PROMPT_CODE_PATTERN)) {
        const raw = match[1];
        if (raw === undefined) continue;
        try {
            const code = parseBodyPromptCode(raw);
            if (code.inlineCharacter === null) continue;
            const characterId = code.characterId ?? `temporary:${code.name}`;
            if (result.some((item) => item.characterId === characterId)) continue;
            result.push({
                schema: "nbook.character-visual/v1",
                characterId,
                character: code.inlineCharacter,
                outfits: code.inlineOutfit ? [code.inlineOutfit] : [],
                photos: [],
            });
        } catch {
            // The normal compiler reports malformed calls with the source text.
        }
    }
    return result;
}

function parseBodyPromptCode(raw: string): BodyPromptCode {
    const normalized = raw.trim();
    let parsed: unknown;
    try {
        parsed = JSON.parse(normalized);
    } catch {
        // `${"name":"..."}$` is a common LLM formatting omission: the
        // placeholder delimiters are present, but the JSON object's braces are not.
        try {
            parsed = JSON.parse(`{${normalized}}`);
        } catch {
            throw new Error(`角色调用代码不是合法 JSON：${raw}`);
        }
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(`角色调用代码必须是 JSON 对象：${raw}`);
    }
    const record = parsed as Record<string, unknown>;
    const inlineCharacter = parseInlineCharacter(record.character, raw);
    const inlineOutfit = parseInlineOutfit(record.outfit, raw);
    const name = typeof record.name === "string" && record.name.trim() !== ""
        ? record.name.trim()
        : inlineCharacter?.enName || inlineCharacter?.cnName || "";
    const outfitName = typeof record.outfit === "string" && record.outfit.trim() !== ""
        ? record.outfit.trim()
        : null;
    if (name === "" && inlineOutfit === null && outfitName === null) {
        throw new Error(`角色调用代码缺少 name：${raw}`);
    }
    const angleValue = typeof record.angle === "string" ? record.angle.trim().toLowerCase() : "front";
    const angle = angleValue === "front" || angleValue === "from front"
        ? "front"
        : angleValue === "back" || angleValue === "from back" || angleValue === "from behind" || angleValue === "behind"
            ? "back"
            : null;
    if (angle === null) {
        throw new Error(`角色调用代码的 angle 无效：${raw}`);
    }
    const upperBody = resolveBodyState(record.upperBody, "upperBody", raw);
    const lowerBody = resolveBodyState(record.lowerBody, "lowerBody", raw);
    return {
        name,
        characterId: typeof record.characterId === "string" && record.characterId.trim() !== ""
            ? record.characterId.trim()
            : null,
        groupId: typeof record.groupId === "string" && record.groupId.trim() !== ""
            ? record.groupId.trim()
            : null,
        outfit: outfitName,
        inlineCharacter,
        inlineOutfit,
        angle,
        angleText: typeof record.angle === "string" ? record.angle.trim() : "",
        upperBody,
        lowerBody,
    };
}

function resolveBodyState(value: unknown, field: string, raw: string): BodyPromptCode["upperBody"] {
    if (value === undefined) return "sfw";
    if (value === "sfw" || value === "nsfw" || value === "visible" || value === "hidden") return value;
    throw new Error(`角色调用代码的 ${field} 无效：${raw}`);
}

function parseInlineCharacter(value: unknown, raw: string): CharacterVisualField | null {
    if (value === undefined) {
        return null;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`inline character DNA must be an object: ${raw}`);
    }
    const character = CharacterVisualFieldSchema.parse(
        mapInlineFields(value as Record<string, unknown>, INLINE_CHARACTER_FIELD_ALIASES),
    );
    const dnaFields = [
        character.profileTraits,
        character.facialAppearance,
        character.facialBack,
        character.upperSfw,
        character.upperBackSfw,
        character.lowerSfw,
        character.lowerBackSfw,
        character.upperNsfw,
        character.upperBackNsfw,
        character.lowerNsfw,
        character.lowerBackNsfw,
    ];
    if ((character.enName || character.cnName).trim() === "" || !dnaFields.some((field) => field.trim() !== "")) {
        throw new Error(`inline character DNA is incomplete: ${raw}`);
    }
    return character;
}

function parseInlineOutfit(value: unknown, raw: string): OutfitVisual | null {
    if (value === undefined || typeof value === "string") {
        return null;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`inline outfit DNA must be an object: ${raw}`);
    }
    const outfit = OutfitVisualSchema.parse(
        mapInlineFields(value as Record<string, unknown>, INLINE_OUTFIT_FIELD_ALIASES),
    );
    if ((outfit.enName || outfit.cnName).trim() === ""
        || ![outfit.upper, outfit.upperBack, outfit.lower, outfit.lowerBack].some((field) => field.trim() !== "")) {
        throw new Error(`inline outfit DNA is incomplete: ${raw}`);
    }
    return outfit;
}

function mapInlineFields<T extends string>(
    value: Record<string, unknown>,
    aliases: Record<string, T>,
): Record<string, unknown> {
    const mapped: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        mapped[aliases[key] ?? key] = item;
    }
    return mapped;
}

function parseLegacyBodyPromptCode(raw: string): BodyPromptCode {
    const segments = raw.split("-").map((segment) => segment.trim()).filter(Boolean);
    const firstMarkerIndex = segments.findIndex((segment) => (
        /^(?:sfw|nsfw|hidden|upperbody|lowerbody|front|back)$/iu.test(segment)
    ));
    if (firstMarkerIndex <= 0) {
        throw new Error(`鏃ц鑹茶皟鐢ㄦ牸寮忎笉鍚堟硶锛?{raw}`);
    }

    const name = segments.slice(0, firstMarkerIndex).join("-").trim();
    const code: BodyPromptCode = {
        name,
        characterId: null,
        groupId: null,
        outfit: null,
        inlineCharacter: null,
        inlineOutfit: null,
        angle: "front",
        angleText: "front",
        upperBody: "hidden",
        lowerBody: "hidden",
    };
    const tail = segments.slice(firstMarkerIndex);
    let index = 0;
    while (index < tail.length) {
        const token = tail[index]?.toLowerCase();
        if (token === "front" || token === "back") {
            code.angle = token;
            index += 1;
            continue;
        }
        const nextToken = tail[index + 1]?.toLowerCase();
        if (token === "from" && (nextToken === "front" || nextToken === "back")) {
            code.angle = nextToken;
            index += 2;
            continue;
        }
        if (token === "sfw" || token === "nsfw" || token === "hidden") {
            const body = tail[index + 1]?.toLowerCase();
            if (body !== "upperbody" && body !== "lowerbody") {
                throw new Error(`鏃ц鑹茶皟鐢ㄧ殑韬綋閮ㄤ綅涓嶅悎娉曪細${raw}`);
            }
            code[body === "upperbody" ? "upperBody" : "lowerBody"] = token;
            index += 2;
            continue;
        }
        if (token === "upperbody" || token === "lowerbody") {
            const state = tail[index + 1]?.toLowerCase();
            if (state !== "sfw" && state !== "nsfw" && state !== "hidden") {
                throw new Error(`鏃ц鑹茶皟鐢ㄧ殑韬綋鐘舵€佷笉鍚堟硶锛?{raw}`);
            }
            code[token === "upperbody" ? "upperBody" : "lowerBody"] = state;
            index += 2;
            continue;
        }
        throw new Error(`鏃ц鑹茶皟鐢ㄥ弬鏁颁笉鍚堟硶锛?{raw}`);
    }
    return code;
}

async function resolveCharacterVisual(
    projectRoot: string,
    code: BodyPromptCode,
    temporaryCharacters: CharacterVisualFile[],
): Promise<CharacterVisualFile | null> {
    if (code.inlineCharacter !== null) {
        return {
            schema: "nbook.character-visual/v1",
            characterId: code.characterId ?? `temporary:${code.name}`,
            character: code.inlineCharacter,
            outfits: [],
            photos: [],
        };
    }
    if (code.name === "") {
        return null;
    }
    const temporaryMatches = temporaryCharacters.filter((item) => (
        buildCharacterTriggerWords(item.character).includes(code.name)
    ));
    if (temporaryMatches.length > 1) {
        throw new Error(`临时角色“${code.name}”存在多个候选，请在调用中指定唯一名称`);
    }
    if (temporaryMatches.length === 1) {
        return temporaryMatches[0]!;
    }
    const resolved = code.characterId
        ? {characterId: code.characterId, groupId: code.groupId}
        : await findCharacterVisualByName(projectRoot, code.name, code.groupId);
    if (resolved === null) {
        throw new Error(`未找到角色“${code.name}”的 visual.json`);
    }
    const visual = await readCharacterVisual(projectRoot, resolved.characterId, resolved.groupId ?? undefined);
    if (visual === null) {
        throw new Error(`未找到角色“${code.name}”的 visual.json`);
    }
    return visual;
}

async function resolveOutfit(
    projectRoot: string,
    visual: CharacterVisualFile | null,
    code: BodyPromptCode,
): Promise<OutfitVisual | null> {
    if (code.inlineOutfit !== null) {
        return code.inlineOutfit;
    }
    if (code.outfit === null) {
        return null;
    }
    if (visual === null) {
        return await findStandaloneOutfit(projectRoot, code.outfit);
    }
    const outfit = visual.outfits.find((item) => (
        item.cnName === code.outfit
        || item.enName === code.outfit
    ));
    if (!outfit) {
        throw new Error(`未找到角色“${code.name}”的服装“${code.outfit}”`);
    }
    return outfit;
}

async function findStandaloneOutfit(projectRoot: string, name: string): Promise<OutfitVisual> {
    const candidates: OutfitVisual[] = [];
    for (const item of await collectProjectVisuals(projectRoot)) {
        const outfit = item.visual.outfits.find((candidate) => candidate.cnName === name || candidate.enName === name);
        if (outfit) {
            candidates.push(outfit);
        }
    }
    if (candidates.length === 0) {
        throw new Error(`未找到独立服装“${name}”`);
    }
    if (candidates.length > 1) {
        throw new Error(`独立服装“${name}”存在多个候选`);
    }
    return candidates[0]!;
}

async function findCharacterVisualByName(
    projectRoot: string,
    name: string,
    groupId: string | null,
): Promise<{characterId: string; groupId: string | null} | null> {
    const candidates = (await collectProjectVisuals(projectRoot, groupId))
        .filter((item) => buildCharacterTriggerWords(item.visual.character).includes(name));
    if (candidates.length > 1) {
        throw new Error(`角色“${name}”存在多个候选：${candidates.map((item) => item.characterId).join(", ")}；请使用 characterId`);
    }
    const candidate = candidates[0];
    return candidate ? {characterId: candidate.characterId, groupId: candidate.groupId} : null;
}

async function collectProjectVisuals(
    projectRoot: string,
    groupId?: string | null,
): Promise<Array<{characterId: string; groupId: string | null; visual: CharacterVisualFile}>> {
    const result: Array<{characterId: string; groupId: string | null; visual: CharacterVisualFile}> = [];
    const seen = new Set<string>();
    const groups = groupId
        ? [{groupId}]
        : await listCharacterGroups(projectRoot);
    for (const group of groups) {
        for (const characterId of await listCharacterVisualIds(projectRoot, group.groupId)) {
            const visual = await readCharacterVisual(projectRoot, characterId, group.groupId).catch(() => null);
            if (visual === null) continue;
            const key = `${group.groupId}:${characterId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            result.push({characterId, groupId: group.groupId, visual});
        }
    }
    if (!groupId) {
        for (const characterId of await listCharacterVisualIds(projectRoot)) {
            if (result.some((item) => item.characterId === characterId && item.groupId !== null)) continue;
            const visual = await readCharacterVisual(projectRoot, characterId).catch(() => null);
            if (visual === null) continue;
            const key = `legacy:${characterId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            result.push({characterId, groupId: null, visual});
        }
    }
    return result;
}

function buildCharacterTags(
    visual: CharacterVisualFile | null,
    outfit: OutfitVisual | null,
    code: BodyPromptCode,
): string[] {
    if (visual === null) {
        if (outfit === null) {
            throw new Error("调用代码没有可展开的角色或服装");
        }
        return buildOutfitTags(outfit, code);
    }
    const character = visual.character;
    const tags = [
        code.angleText,
        character.enName || character.cnName,
        character.profileTraits,
        code.angle === "back" ? character.facialBack : character.facialAppearance,
    ].filter((tag) => tag.trim() !== "");

    if (code.upperBody !== "hidden") {
        const upper = code.angle === "back"
            ? (code.upperBody === "nsfw" ? character.upperBackNsfw : character.upperBackSfw)
            : (code.upperBody === "nsfw" ? character.upperNsfw : character.upperSfw);
        if (upper.trim() !== "") tags.push(upper);
        const outfitUpper = code.angle === "back" ? outfit?.upperBack : outfit?.upper;
        if (outfitUpper?.trim()) tags.push(outfitUpper);
    }
    if (code.lowerBody !== "hidden") {
        const lower = code.angle === "back"
            ? (code.lowerBody === "nsfw" ? character.lowerBackNsfw : character.lowerBackSfw)
            : (code.lowerBody === "nsfw" ? character.lowerNsfw : character.lowerSfw);
        if (lower.trim() !== "") tags.push(lower);
        const outfitLower = code.angle === "back" ? outfit?.lowerBack : outfit?.lower;
        if (outfitLower?.trim()) tags.push(outfitLower);
    }
    return tags;
}

function buildOutfitTags(outfit: OutfitVisual, code: BodyPromptCode): string[] {
    const tags: string[] = [];
    if (code.upperBody !== "hidden") {
        const upper = code.angle === "back" ? outfit.upperBack : outfit.upper;
        if (upper.trim() !== "") tags.push(upper);
    }
    if (code.lowerBody !== "hidden") {
        const lower = code.angle === "back" ? outfit.lowerBack : outfit.lower;
        if (lower.trim() !== "") tags.push(lower);
    }
    return tags;
}
