import type {
    CharacterVisualField,
    OutfitVisual,
} from "nbook/server/text-to-image/character-visual.codec";
import {
    CharacterVisualFieldSchema,
    OutfitVisualSchema,
} from "nbook/server/text-to-image/character-visual.codec";

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

export type BodyPromptFacing = "front" | "back";
export type BodyPromptKind = "character" | "outfit";

export type BodyPromptCode = {
    /** LLM 显式声明的调用类型；缺失时由编译阶段结合 visual 语义判定。 */
    kind: BodyPromptKind | null;
    name: string;
    characterId: string | null;
    groupId: string | null;
    visualId: string | null;
    outfit: string | null;
    inlineCharacter: CharacterVisualField | null;
    inlineOutfit: OutfitVisual | null;
    facing: BodyPromptFacing;
    angleText: string;
    upperBody: "nsfw" | "sfw" | "visible" | "hidden";
    lowerBody: "nsfw" | "sfw" | "visible" | "hidden";
};

export type BodyPromptCall = {
    kind: "json" | "legacy";
    raw: string;
    source: string;
    start: number;
    end: number;
};

export type BodyPromptRepair = {
    type: "missing-closing-dollar";
    offset: number;
};

/**
 * 扫描已经规范闭合的正文角色调用。JSON 调用使用平衡扫描，不使用正则截断嵌套对象。
 */
export function scanBodyPromptCalls(prompt: string): BodyPromptCall[] {
    return collectBodyPromptCalls(prompt, false).calls;
}

/**
 * 在 L1 进入 schema 校验前，补齐唯一可以确定推断的 JSON 调用结尾 `$`。
 * 该函数不会猜测字段、角色或普通 tag；候选必须先通过调用 schema。
 */
export function normalizeBodyPromptCalls(prompt: string): {
    prompt: string;
    repairs: BodyPromptRepair[];
} {
    const collected = collectBodyPromptCalls(prompt, true);
    if (collected.repairs.length === 0) {
        return {prompt, repairs: []};
    }
    let normalized = prompt;
    for (const repair of [...collected.repairs].reverse()) {
        normalized = `${normalized.slice(0, repair.offset)}$${normalized.slice(repair.offset)}`;
    }
    return {prompt: normalized, repairs: collected.repairs};
}

/** 校验调用已经闭合且字段满足当前正文生图合同。 */
export function assertCanonicalBodyPromptCalls(prompt: string): void {
    for (const call of scanBodyPromptCalls(prompt)) {
        if (call.kind === "json") {
            const code = parseBodyPromptCode(call.raw);
            assertBodyPromptCodeShape(code, call.raw);
        } else {
            parseLegacyBodyPromptCode(call.raw);
        }
    }
}

/** 解析一个 JSON 调用内容；raw 不包含 `${` 和 `}$`。 */
export function parseBodyPromptCode(raw: string): BodyPromptCode {
    const normalized = raw.trim();
    let parsed: unknown;
    try {
        parsed = JSON.parse(normalized);
    } catch {
        // `${"name":"..."}$` 是当前正文生图提示词的标准形状，外层 `{}` 同时是调用标记。
        try {
            parsed = JSON.parse(`{${normalized}}`);
        } catch {
            throw new Error(`角色调用代码不是合法 JSON：${safeSnippet(raw)}`);
        }
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(`角色调用代码必须是 JSON 对象：${safeSnippet(raw)}`);
    }
    const record = parsed as Record<string, unknown>;
    const kind = resolveBodyPromptKind(record.kind, raw);
    const inlineCharacter = parseInlineCharacter(record.character, raw);
    const inlineOutfit = parseInlineOutfit(record.outfit, raw);
    const name = typeof record.name === "string" && record.name.trim() !== ""
        ? record.name.trim()
        : inlineCharacter?.enName || inlineCharacter?.cnName || "";
    const outfitName = typeof record.outfit === "string" && record.outfit.trim() !== ""
        ? record.outfit.trim()
        : null;
    if (name === "" && inlineOutfit === null && outfitName === null) {
        throw new Error(`角色调用代码缺少 name：${safeSnippet(raw)}`);
    }

    const hasAngle = record.angle !== undefined;
    if (hasAngle && typeof record.angle !== "string") {
        throw new Error(`角色调用代码的 angle 无效：${safeSnippet(raw)}`);
    }
    const angleText = hasAngle ? String(record.angle).normalize("NFKC").trim() : "";
    if (hasAngle && angleText === "") {
        throw new Error(`角色调用代码的 angle 无效：${safeSnippet(raw)}`);
    }

    return {
        kind,
        name,
        characterId: typeof record.characterId === "string" && record.characterId.trim() !== ""
            ? record.characterId.trim()
            : null,
        groupId: typeof record.groupId === "string" && record.groupId.trim() !== ""
            ? record.groupId.trim()
            : null,
        visualId: typeof record.visualId === "string" && record.visualId.trim() !== ""
            ? record.visualId.trim()
            : null,
        outfit: outfitName,
        inlineCharacter,
        inlineOutfit,
        facing: getBodyPromptFacing(angleText),
        angleText,
        upperBody: resolveBodyState(record.upperBody, "upperBody", raw, kind === "outfit" ? "visible" : "sfw"),
        lowerBody: resolveBodyState(record.lowerBody, "lowerBody", raw, kind === "outfit" ? "visible" : "sfw"),
    };
}

