import {
    listCharacterVisualIds,
    readCharacterVisual,
} from "nbook/server/text-to-image/character-visual.service";
import {buildCharacterTriggerWords} from "nbook/server/text-to-image/body-character-scanner";
import type {
    CharacterVisualField,
    CharacterVisualFile,
    OutfitVisual,
} from "nbook/server/text-to-image/character-visual.codec";

const BODY_PROMPT_CODE_PATTERN = /\$\{([\s\S]*?)\}\$|\$(?!\{)([^$\r\n]+)\$/gu;
const LEGACY_BODY_MARKER_PATTERN = /(?:^|-)(?:sfw|nsfw|hidden|upperbody|lowerbody|front|back)(?:-|$)/iu;

type BodyPromptCode = {
    name: string;
    characterId: string | null;
    groupId: string | null;
    outfit: string | null;
    angle: "front" | "back";
    upperBody: "nsfw" | "sfw" | "hidden";
    lowerBody: "nsfw" | "sfw" | "hidden";
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
        const visual = await resolveCharacterVisual(projectRoot, code);
        const outfit = resolveOutfit(visual, code);
        const tags = buildCharacterTags(visual.character, outfit, code);
        if (visual.character.negativePrompt.trim() !== "") {
            negativeParts.push(visual.character.negativePrompt.trim());
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
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (name === "") {
        throw new Error(`角色调用代码缺少 name：${raw}`);
    }
    const angle = record.angle === undefined
        ? "front"
        : record.angle === "front" || record.angle === "from front"
            ? "front"
            : record.angle === "back" || record.angle === "from back"
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
        outfit: typeof record.outfit === "string" && record.outfit.trim() !== ""
            ? record.outfit.trim()
            : null,
        angle,
        upperBody,
        lowerBody,
    };
}

function resolveBodyState(value: unknown, field: string, raw: string): BodyPromptCode["upperBody"] {
    if (value === undefined) return "sfw";
    if (value === "sfw" || value === "nsfw" || value === "hidden") return value;
    throw new Error(`角色调用代码的 ${field} 无效：${raw}`);
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
        angle: "front",
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

async function resolveCharacterVisual(projectRoot: string, code: BodyPromptCode): Promise<CharacterVisualFile> {
    const characterId = code.characterId ?? await findCharacterIdByName(projectRoot, code.name, code.groupId);
    if (characterId === null) {
        throw new Error(`未找到角色“${code.name}”的 visual.json`);
    }
    const visual = await readCharacterVisual(projectRoot, characterId, code.groupId ?? undefined);
    if (visual === null) {
        throw new Error(`未找到角色“${code.name}”的 visual.json`);
    }
    return visual;
}

function resolveOutfit(visual: CharacterVisualFile, code: BodyPromptCode): OutfitVisual | null {
    if (code.outfit === null) {
        return null;
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

async function findCharacterIdByName(projectRoot: string, name: string, groupId: string | null): Promise<string | null> {
    for (const characterId of await listCharacterVisualIds(projectRoot, groupId ?? undefined)) {
        const visual = await readCharacterVisual(projectRoot, characterId, groupId ?? undefined).catch(() => null);
        if (visual !== null && buildCharacterTriggerWords(visual.character).includes(name)) {
            return characterId;
        }
    }
    return null;
}

function buildCharacterTags(
    character: CharacterVisualField,
    outfit: OutfitVisual | null,
    code: BodyPromptCode,
): string[] {
    const tags = [
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
