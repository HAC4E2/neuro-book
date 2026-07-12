export type TextToImageOutfitDraft = {
    owner: string;
    nameCn: string;
    nameEn: string;
    upper: string;
    upperBack: string;
    lower: string;
    lowerBack: string;
};

type OutfitDraftKey = keyof TextToImageOutfitDraft;
type JsonRecord = {[key: string]: unknown};

const OUTFIT_FIELD_ALIASES: Array<{key: OutfitDraftKey; aliases: string[]}> = [
    {key: "owner", aliases: ["归属人", "归属角色", "owner", "character", "characterName"]},
    {key: "nameCn", aliases: ["中文名称", "服装中文名称", "nameCn", "chineseName"]},
    {key: "nameEn", aliases: ["英文名称", "服装英文名称", "nameEn", "englishName", "name"]},
    {key: "upper", aliases: ["上半身", "upper", "upperBody"]},
    {key: "upperBack", aliases: ["上半身背面", "upperBack", "upperBodyBack"]},
    {key: "lower", aliases: ["下半身", "lower", "lowerBody"]},
    {key: "lowerBack", aliases: ["下半身背面", "lowerBack", "lowerBodyBack"]},
];

/**
 * 从角色/服装设计 LLM 回复中解析全部服装，支持结构化 JSON 与多个 `<服装>` 块。
 */
export function parseTextToImageOutfitDrafts(content: string): TextToImageOutfitDraft[] {
    const jsonDrafts = parseJsonOutfitDrafts(content);
    if (jsonDrafts.length > 0) {
        return jsonDrafts;
    }
    return Array.from(content.matchAll(/<服装>\s*([\s\S]*?)\s*<\/服装>/giu))
        .map((match) => parseLabeledOutfitDraft(match[1] ?? ""))
        .filter(isNamedOutfitDraft);
}

function parseJsonOutfitDrafts(content: string): TextToImageOutfitDraft[] {
    const data = parseJsonFromResponse(content);
    if (!isRecord(data)) {
        return [];
    }
    const source = ["outfits", "服装列表", "服装"]
        .map((key) => data[key])
        .find((value) => Array.isArray(value) || isRecord(value));
    const records = Array.isArray(source) ? source : source ? [source] : [];
    return records.filter(isRecord).map(readOutfitDraft).filter(isNamedOutfitDraft);
}

function parseLabeledOutfitDraft(content: string): TextToImageOutfitDraft {
    const labels = OUTFIT_FIELD_ALIASES.flatMap((field) => field.aliases);
    return Object.fromEntries(OUTFIT_FIELD_ALIASES.map((field) => [
        field.key,
        readLabeledField(content, field.aliases, labels),
    ])) as TextToImageOutfitDraft;
}

function readOutfitDraft(record: JsonRecord): TextToImageOutfitDraft {
    const entries = new Map(Object.entries(record).map(([key, value]) => [normalizeKey(key), value]));
    return Object.fromEntries(OUTFIT_FIELD_ALIASES.map((field) => {
        const value = field.aliases.map((alias) => entries.get(normalizeKey(alias))).find((candidate) => typeof candidate === "string");
        return [field.key, typeof value === "string" ? value.trim() : ""];
    })) as TextToImageOutfitDraft;
}

function readLabeledField(content: string, fieldLabels: string[], allLabels: string[]): string {
    const labelPattern = allLabels.map(escapeRegExp).join("|");
    const fieldPattern = fieldLabels.map(escapeRegExp).join("|");
    const pattern = new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:${fieldPattern})\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:[-*]\\s*)?(?:${labelPattern})\\s*[:：]|$)`, "iu");
    return content.match(pattern)?.[1]?.trim() ?? "";
}

function parseJsonFromResponse(content: string): unknown | null {
    const trimmed = content.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1]?.trim();
    for (const candidate of [fenced, trimmed, readBalancedJsonObject(trimmed)]) {
        if (!candidate) {
            continue;
        }
        try {
            return JSON.parse(candidate) as unknown;
        } catch {
            // 当前候选不是完整 JSON，继续尝试回复中的平衡对象。
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
        } else if (char === "\\") {
            escaped = true;
        } else if (char === "\"") {
            inString = !inString;
        } else if (!inString && char === "{") {
            depth += 1;
        } else if (!inString && char === "}") {
            depth -= 1;
            if (depth === 0) {
                return content.slice(start, index + 1);
            }
        }
    }
    return "";
}

function isNamedOutfitDraft(draft: TextToImageOutfitDraft): boolean {
    return Boolean(draft.nameCn || draft.nameEn);
}

function isRecord(value: unknown): value is JsonRecord {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(value: string): string {
    return value.replace(/[\s_\-:：]/gu, "").toLocaleLowerCase();
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
