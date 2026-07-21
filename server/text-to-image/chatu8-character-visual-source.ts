import {
    hashTextToImageContract,
    type TextToImageContractValue,
} from "nbook/shared/text-to-image-contract-hash";
import {
    CHATU8_CHARACTER_VISUAL_SOURCE_SCHEMA_VERSION,
    Chatu8CharacterVisualSourcePackageSchema,
    type Chatu8CharacterVisualSourceDiagnostic,
    type Chatu8CharacterVisualSourcePackage,
} from "nbook/shared/text-to-image-character-source";
import {
    CHATU8_STORYBOARD_JSON_LIMITS,
    parseStrictChatu8JsonDocument,
} from "nbook/server/text-to-image/chatu8-storyboard-json";

type JsonObject = {[key: string]: TextToImageContractValue};

type RawCharacter = {
    sourceKey: string;
    names: {cn: string; en: string};
    fields: Omit<Chatu8CharacterVisualSourcePackage["characters"][number]["fields"], "negativePrompt">;
    outfitKeys: string[];
};

type RawOutfit = {
    sourceKey: string;
    owner: string;
    names: {cn: string; en: string};
    fields: Chatu8CharacterVisualSourcePackage["characters"][number]["outfits"][number]["fields"];
};

const ROOT_FIELDS = new Set(["characters", "outfits", "images", "_encrypted", "_nameMap", "_version"]);
const CHARACTER_VISUAL_FIELDS = new Set([
    "nameCN", "nameEN", "characterTraits", "facialFeatures", "facialFeaturesBack",
    "upperBodySFW", "upperBodySFWBack", "fullBodySFW", "fullBodySFWBack",
    "upperBodyNSFW", "upperBodyNSFWBack", "fullBodyNSFW", "fullBodyNSFWBack", "outfits",
]);
const CHARACTER_IGNORED_FIELDS = new Set([
    "photoImageIds", "selectedPhotoIndex", "photoPrompt", "sendPhoto",
    "generationContext", "generationWorldBook", "generationVariables",
]);
const OUTFIT_VISUAL_FIELDS = new Set([
    "nameCN", "nameEN", "owner", "upperBody", "upperBodyBack", "fullBody", "fullBodyBack",
]);
const OUTFIT_IGNORED_FIELDS = new Set(["photoImageIds", "selectedPhotoIndex", "photoPrompt", "sendPhoto"]);

/**
 * 解析 st-chatu8 公开明文角色/服装 export 为不可执行 source package。
 *
 * 加密 envelope、tagData、未知 root 与无法证明 owner/ref 的记录只生成 report，不解密、不猜 schema。
 */