/** 背面关键词选择 back DNA，其余非空角度（包括 from side）选择 front DNA。 */
export function getBodyPromptFacing(angleText: string): BodyPromptFacing {
    const normalized = angleText.normalize("NFKC").trim().toLowerCase();
    return new Set(["from behind", "from back", "back", "behind"]).has(normalized)
        ? "back"
        : "front";
}

export function isLegacyBodyPromptCode(raw: string): boolean {
    return LEGACY_BODY_MARKER_PATTERN.test(raw);
}

/** 解析移植自 chatu-8 的 `$Alice-sfw-upperbody$` 调用。 */
export function parseLegacyBodyPromptCode(raw: string): BodyPromptCode {
    const segments = raw.split("-").map((segment) => segment.trim()).filter(Boolean);
    const firstMarkerIndex = segments.findIndex((segment) => (
        /^(?:sfw|nsfw|hidden|upperbody|lowerbody|front|back)$/iu.test(segment)
    ));
    if (firstMarkerIndex <= 0) {
        throw new Error(`旧式角色调用格式不合法：${safeSnippet(raw)}`);
    }

    const name = segments.slice(0, firstMarkerIndex).join("-").trim();
    const code: BodyPromptCode = {
        kind: "character",
        name,
        characterId: null,
        groupId: null,
        visualId: null,
        outfit: null,
        inlineCharacter: null,
        inlineOutfit: null,
        facing: "front",
        angleText: "front",
        upperBody: "hidden",
        lowerBody: "hidden",
    };
    const tail = segments.slice(firstMarkerIndex);
    let index = 0;
    while (index < tail.length) {
        const token = tail[index]?.toLowerCase();
        if (token === "front" || token === "back") {
            code.facing = token;
            code.angleText = token;
            index += 1;
            continue;
        }
        const nextToken = tail[index + 1]?.toLowerCase();
        if (token === "from" && (nextToken === "front" || nextToken === "back")) {
            code.facing = nextToken;
            code.angleText = `from ${nextToken}`;
            index += 2;
            continue;
        }
        if (token === "sfw" || token === "nsfw" || token === "hidden") {
            const body = tail[index + 1]?.toLowerCase();
            if (body !== "upperbody" && body !== "lowerbody") {
                throw new Error(`旧式角色调用的身体部位不合法：${safeSnippet(raw)}`);
            }
            code[body === "upperbody" ? "upperBody" : "lowerBody"] = token;
            index += 2;
            continue;
        }
        if (token === "upperbody" || token === "lowerbody") {
            const state = tail[index + 1]?.toLowerCase();
            if (state !== "sfw" && state !== "nsfw" && state !== "hidden") {
                throw new Error(`旧式角色调用的身体状态不合法：${safeSnippet(raw)}`);
            }
            code[token === "upperbody" ? "upperBody" : "lowerBody"] = state;
            index += 2;
            continue;
        }
        throw new Error(`旧式角色调用的参数不合法：${safeSnippet(raw)}`);
    }
    return code;
}

function collectBodyPromptCalls(prompt: string, allowMissingClosingDollar: boolean): {
    calls: BodyPromptCall[];
    repairs: BodyPromptRepair[];
} {
    const calls: BodyPromptCall[] = [];
    const repairs: BodyPromptRepair[] = [];
    let index = 0;
    while (index < prompt.length) {
        if (prompt[index] !== "$") {
            index += 1;
            continue;
        }
        if (prompt[index + 1] === "{") {
            const closingBrace = findBalancedClosingBrace(prompt, index + 1);
            if (closingBrace === null) {
                throw new Error(`角色调用代码不是合法 JSON：${safeSnippet(prompt.slice(index + 2))}`);
            }
            const raw = prompt.slice(index + 2, closingBrace);
            const next = prompt[closingBrace + 1];
            const hasClosingDollar = next === "$";
            if (!hasClosingDollar) {
                if (!allowMissingClosingDollar || !isSafeRepairBoundary(next)) {
                    throw new Error(`角色调用代码不是合法 JSON：${safeSnippet(raw)}`);
                }
                // 只有 schema 合法的完整对象才允许补分隔符。
                parseBodyPromptCode(raw);
                repairs.push({type: "missing-closing-dollar", offset: closingBrace + 1});
            }
            calls.push({
                kind: "json",
                raw,
                source: prompt.slice(index, closingBrace + (hasClosingDollar ? 2 : 1)),
                start: index,
                end: closingBrace + (hasClosingDollar ? 2 : 1),
            });
            index = closingBrace + (hasClosingDollar ? 2 : 1);
            continue;
        }
        const closingDollar = findLegacyClosingDollar(prompt, index + 1);
        if (closingDollar === null) {
            index += 1;
            continue;
        }
        const raw = prompt.slice(index + 1, closingDollar);
        if (isLegacyBodyPromptCode(raw)) {
            calls.push({
                kind: "legacy",
                raw,
                source: prompt.slice(index, closingDollar + 1),
                start: index,
                end: closingDollar + 1,
            });
        }
        index = closingDollar + 1;
    }
    return {calls, repairs};
}

