import {createHash} from "node:crypto";
import {
    canonicalizeTextToImageContract,
    hashTextToImageContract,
    type TextToImageContractValue,
} from "nbook/shared/text-to-image-contract-hash";
import {
    TtpInspectedEntrySchema,
    type TtpEntryClassification,
    type TtpInspectedEntry,
    type StoryboardImportMacroToken,
} from "nbook/shared/text-to-image-storyboard-import";
import type {
    TtpJsonEntrySource,
    ParsedTtpStoryboardJson,
} from "nbook/server/text-to-image/ttp-storyboard-json";

export const TTP_STORYBOARD_CHUNK_LIMITS = {
    maxEntriesPerChunk: 64,
    maxCharactersPerChunk: 80000,
} as const;

export type TtpStoryboardChunkSegment = {
    sourceEntryId: string;
    startOffset: number;
    endOffset: number;
    contentHash: string;
};

export type TtpStoryboardChunk = {
    chunkIndex: number;
    entryCount: number;
    characterCount: number;
    segments: TtpStoryboardChunkSegment[];
    chunkHash: string;
};

export type TtpStoryboardInspection = {
    schemaVersion: "nbook.ttp-storyboard-inspection/v1";
    sourceShape: ParsedTtpStoryboardJson["sourceShape"];
    sourcePresetKey: string;
    rawSourceHash: string;
    sanitizedSourceHash: string;
    entries: TtpInspectedEntry[];
    macroTokens: StoryboardImportMacroToken[];
    chunks: TtpStoryboardChunk[];
    inspectionHash: string;
};

const ENTRY_ALLOWLIST = new Set([
    "id",
    "role",
    "enabled",
    "triggerMode",
    "triggerWords",
    "andTriggerWords",
    "content",
]);

const CLASSIFICATION_ORDER: readonly TtpEntryClassification[] = [
    "core_rule",
    "atomic_group",
    "scene_recipe",
    "style_quality",
    "negative_constraint",
    "trigger_alias",
    "macro",
];

/** 对 strict/redacted JSON 做纯确定性 entry 归一化、粗分类、宏词法分析与分片。 */
export function inspectTtpStoryboard(source: ParsedTtpStoryboardJson): TtpStoryboardInspection {
    const entries = source.entries.map((entry) => inspectEntry(source.sourcePresetKey, entry));
    const identities = new Set<string>();
    for (const entry of entries) {
        const sourceEntryId = entry.sourceIdentity.sourceEntryId;
        if (identities.has(sourceEntryId)) {
            throw new Error(`STORYBOARD_IMPORT_ENTRY_ID_CONFLICT: ${sourceEntryId}`);
        }
        identities.add(sourceEntryId);
    }
    const macroTokens = entries.flatMap((entry) => extractMacroTokens(entry));
    const blockingMacroEntries = new Set(macroTokens
        .filter((token) => token.blocking)
        .map((token) => token.path.replace(/\/content$/u, "")));
    const conversionEntries = entries.filter((entry) => entry.enabled
        && !entry.flags.characterOrOutfit
        && !entry.flags.outputTemplate
        && !entry.flags.privilegeOrSafetyClaim
        && !entry.flags.irrelevant
        && !blockingMacroEntries.has(entry.sourceIdentity.jsonPointer));
    const chunks = buildChunks(conversionEntries);
    const inspectionHash = hashTextToImageContract({
        sourceShape: source.sourceShape,
        sourcePresetKey: source.sourcePresetKey,
        sanitizedSourceHash: source.sanitizedSourceHash,
        entries: entries.map((entry) => ({
            sourceIdentity: {...entry.sourceIdentity},
            enabled: entry.enabled,
            role: entry.role,
            triggerMode: entry.triggerMode,
            triggerWords: [...entry.triggerWords],
            andTriggerWords: [...entry.andTriggerWords],
            contentHash: sha256(entry.content),
            unknownFields: [...entry.unknownFields],
            classifications: [...entry.classifications],
            flags: {...entry.flags},
        })),
        macroTokens: macroTokens.map((token) => ({...token})),
        chunks: chunks.map((chunk) => ({
            chunkIndex: chunk.chunkIndex,
            entryCount: chunk.entryCount,
            characterCount: chunk.characterCount,
            segments: chunk.segments.map((segment) => ({...segment})),
            chunkHash: chunk.chunkHash,
        })),
    });
    return {
        schemaVersion: "nbook.ttp-storyboard-inspection/v1",
        sourceShape: source.sourceShape,
        sourcePresetKey: source.sourcePresetKey,
        rawSourceHash: source.rawSourceHash,
        sanitizedSourceHash: source.sanitizedSourceHash,
        entries,
        macroTokens,
        chunks,
        inspectionHash,
    };
}