export function parseChatu8CharacterVisualSource(bytes: Uint8Array): Chatu8CharacterVisualSourcePackage {
    const document = parseStrictChatu8JsonDocument(bytes);
    const diagnostics: Chatu8CharacterVisualSourceDiagnostic[] = [];
    const root = asObject(document.sanitizedValue);
    if (!root) {
        return packageResult(document, [], [{
            code: "SOURCE_SHAPE_INVALID",
            scope: "root",
            sourceKey: null,
            message: "Chatu8 角色视觉 export 根必须是 object",
        }]);
    }

    const rootKeys = Object.keys(root);
    const tagDataKeys = rootKeys.filter((key) => normalizeKey(key) === "tagdata");
    tagDataKeys.forEach((key) => diagnostics.push({
        code: "TAGDATA_FORBIDDEN",
        scope: "root",
        sourceKey: key,
        message: "角色视觉 source 不接收 Chatu8 tagData",
    }));
    rootKeys.filter((key) => !ROOT_FIELDS.has(key) && normalizeKey(key) !== "tagdata").forEach((key) => diagnostics.push({
        code: "UNKNOWN_ROOT_FIELD",
        scope: "root",
        sourceKey: key,
        message: `未知 Chatu8 export 根字段：${key}`,
    }));
    if (root._encrypted === true) {
        diagnostics.push({
            code: "ENCRYPTED_EXPORT_UNSUPPORTED",
            scope: "root",
            sourceKey: null,
            message: "加密 Chatu8 export 只报告，不在 Route B 中解密",
        });
    }
    if (root.images !== undefined) {
        diagnostics.push({
            code: "IMAGES_IGNORED",
            scope: "root",
            sourceKey: null,
            message: "images 不进入角色视觉 proposal",
        });
    }
    if (diagnostics.some((item) => item.code === "TAGDATA_FORBIDDEN"
        || item.code === "UNKNOWN_ROOT_FIELD"
        || item.code === "ENCRYPTED_EXPORT_UNSUPPORTED")) {
        return packageResult(document, [], diagnostics);
    }

    const characterMap = asObject(root.characters);
    const outfitMap = root.outfits === undefined ? Object.create(null) as JsonObject : asObject(root.outfits);
    if (!characterMap || !outfitMap) {
        diagnostics.push({
            code: "SOURCE_SHAPE_INVALID",
            scope: "root",
            sourceKey: null,
            message: "明文 export 必须包含 characters object，outfits 如存在也必须是 object",
        });
        return packageResult(document, [], diagnostics);
    }
    if (Object.keys(characterMap).length > CHATU8_STORYBOARD_JSON_LIMITS.maxEntries
        || Object.keys(outfitMap).length > CHATU8_STORYBOARD_JSON_LIMITS.maxEntries) {
        diagnostics.push({
            code: "SOURCE_SHAPE_INVALID",
            scope: "root",
            sourceKey: null,
            message: "角色或服装记录数量超过 strict import 上限",
        });
        return packageResult(document, [], diagnostics);
    }

    const rawCharacters = new Map<string, RawCharacter>();
    Object.keys(characterMap).sort(compareText).forEach((sourceKey) => {
        const parsed = parseCharacter(sourceKey, characterMap[sourceKey]!, diagnostics);
        if (parsed) rawCharacters.set(sourceKey, parsed);
    });
    const rawOutfits = new Map<string, RawOutfit>();
    Object.keys(outfitMap).sort(compareText).forEach((sourceKey) => {
        const parsed = parseOutfit(sourceKey, outfitMap[sourceKey]!, diagnostics);
        if (parsed) rawOutfits.set(sourceKey, parsed);
    });

    const outfitOwners = new Map<string, string[]>();
    rawCharacters.forEach((character) => {
        character.outfitKeys.forEach((outfitKey) => {
            const owners = outfitOwners.get(outfitKey) ?? [];
            owners.push(character.sourceKey);
            outfitOwners.set(outfitKey, owners);
        });
    });
    rawOutfits.forEach((_, outfitKey) => {
        if (!outfitOwners.has(outfitKey)) {
            diagnostics.push({
                code: "OUTFIT_ORPHANED",
                scope: "outfit",
                sourceKey: outfitKey,
                message: `服装未被任何角色引用：${outfitKey}`,
            });
        }
    });

    const characters: Chatu8CharacterVisualSourcePackage["characters"] = [];
    rawCharacters.forEach((character) => {
        let blocked = false;
        const sourceCharacterId = stableId("character", character.sourceKey);
        const outfits: Chatu8CharacterVisualSourcePackage["characters"][number]["outfits"] = [];
        character.outfitKeys.forEach((outfitKey) => {
            const outfit = rawOutfits.get(outfitKey);
            if (!outfit) {
                blocked = true;
                diagnostics.push({
                    code: "OUTFIT_REF_MISSING",
                    scope: "character",
                    sourceKey: character.sourceKey,
                    message: `角色引用的服装不存在或字段非法：${outfitKey}`,
                });
                return;
            }
            const owners = outfitOwners.get(outfitKey) ?? [];
            if (owners.length !== 1) {
                blocked = true;
                diagnostics.push({
                    code: "OUTFIT_SHARED",
                    scope: "character",
                    sourceKey: character.sourceKey,
                    message: `同一服装不能同时归属多个 V2 角色：${outfitKey}`,
                });
                return;
            }
            if (outfit.owner.trim() && !sameIdentity(outfit.owner, character.sourceKey)
                && !sameIdentity(outfit.owner, character.names.cn)
                && !sameIdentity(outfit.owner, character.names.en)) {
                blocked = true;
                diagnostics.push({
                    code: "OUTFIT_OWNER_CONFLICT",
                    scope: "character",
                    sourceKey: character.sourceKey,
                    message: `服装 ${outfitKey} owner 与角色 identity 不一致`,
                });
                return;
            }
            outfits.push({
                sourceOutfitId: stableId("outfit", outfit.sourceKey),
                sourceKey: outfit.sourceKey,
                ownerSourceCharacterId: sourceCharacterId,
                names: outfit.names,
                fields: outfit.fields,
            });
        });
        const hasVisualFacts = Object.values(character.fields).some((value) => value.trim())
            || outfits.some((outfit) => Object.values(outfit.fields).some((value) => value.trim()));
        if (!hasVisualFacts) {
            blocked = true;
            diagnostics.push({
                code: "CHARACTER_VISUAL_EMPTY",
                scope: "character",
                sourceKey: character.sourceKey,
                message: "角色与其服装都没有可迁移的视觉字段",
            });
        }
        if (!blocked) {
            characters.push({
                sourceCharacterId,
                sourceKey: character.sourceKey,
                names: character.names,
                fields: {...character.fields, negativePrompt: ""},
                outfits: outfits.sort((left, right) => compareText(left.sourceKey, right.sourceKey)),
            });
        }
    });
    characters.sort((left, right) => compareText(left.sourceKey, right.sourceKey));
    return packageResult(document, characters, diagnostics);
}

