import type {
    TextToImageCharacter,
    TextToImageCharacterTagKey,
} from "nbook/app/stores/text-to-image";

type JsonRecord = Record<string, unknown>;
type TextToImageCharacterDraftKey = "cnName" | "enName" | TextToImageCharacterTagKey;

type TextToImageCharacterFieldDefinition = {
    key: TextToImageCharacterDraftKey;
    label: string;
    aliases: string[];
    tagField: boolean;
};

export type TextToImageCharacterDesignSource = {
    novelTitle: string;
    title: string;
    summary: string;
    content: string;
    stateContent?: string;
};

export const TEXT_TO_IMAGE_CHARACTER_FIELD_DEFINITIONS: TextToImageCharacterFieldDefinition[] = [
    {key: "cnName", label: "角色中文名称", aliases: ["角色中文名称", "中文名称", "中文名", "人物中文名称", "人物名称", "名称", "cnName", "chineseName", "zhName"], tagField: false},
    {key: "enName", label: "角色英文名称", aliases: ["角色英文名称", "英文名称", "英文名", "人物英文名称", "enName", "englishName", "name"], tagField: false},
    {key: "profileTraits", label: "角色特征", aliases: ["角色特征", "人物特征", "特征", "性格年龄", "profileTraits", "traits", "characterTraits"], tagField: true},
    {key: "facialAppearance", label: "五官外貌", aliases: ["五官外貌", "五官外貌正面", "外貌", "正面外貌", "facialAppearance", "face", "frontFace"], tagField: true},
    {key: "facialBack", label: "五官外貌背面", aliases: ["五官外貌背面", "外貌背面", "背面外貌", "facialBack", "faceBack", "backFace"], tagField: true},
    {key: "upperSfw", label: "上半身SFW", aliases: ["上半身SFW", "上半身sfw", "上半身", "upperSfw", "upperBodySfw", "upperBody"], tagField: true},
    {key: "upperBackSfw", label: "上半身背面SFW", aliases: ["上半身背面SFW", "上半身SFW背面", "上半身背面sfw", "upperBackSfw", "upperBodyBackSfw", "upperBack"], tagField: true},
    {key: "lowerSfw", label: "下半身SFW", aliases: ["下半身SFW", "下半身sfw", "下半身", "lowerSfw", "lowerBodySfw", "lowerBody"], tagField: true},
    {key: "lowerBackSfw", label: "下半身背面SFW", aliases: ["下半身背面SFW", "下半身SFW背面", "下半身背面sfw", "lowerBackSfw", "lowerBodyBackSfw", "lowerBack"], tagField: true},
    {key: "upperNsfw", label: "上半身NSFW", aliases: ["上半身NSFW", "上半身nsfw", "upperNsfw", "upperBodyNsfw"], tagField: true},
    {key: "upperBackNsfw", label: "上半身NSFW背面", aliases: ["上半身NSFW背面", "上半身背面NSFW", "上半身nsfw背面", "upperBackNsfw", "upperBodyBackNsfw"], tagField: true},
    {key: "lowerNsfw", label: "下半身NSFW", aliases: ["下半身NSFW", "下半身nsfw", "lowerNsfw", "lowerBodyNsfw"], tagField: true},
    {key: "lowerBackNsfw", label: "下半身NSFW背面", aliases: ["下半身NSFW背面", "下半身背面NSFW", "下半身nsfw背面", "lowerBackNsfw", "lowerBodyBackNsfw"], tagField: true},
];

export function parseTextToImageCharacterDraft(content: string): Partial<TextToImageCharacter> {
    const jsonDraft = parseJsonCharacterDraft(content);
    const textDraft = parseLabeledCharacterDraft(content);
    return {
        ...textDraft,
        ...jsonDraft,
    };
}

export function buildTextToImageCharacterTagPatch(draft: Partial<TextToImageCharacter>): Partial<TextToImageCharacter> {
    const patch: Partial<TextToImageCharacter> = {};
    for (const field of TEXT_TO_IMAGE_CHARACTER_FIELD_DEFINITIONS) {
        if (!field.tagField) {
            continue;
        }
        const value = draft[field.key];
        if (typeof value === "string" && value.trim()) {
            (patch as Record<TextToImageCharacterDraftKey, string>)[field.key] = value.trim();
        }
    }
    return patch;
}

export function buildTextToImageCharacterDesignRequestPayload(detail: TextToImageCharacterDesignSource): string {
    return JSON.stringify({
        task: "characterDesign",
        request: {
            sourceNovel: detail.novelTitle,
            characterTitle: detail.title,
            summary: detail.summary,
            content: detail.content,
            stateContent: detail.stateContent ?? "",
        },
        outputSchema: buildCharacterOutputSchema(),
    }, null, 2);
}

export function buildTextToImageCharacterRevisionRequestPayload(character: TextToImageCharacter, direction: string): string {
    return JSON.stringify({
        task: "characterRevision",
        request: {
            direction,
            currentCharacter: buildCharacterOutputValues(character),
        },
        outputSchema: {
            character: Object.fromEntries(TEXT_TO_IMAGE_CHARACTER_FIELD_DEFINITIONS
                .filter((field) => field.tagField)
                .map((field) => [field.label, "string"])),
        },
    }, null, 2);
}

export function formatTextToImageCharacterDraft(character: Partial<TextToImageCharacter>): string {
    return TEXT_TO_IMAGE_CHARACTER_FIELD_DEFINITIONS
        .map((field) => `${field.label}: ${stringifyTagValue(character[field.key]) || "无"}`)
        .join("\n");
}