function findBalancedClosingBrace(prompt: string, openingBrace: number): number | null {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = openingBrace; index < prompt.length; index += 1) {
        const character = prompt[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }
        if (character === '"') {
            inString = true;
            continue;
        }
        if (character === "{") {
            depth += 1;
        } else if (character === "}") {
            depth -= 1;
            if (depth === 0) return index;
            if (depth < 0) return null;
        }
    }
    return null;
}

function findLegacyClosingDollar(prompt: string, start: number): number | null {
    for (let index = start; index < prompt.length; index += 1) {
        if (prompt[index] === "\n" || prompt[index] === "\r") return null;
        if (prompt[index] === "$") return index;
    }
    return null;
}

function isSafeRepairBoundary(value: string | undefined): boolean {
    return value === undefined || value === "," || value === "<" || /\s/u.test(value);
}

function resolveBodyState(
    value: unknown,
    field: string,
    raw: string,
    defaultValue: BodyPromptCode["upperBody"] = "sfw",
): BodyPromptCode["upperBody"] {
    if (value === undefined) return defaultValue;
    if (value === "sfw" || value === "nsfw" || value === "visible" || value === "hidden") return value;
    throw new Error(`角色调用代码的 ${field} 无效：${safeSnippet(raw)}`);
}

function resolveBodyPromptKind(value: unknown, raw: string): BodyPromptKind | null {
    if (value === undefined) return null;
    if (value === "character" || value === "outfit") return value;
    throw new Error(`角色调用代码的 kind 无效：${safeSnippet(raw)}`);
}

function assertBodyPromptCodeShape(code: BodyPromptCode, raw: string): void {
    if (code.kind === "character" && (!isCharacterBodyState(code.upperBody) || !isCharacterBodyState(code.lowerBody))) {
        throw new Error(`角色调用代码的身体状态不适用于 kind=character：${safeSnippet(raw)}`);
    }
    // Inline outfit 是历史输入格式，继续允许它使用 sfw/nsfw；名称引用的独立服装由编译器严格校验 visible/hidden。
    if (code.kind === "outfit" && code.inlineOutfit === null
        && (!isOutfitBodyState(code.upperBody) || !isOutfitBodyState(code.lowerBody))) {
        throw new Error(`角色调用代码的身体状态不适用于 kind=outfit：${safeSnippet(raw)}`);
    }
}

function isCharacterBodyState(value: BodyPromptCode["upperBody"]): boolean {
    return value === "sfw" || value === "nsfw" || value === "hidden";
}

function isOutfitBodyState(value: BodyPromptCode["upperBody"]): boolean {
    return value === "visible" || value === "hidden";
}

function parseInlineCharacter(value: unknown, raw: string): CharacterVisualField | null {
    if (value === undefined) return null;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`inline character DNA must be an object: ${safeSnippet(raw)}`);
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
        throw new Error(`inline character DNA is incomplete: ${safeSnippet(raw)}`);
    }
    return character;
}

function parseInlineOutfit(value: unknown, raw: string): OutfitVisual | null {
    if (value === undefined || typeof value === "string") return null;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`inline outfit DNA must be an object: ${safeSnippet(raw)}`);
    }
    const outfit = OutfitVisualSchema.parse(
        mapInlineFields(value as Record<string, unknown>, INLINE_OUTFIT_FIELD_ALIASES),
    );
    if ((outfit.enName || outfit.cnName).trim() === ""
        || ![outfit.upper, outfit.upperBack, outfit.lower, outfit.lowerBack].some((field) => field.trim() !== "")) {
        throw new Error(`inline outfit DNA is incomplete: ${safeSnippet(raw)}`);
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

function safeSnippet(value: string): string {
    const compact = value.replace(/\s+/gu, " ").trim();
    return compact.length > 240 ? `${compact.slice(0, 240)}…` : compact;
}