/** 严格读取一个公开 character record；unknown 字段只隔离当前记录。 */
function parseCharacter(
    sourceKey: string,
    value: TextToImageContractValue,
    diagnostics: Chatu8CharacterVisualSourceDiagnostic[],
): RawCharacter | null {
    const record = asObject(value);
    if (!record) return invalidRecord("character", sourceKey, "角色记录必须是 object", diagnostics);
    const unknown = Object.keys(record).filter((key) => !CHARACTER_VISUAL_FIELDS.has(key) && !CHARACTER_IGNORED_FIELDS.has(key));
    if (unknown.length > 0) {
        unknown.sort(compareText).forEach((field) => diagnostics.push({
            code: "UNKNOWN_CHARACTER_FIELD",
            scope: "character",
            sourceKey,
            message: `未知角色字段：${field}`,
        }));
        return null;
    }
    const strings = readStrings(record, [
        "nameCN", "nameEN", "characterTraits", "facialFeatures", "facialFeaturesBack",
        "upperBodySFW", "upperBodySFWBack", "fullBodySFW", "fullBodySFWBack",
        "upperBodyNSFW", "upperBodyNSFWBack", "fullBodyNSFW", "fullBodyNSFWBack",
    ], "character", sourceKey, diagnostics);
    if (!strings) return null;
    if (strings.nameCN.trim().length > 160 || strings.nameEN.trim().length > 160) {
        return invalidRecord("character", sourceKey, "角色显示名称超过 160 字符", diagnostics);
    }
    if (!Array.isArray(record.outfits) || record.outfits.some((item) => typeof item !== "string" || !item.trim())) {
        return invalidRecord("character", sourceKey, "角色 outfits 必须是非空字符串数组", diagnostics);
    }
    const outfitKeys = record.outfits.map((item) => String(item).trim());
    if (new Set(outfitKeys).size !== outfitKeys.length || outfitKeys.length > 256) {
        return invalidRecord("character", sourceKey, "角色 outfits 必须唯一且不超过 256 项", diagnostics);
    }
    return {
        sourceKey,
        names: {cn: strings.nameCN.trim(), en: strings.nameEN.trim()},
        fields: {
            profileTraits: strings.characterTraits,
            facialAppearance: strings.facialFeatures,
            facialBack: strings.facialFeaturesBack,
            upperSfw: strings.upperBodySFW,
            upperBackSfw: strings.upperBodySFWBack,
            lowerSfw: strings.fullBodySFW,
            lowerBackSfw: strings.fullBodySFWBack,
            upperNsfw: strings.upperBodyNSFW,
            upperBackNsfw: strings.upperBodyNSFWBack,
            lowerNsfw: strings.fullBodyNSFW,
            lowerBackNsfw: strings.fullBodyNSFWBack,
        },
        outfitKeys,
    };
}

/** 严格读取一个公开 outfit record；unknown 字段只隔离当前记录。 */
function parseOutfit(
    sourceKey: string,
    value: TextToImageContractValue,
    diagnostics: Chatu8CharacterVisualSourceDiagnostic[],
): RawOutfit | null {
    const record = asObject(value);
    if (!record) return invalidRecord("outfit", sourceKey, "服装记录必须是 object", diagnostics);
    const unknown = Object.keys(record).filter((key) => !OUTFIT_VISUAL_FIELDS.has(key) && !OUTFIT_IGNORED_FIELDS.has(key));
    if (unknown.length > 0) {
        unknown.sort(compareText).forEach((field) => diagnostics.push({
            code: "UNKNOWN_OUTFIT_FIELD",
            scope: "outfit",
            sourceKey,
            message: `未知服装字段：${field}`,
        }));
        return null;
    }
    const strings = readStrings(record, [
        "nameCN", "nameEN", "owner", "upperBody", "upperBodyBack", "fullBody", "fullBodyBack",
    ], "outfit", sourceKey, diagnostics);
    if (!strings) return null;
    if (strings.nameCN.trim().length > 160 || strings.nameEN.trim().length > 160) {
        return invalidRecord("outfit", sourceKey, "服装显示名称超过 160 字符", diagnostics);
    }
    return {
        sourceKey,
        owner: strings.owner,
        names: {cn: strings.nameCN.trim(), en: strings.nameEN.trim()},
        fields: {
            upper: strings.upperBody,
            upperBack: strings.upperBodyBack,
            lower: strings.fullBody,
            lowerBack: strings.fullBodyBack,
        },
    };
}

