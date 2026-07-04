import type {TextToImageCharacter} from "nbook/app/stores/text-to-image";
import type {
    TextToImagePromptEngineOutfit,
    TextToImagePromptReplacementRule,
} from "nbook/app/utils/text-to-image-prompt-engine";

type JsonRecord = Record<string, unknown>;

export type StChatu8TextToImageImportResult = {
    characters: Array<Partial<TextToImageCharacter>>;
    outfits: Array<Partial<TextToImagePromptEngineOutfit>>;
    promptRules: TextToImagePromptReplacementRule[];
};

export function parseStChatu8TextToImageSettings(data: unknown): StChatu8TextToImageImportResult {
    const root = unwrapSettingsRoot(data);
    return {
        characters: readPresetMap(root, ["characterPresets", "characters", "角色预设", "角色设定"])
            .map(readCharacterDraft)
            .filter((item) => Boolean(item.cnName || item.enName || item.profileTraits || item.facialAppearance)),
        outfits: readPresetMap(root, ["outfitPresets", "outfits", "服装预设", "服装设定"])
            .map(readOutfitDraft)
            .filter((item) => Boolean(item.nameCn || item.nameEn || item.upperFront || item.lowerFront)),
        promptRules: readRuleList(root).map(readPromptRule).filter((rule): rule is TextToImagePromptReplacementRule => Boolean(rule)),
    };
}

function unwrapSettingsRoot(data: unknown): JsonRecord {
    if (!isRecord(data)) {
        return {};
    }
    for (const key of ["st-chatu8", "st_chatu8", "chatu8", "智绘姬"]) {
        const child = data[key];
        if (isRecord(child)) {
            return child;
        }
    }
    return data;
}

function readPresetMap(root: JsonRecord, keys: string[]): JsonRecord[] {
    for (const key of keys) {
        const value = root[key];
        if (Array.isArray(value)) {
            return value.filter(isRecord);
        }
        if (isRecord(value)) {
            return Object.values(value).filter(isRecord);
        }
    }
    return [];
}

function readRuleList(root: JsonRecord): JsonRecord[] {
    const direct = readPresetMap(root, [
        "promptReplaceRules",
        "promptReplacementRules",
        "replacementRules",
        "replaceRules",
        "regexRules",
        "dynamicPromptRules",
        "提示词替换",
        "替换规则",
        "正则",
    ]);
    if (direct.length > 0) {
        return direct;
    }
    const regex = root.regex;
    if (Array.isArray(regex)) {
        return regex.filter(isRecord);
    }
    return [];
}

function readCharacterDraft(record: JsonRecord): Partial<TextToImageCharacter> {
    return {
        cnName: readFirstString(record, ["cnName", "nameCN", "nameCn", "角色中文名称", "中文名称", "name_zh"]),
        enName: readFirstString(record, ["enName", "nameEN", "nameEn", "角色英文名称", "英文名称", "name_en"]),
        profileTraits: readFirstString(record, ["profileTraits", "characterTraits", "traits", "角色特征"]),
        facialAppearance: readFirstString(record, ["facialAppearance", "facialFeatures", "face", "五官外貌"]),
        facialBack: readFirstString(record, ["facialBack", "facialFeaturesBack", "faceBack", "五官外貌背面"]),
        upperSfw: readFirstString(record, ["upperSfw", "upperBodySFW", "upperBodySfw", "upperBody", "上半身SFW"]),
        upperBackSfw: readFirstString(record, ["upperBackSfw", "upperBodySFWBack", "upperBodyBackSfw", "upperBodyBack", "上半身背面SFW"]),
        lowerSfw: readFirstString(record, ["lowerSfw", "fullBodySFW", "lowerBodySFW", "fullBody", "lowerBody", "下半身SFW"]),
        lowerBackSfw: readFirstString(record, ["lowerBackSfw", "fullBodySFWBack", "lowerBodySFWBack", "fullBodyBack", "lowerBodyBack", "下半身背面SFW"]),
        upperNsfw: readFirstString(record, ["upperNsfw", "upperBodyNSFW", "upperBodyNsfw", "上半身NSFW"]),
        upperBackNsfw: readFirstString(record, ["upperBackNsfw", "upperBodyNSFWBack", "upperBodyBackNsfw", "上半身NSFW背面"]),
        lowerNsfw: readFirstString(record, ["lowerNsfw", "fullBodyNSFW", "lowerBodyNSFW", "下半身NSFW"]),
        lowerBackNsfw: readFirstString(record, ["lowerBackNsfw", "fullBodyNSFWBack", "lowerBodyNSFWBack", "下半身NSFW背面"]),
    };
}