/** 把单个脱敏 source entry 收窄为共享 allowlist DTO。 */
function inspectEntry(sourcePresetKey: string, source: TtpJsonEntrySource): TtpInspectedEntry {
    const content = typeof source.value.content === "string" ? source.value.content : "";
    const triggerWords = readStringList(source.value.triggerWords);
    const andTriggerWords = readStringList(source.value.andTriggerWords);
    const enabled = typeof source.value.enabled === "boolean" ? source.value.enabled : true;
    const macroTokens = extractRawMacroTokens(content, `${source.jsonPointer}/content`, enabled);
    const classifications = classifyEntry(content, triggerWords, andTriggerWords, macroTokens);
    return TtpInspectedEntrySchema.parse({
        sourceIdentity: createSourceIdentity(sourcePresetKey, source),
        enabled,
        role: source.value.role === "user" || source.value.role === "assistant" ? source.value.role : "system",
        triggerMode: source.value.triggerMode === "trigger" ? "trigger" : "always",
        triggerWords,
        andTriggerWords,
        content,
        unknownFields: Object.keys(source.value).filter((key) => !ENTRY_ALLOWLIST.has(key)).sort(),
        classifications,
        flags: {
            characterOrOutfit: /角色|服装|衣着|character|outfit|facial|upperbody|lowerbody/iu.test(content),
            outputTemplate: /<image>|<text-to-image|final\s+prompt|输出模板|输出格式|output\s+template/iu.test(content),
            privilegeOrSafetyClaim: /system\s+prompt|ignore\s+previous|忽略.{0,12}指令|权限|shell|write\s+file|provider|api\s*key|secret/iu.test(content),
            irrelevant: classifications.length === 0,
        },
    });
}

/** 按 explicit id → map key → canonical entry hash 派生稳定 source identity。 */
function createSourceIdentity(sourcePresetKey: string, source: TtpJsonEntrySource): TtpInspectedEntry["sourceIdentity"] {
    const explicitId = typeof source.value.id === "string" && source.value.id.trim()
        ? source.value.id.trim()
        : typeof source.value.id === "number" && Number.isFinite(source.value.id)
            ? String(source.value.id)
            : null;
    const identityKind = explicitId
        ? "explicit_id" as const
        : source.mapKey !== null
            ? "map_key" as const
            : "canonical_hash" as const;
    const identityValue = explicitId ?? source.mapKey ?? canonicalizeTextToImageContract(source.value);
    return {
        sourcePresetKey,
        sourceEntryId: `ttpe.${createHash("sha256").update(`${identityKind}:${identityValue}`, "utf8").digest("hex").slice(0, 32)}`,
        identityKind,
        sourceOrder: source.sourceOrder,
        jsonPointer: source.jsonPointer,
    };
}

/** 使用冻结顺序执行可解释的多标签粗分类；未命中项由 irrelevant flag 承接。 */
function classifyEntry(
    content: string,
    triggerWords: string[],
    andTriggerWords: string[],
    macroTokens: StoryboardImportMacroToken[],
): TtpEntryClassification[] {
    const normalized = content.normalize("NFKC").toLocaleLowerCase("en-US");
    const tagParts = normalized.split(/[,，]/u).map((item) => item.trim()).filter(Boolean);
    const matched = new Set<TtpEntryClassification>();
    if (/分镜|镜头|构图|取景|景别|画面选择|storyboard|camera|\bshot\b|<image>/iu.test(normalized)) {
        matched.add("core_rule");
    }
    const sceneEvidence = /场景|背景|光照|灯光|动作|小巷|alley|background|lighting|backlight|wide\s+shot|close-?up|standing|sitting/iu.test(normalized);
    if (/scene\s+recipe|场景模板/iu.test(normalized) || (tagParts.length >= 3 && sceneEvidence)) {
        matched.add("scene_recipe");
    }
    if (/原子|基础.?tag|atomic\s+group|tag\s+group/iu.test(normalized)
        || (tagParts.length >= 2 && tagParts.length <= 12 && normalized.length <= 2000 && !sceneEvidence)) {
        matched.add("atomic_group");
    }
    if (/masterpiece|best\s+quality|high\s+quality|画风|风格|\bstyle\b|aesthetic|\bquality\b/iu.test(normalized)) {
        matched.add("style_quality");
    }
    if (/negative|undesired|lowres|bad\s+anatomy|负面|反向|\buc\b/iu.test(normalized)) {
        matched.add("negative_constraint");
    }
    if (triggerWords.length > 0 || andTriggerWords.length > 0) matched.add("trigger_alias");
    if (macroTokens.length > 0) matched.add("macro");
    return CLASSIFICATION_ORDER.filter((classification) => matched.has(classification));
}

/** 从规范 entry 重新抽取宏，确保 path/enabled 与最终 DTO 一致。 */
function extractMacroTokens(entry: TtpInspectedEntry): StoryboardImportMacroToken[] {
    return extractRawMacroTokens(entry.content, `${entry.sourceIdentity.jsonPointer}/content`, entry.enabled);
}