/** 一次读取全部 required string，禁止缺字段/null/数组被静默转成空字符串。 */
function readStrings<TKey extends string>(
    record: JsonObject,
    keys: readonly TKey[],
    scope: "character" | "outfit",
    sourceKey: string,
    diagnostics: Chatu8CharacterVisualSourceDiagnostic[],
): Record<TKey, string> | null {
    const result = {} as Record<TKey, string>;
    for (const key of keys) {
        const value = record[key];
        if (typeof value !== "string") {
            invalidRecord(scope, sourceKey, `字段 ${key} 必须是 string`, diagnostics);
            return null;
        }
        result[key] = value;
    }
    return result;
}

/** 记录当前 record 的稳定非法字段诊断。 */
function invalidRecord<TScope extends "character" | "outfit">(
    scope: TScope,
    sourceKey: string,
    message: string,
    diagnostics: Chatu8CharacterVisualSourceDiagnostic[],
): null {
    diagnostics.push({
        code: scope === "character" ? "INVALID_CHARACTER_FIELD" : "INVALID_OUTFIT_FIELD",
        scope,
        sourceKey,
        message,
    });
    return null;
}

/** 构造 canonical package；visual hash 不包含 images bytes 或原文件编码顺序。 */
function packageResult(
    document: ReturnType<typeof parseStrictChatu8JsonDocument>,
    characters: Chatu8CharacterVisualSourcePackage["characters"],
    diagnostics: Chatu8CharacterVisualSourceDiagnostic[],
): Chatu8CharacterVisualSourcePackage {
    const sortedDiagnostics = [...diagnostics].sort((left, right) => compareText(
        `${left.scope}\u0000${left.sourceKey ?? ""}\u0000${left.code}\u0000${left.message}`,
        `${right.scope}\u0000${right.sourceKey ?? ""}\u0000${right.code}\u0000${right.message}`,
    ));
    const visualSourceHash = hashTextToImageContract({
        sourceKind: "chatu8-character-export",
        characters: characters.map((character) => ({
            sourceCharacterId: character.sourceCharacterId,
            sourceKey: character.sourceKey,
            names: {...character.names},
            fields: {...character.fields},
            outfits: character.outfits.map((outfit) => ({
                sourceOutfitId: outfit.sourceOutfitId,
                sourceKey: outfit.sourceKey,
                ownerSourceCharacterId: outfit.ownerSourceCharacterId,
                names: {...outfit.names},
                fields: {...outfit.fields},
            })),
        })),
        diagnostics: sortedDiagnostics
            .filter((diagnostic) => diagnostic.code !== "IMAGES_IGNORED")
            .map((diagnostic) => ({...diagnostic})),
    });
    return Chatu8CharacterVisualSourcePackageSchema.parse({
        schemaVersion: CHATU8_CHARACTER_VISUAL_SOURCE_SCHEMA_VERSION,
        sourceKind: "chatu8-character-export",
        state: characters.length > 0 ? "proposal_ready" : "report_only",
        rawSourceHash: document.rawSourceHash,
        sanitizedSourceHash: document.sanitizedSourceHash,
        visualSourceHash,
        characters,
        diagnostics: sortedDiagnostics,
    });
}

/** 只接受 strict JSON object。 */
function asObject(value: TextToImageContractValue | undefined): JsonObject | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

/** 为公开 export map key 派生不依赖对象顺序的稳定 source identity。 */
function stableId(kind: "character" | "outfit", sourceKey: string): string {
    const hash = hashTextToImageContract({sourceKind: "chatu8-character-export", kind, sourceKey});
    return `chatu8-${kind}-${hash.slice("sha256:".length, "sha256:".length + 24)}`;
}

/** 对公开 owner/source key/display name 做 NFKC + case-fold exact identity 比较。 */
function sameIdentity(left: string, right: string): boolean {
    if (!left.trim() || !right.trim()) return false;
    return left.normalize("NFKC").trim().toLocaleLowerCase("en-US")
        === right.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

/** key 判断只用于识别明确禁用的 tagData，不解析其内容。 */
function normalizeKey(value: string): string {
    return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^a-z0-9]/gu, "");
}

/** 固定 Unicode code-point 排序。 */
function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