function readOutfitDraft(record: JsonRecord): Partial<TextToImagePromptEngineOutfit> {
    return {
        nameCn: readFirstString(record, ["nameCn", "nameCN", "服装中文名称", "中文名称"]),
        nameEn: readFirstString(record, ["nameEn", "nameEN", "服装英文名称", "英文名称"]),
        aliases: readFirstString(record, ["aliases", "alias", "trigger", "triggers", "触发词"]),
        enabled: readBoolean(record, ["enabled", "enable", "启用"], true),
        upperFront: readFirstString(record, ["upperFront", "upperBody", "upperBodyFront", "上半身"]),
        upperBack: readFirstString(record, ["upperBack", "upperBodyBack", "上半身背面"]),
        lowerFront: readFirstString(record, ["lowerFront", "fullBody", "lowerBody", "下半身"]),
        lowerBack: readFirstString(record, ["lowerBack", "fullBodyBack", "lowerBodyBack", "下半身背面"]),
        fullPrompt: readFirstString(record, ["fullPrompt", "prompt", "tags", "完整提示词"]),
        negativePrompt: readFirstString(record, ["negativePrompt", "negative", "uc", "负面提示词"]),
    };
}

function readPromptRule(record: JsonRecord): TextToImagePromptReplacementRule | null {
    const trigger = readFirstString(record, ["trigger", "find", "match", "pattern", "from", "source", "原文", "查找"]);
    const replacement = readFirstString(record, ["replacement", "replace", "to", "targetText", "目标", "替换"]);
    if (!trigger && !replacement) {
        return null;
    }
    const targetText = readFirstString(record, ["target", "scope", "作用目标"]).toLocaleLowerCase();
    const modeText = readFirstString(record, ["mode", "type", "方式"]).toLocaleLowerCase();
    const regex = readBoolean(record, ["regex", "isRegex", "正则"], false) || modeText.includes("regex");
    return {
        id: readFirstString(record, ["id"]) || `st-chatu8-rule-${hashString(`${trigger}\n${replacement}`)}`,
        name: readFirstString(record, ["name", "label", "规则名"]) || trigger || replacement,
        enabled: readBoolean(record, ["enabled", "enable", "启用"], true),
        target: targetText.includes("negative") || targetText.includes("负") ? "negative" : "positive",
        matchMode: regex ? "regex" : "plain",
        mode: modeText.includes("append") || modeText.includes("追加")
            ? "append"
            : modeText.includes("prepend") || modeText.includes("前置")
                ? "prepend"
                : modeText.includes("delete") || modeText.includes("删除")
                    ? "delete"
                    : "replace",
        trigger,
        replacement,
    };
}

function readFirstString(record: JsonRecord, keys: string[]): string {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
        if (typeof value === "number" && Number.isFinite(value)) {
            return String(value);
        }
        if (Array.isArray(value)) {
            const items = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
            if (items.length > 0) {
                return items.join("|");
            }
        }
    }
    return "";
}

function readBoolean(record: JsonRecord, keys: string[], fallback: boolean): boolean {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "boolean") {
            return value;
        }
        if (typeof value === "string") {
            const normalized = value.trim().toLocaleLowerCase();
            if (["true", "1", "yes", "on", "启用"].includes(normalized)) {
                return true;
            }
            if (["false", "0", "no", "off", "禁用"].includes(normalized)) {
                return false;
            }
        }
    }
    return fallback;
}

function isRecord(value: unknown): value is JsonRecord {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hashString(value: string): string {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    }
    return Math.abs(hash).toString(36);
}