export function createTextToImageCharacterRequestSlots(options: {
    userRequest: string;
    currentCharacter?: Partial<TextToImageCharacter> | null;
    currentOutfit?: string;
}): Record<string, string> {
    const currentCharacter = options.currentCharacter ? formatTextToImageCharacterDraft(options.currentCharacter) : "";
    const currentOutfit = options.currentOutfit?.trim() ?? "";
    return {
        "用户需求": options.userRequest,
        "本次玩家输入": options.userRequest,
        "请求体": options.userRequest,
        userRequest: options.userRequest,
        request: options.userRequest,
        "当前角色": currentCharacter,
        currentCharacter,
        "当前服装": currentOutfit,
        currentOutfit,
    };
}

function buildCharacterOutputSchema(): {character: Record<string, string>} {
    return {
        character: Object.fromEntries(TEXT_TO_IMAGE_CHARACTER_FIELD_DEFINITIONS.map((field) => [field.label, "string"])),
    };
}

function buildCharacterOutputValues(character: Partial<TextToImageCharacter>): Record<string, string> {
    return Object.fromEntries(TEXT_TO_IMAGE_CHARACTER_FIELD_DEFINITIONS.map((field) => [
        field.label,
        stringifyTagValue(character[field.key]),
    ]));
}

function parseJsonCharacterDraft(content: string): Partial<TextToImageCharacter> {
    const data = parseJsonFromResponse(content);
    if (!data) {
        return {};
    }
    const source = readCharacterJsonSource(data);
    if (!source) {
        return {};
    }
    return readCharacterDraftFromRecord(source);
}

function parseJsonFromResponse(content: string): unknown | null {
    const trimmed = content.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1]?.trim();
    for (const candidate of [fenced, trimmed, readBalancedJsonObject(trimmed)]) {
        if (!candidate) {
            continue;
        }
        try {
            return JSON.parse(candidate);
        } catch {
            // Try the next candidate.
        }
    }
    return null;
}

function readBalancedJsonObject(content: string): string {
    const start = content.indexOf("{");
    if (start < 0) {
        return "";
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < content.length; index += 1) {
        const char = content[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\") {
            escaped = true;
            continue;
        }
        if (char === "\"") {
            inString = !inString;
            continue;
        }
        if (inString) {
            continue;
        }
        if (char === "{") {
            depth += 1;
        } else if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                return content.slice(start, index + 1);
            }
        }
    }
    return "";
}

function readCharacterJsonSource(data: unknown): JsonRecord | null {
    if (Array.isArray(data)) {
        return readCharacterJsonSource(data[0]);
    }
    if (!isRecord(data)) {
        return null;
    }
    for (const key of ["character", "人物", "角色", "person", "result", "data"]) {
        const value = data[key];
        const nested = readCharacterJsonSource(value);
        if (nested) {
            return nested;
        }
    }
    for (const key of ["characters", "人物列表", "角色列表"]) {
        const value = data[key];
        if (Array.isArray(value)) {
            const nested = readCharacterJsonSource(value[0]);
            if (nested) {
                return nested;
            }
        }
    }
    return data;
}

function readCharacterDraftFromRecord(record: JsonRecord): Partial<TextToImageCharacter> {
    const draft: Partial<TextToImageCharacter> = {};
    const normalizedEntries = new Map(Object.entries(record).map(([key, value]) => [normalizeKey(key), value]));
    for (const field of TEXT_TO_IMAGE_CHARACTER_FIELD_DEFINITIONS) {
        const value = readAliasValue(normalizedEntries, field.aliases);
        const text = stringifyTagValue(value);
        if (text) {
            (draft as Record<TextToImageCharacterDraftKey, string>)[field.key] = text;
        }
    }
    return draft;
}

function readAliasValue(entries: Map<string, unknown>, aliases: string[]): unknown {
    for (const alias of aliases) {
        if (entries.has(normalizeKey(alias))) {
            return entries.get(normalizeKey(alias));
        }
    }
    return undefined;
}

function parseLabeledCharacterDraft(content: string): Partial<TextToImageCharacter> {
    const draft: Partial<TextToImageCharacter> = {};
    const labels = TEXT_TO_IMAGE_CHARACTER_FIELD_DEFINITIONS.flatMap((field) => field.aliases);
    for (const field of TEXT_TO_IMAGE_CHARACTER_FIELD_DEFINITIONS) {
        const value = readLabeledField(content, field.aliases, labels);
        if (value) {
            (draft as Record<TextToImageCharacterDraftKey, string>)[field.key] = value;
        }
    }
    return draft;
}

function readLabeledField(content: string, fieldLabels: string[], allLabels: string[]): string {
    const labelPattern = allLabels.map(escapeRegExp).join("|");
    const fieldPattern = fieldLabels.map(escapeRegExp).join("|");
    const pattern = new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:${fieldPattern})\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:[-*]\\s*)?(?:${labelPattern})\\s*[:：]|$)`, "iu");
    return content.match(pattern)?.[1]?.trim() ?? "";
}

function stringifyTagValue(value: unknown): string {
    if (typeof value === "string") {
        return value.trim();
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (Array.isArray(value)) {
        return value.map(stringifyTagValue).filter(Boolean).join(", ");
    }
    if (isRecord(value)) {
        for (const key of ["tag", "tags", "value", "text", "prompt", "description"]) {
            const direct = stringifyTagValue(value[key]);
            if (direct) {
                return direct;
            }
        }
        return Object.values(value).map(stringifyTagValue).filter(Boolean).join(", ");
    }
    return "";
}

function normalizeKey(value: string): string {
    return value
        .trim()
        .toLocaleLowerCase()
        .replace(/[\s_\-:/：｜|（）()【】\[\]{}]+/gu, "");
}

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