/** 词法识别双大括号与模板 token，不执行任何外部宏。 */
function extractRawMacroTokens(content: string, path: string, enabled: boolean): StoryboardImportMacroToken[] {
    const tokens: StoryboardImportMacroToken[] = [];
    const pattern = /\{\{[\s\S]*?\}\}|<%[\s\S]*?%>/gu;
    for (const matched of content.matchAll(pattern)) {
        const token = matched[0];
        const inner = token.startsWith("{{") ? token.slice(2, -2).trim() : token.slice(2, -2).trim();
        const normalized = inner.normalize("NFKC").toLocaleLowerCase("en-US");
        const classification = /^(正文|上下文|用户需求)$/u.test(inner)
            ? "registered_binding" as const
            : /^(user|char)$/u.test(normalized)
                ? "identity" as const
                : /\b(?:roll|random|rand|dice|pick)\b|::(?:random|pick)|^(?:random|pick)::/iu.test(normalized)
                    ? "stochastic" as const
                    : /[,，]|::/u.test(inner)
                        ? "tag_fragment" as const
                        : !inner || inner.includes("{{") || inner.includes("}}")
                            ? "ambiguous_double_brace" as const
                            : "unknown" as const;
        tokens.push({
            token,
            path,
            classification,
            blocking: enabled && (classification === "stochastic" || classification === "ambiguous_double_brace" || classification === "unknown"),
        });
    }
    return tokens;
}

/** 构建不截断 content 的稳定 chunk manifest；长 entry 通过 offset segment 跨块。 */
function buildChunks(entries: TtpInspectedEntry[]): TtpStoryboardChunk[] {
    const chunks: TtpStoryboardChunk[] = [];
    let segments: TtpStoryboardChunkSegment[] = [];
    let characterCount = 0;
    let entryIds = new Set<string>();

    const flush = (): void => {
        if (segments.length === 0) return;
        const chunkIndex = chunks.length;
        const normalizedSegments = segments.map((segment) => ({...segment}));
        chunks.push({
            chunkIndex,
            entryCount: entryIds.size,
            characterCount,
            segments: normalizedSegments,
            chunkHash: hashTextToImageContract({
                chunkIndex,
                segments: normalizedSegments.map((segment) => ({...segment})),
            }),
        });
        segments = [];
        characterCount = 0;
        entryIds = new Set<string>();
    };

    for (const entry of entries) {
        const sourceEntryId = entry.sourceIdentity.sourceEntryId;
        if (!entryIds.has(sourceEntryId) && entryIds.size >= TTP_STORYBOARD_CHUNK_LIMITS.maxEntriesPerChunk) flush();
        if (entry.content.length === 0) {
            segments.push({sourceEntryId, startOffset: 0, endOffset: 0, contentHash: sha256("")});
            entryIds.add(sourceEntryId);
            continue;
        }

        let startOffset = 0;
        while (startOffset < entry.content.length) {
            if (!entryIds.has(sourceEntryId) && entryIds.size >= TTP_STORYBOARD_CHUNK_LIMITS.maxEntriesPerChunk) flush();
            if (characterCount >= TTP_STORYBOARD_CHUNK_LIMITS.maxCharactersPerChunk) flush();
            const capacity = TTP_STORYBOARD_CHUNK_LIMITS.maxCharactersPerChunk - characterCount;
            let endOffset = Math.min(entry.content.length, startOffset + capacity);
            if (endOffset < entry.content.length && isHighSurrogate(entry.content.charCodeAt(endOffset - 1))) endOffset -= 1;
            if (endOffset === startOffset) {
                flush();
                continue;
            }
            const slice = entry.content.slice(startOffset, endOffset);
            segments.push({sourceEntryId, startOffset, endOffset, contentHash: sha256(slice)});
            entryIds.add(sourceEntryId);
            characterCount += slice.length;
            startOffset = endOffset;
            if (characterCount >= TTP_STORYBOARD_CHUNK_LIMITS.maxCharactersPerChunk) flush();
        }
    }
    flush();
    return chunks;
}

/** 将 string/string[] trigger 字段规范为去重、保序的文字数组。 */
function readStringList(value: TextToImageContractValue | undefined): string[] {
    const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
    const result: string[] = [];
    const seen = new Set<string>();
    for (const item of values) {
        if (typeof item !== "string" || !item.trim()) continue;
        const normalized = item.trim();
        if (seen.has(normalized)) continue;
        if (result.length >= 256) throw new Error("STORYBOARD_IMPORT_ENTRY_INVALID: trigger words 超过 256 条");
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}

/** 判断 UTF-16 code unit 是否为高 surrogate，避免 chunk offset 切断字符。 */
function isHighSurrogate(code: number): boolean {
    return code >= 0xd800 && code <= 0xdbff;
}

/** 为 entry/chunk 原文片段生成带前缀 hash，不持久化全文副本。 */
function sha256(value: string): string {
    return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
