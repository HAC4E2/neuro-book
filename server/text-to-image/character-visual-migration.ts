import path from "node:path";
import {
    parseTextToImageCharacterImageTags,
} from "nbook/app/utils/text-to-image-character-tags";
import {parseTextToImageOutfitTags} from "nbook/app/utils/text-to-image-outfit-tags";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    CHARACTER_IMAGE_TAG_FIELDS,
    CharacterImageTagsSchema,
    OUTFIT_TAG_FIELDS,
    OutfitTagsSchema,
    type CharacterImageTagField,
    type CharacterImageTags,
    type OutfitTagField,
    type OutfitTags,
} from "nbook/shared/text-to-image-character-visual";
import {PendingTagAtomSchema} from "nbook/shared/text-to-image-storyboard-import";
import {
    CHARACTER_VISUAL_MIGRATION_SCHEMA_VERSION,
    CharacterVisualMigrationCandidateSchema,
    type CharacterVisualMigrationCandidate,
    type CharacterVisualMigrationIssue,
    type CharacterVisualMigrationOutfit,
    type CharacterVisualPendingAtom,
} from "nbook/shared/text-to-image-character-migration";
import {
    SemanticTagResolutionSchema,
    type SemanticTagResolution,
} from "nbook/shared/text-to-image-tag-resolution";
import {TagPolicyApprovalSchema, type TagPolicyApproval} from "nbook/shared/text-to-image-tag-policy";
import {
    TagResolverPolicyApprovalSchema,
    type TagResolverPolicyApproval,
} from "nbook/shared/text-to-image-tag-resolver";
import {createTextToImageMarkdownFileHash} from "nbook/server/text-to-image/strict-frontmatter";

export type MaterializedCharacterVisual = {
    characterPath: string;
    character: CharacterImageTags;
    outfits: Array<{path: string; outfit: OutfitTags}>;
};

export type LegacyVisualGroupInput = {
    characterPath: string;
    characterMarkdown: string;
    outfits: Array<{path: string; markdown: string}>;
};

export type CharacterVisualDraftGroupInput = {
    source: CharacterVisualMigrationCandidate["source"];
    character: {
        path: string;
        targetBaseFileHash: string | null;
        characterId: string;
        names: {cn: string; aliasesCn: string[]; en: string};
        fields: Record<CharacterImageTagField, string>;
        outfitRefs: string[];
    };
    outfits: Array<{
        path: string;
        targetBaseFileHash: string | null;
        outfitId: string;
        ownerCharacterId: string;
        names: {cn: string; en: string};
        fields: Record<OutfitTagField, string>;
    }>;
    issues: CharacterVisualMigrationIssue[];
};

type MutableCandidate = {
    pendingAtoms: CharacterVisualPendingAtom[];
    issues: CharacterVisualMigrationIssue[];
};

/**
 * 把任一已严格收窄的视觉 source draft 转成统一 migration candidate。
 *
 * target base hash 可为空以表达 create-only；本函数只拆 atom/验证 owner/path，不读写 Project。
 */
export function inspectCharacterVisualDraftGroup(input: CharacterVisualDraftGroupInput): CharacterVisualMigrationCandidate {
    const characterPath = normalizeProjectPath(input.character.path);
    const characterDirectory = path.posix.dirname(characterPath);
    if (path.posix.basename(characterPath).toLocaleLowerCase() !== "image-tags.md"
        || !characterPath.startsWith("lorebook/character/")) {
        throw new Error("角色视觉迁移只接受 lorebook/character/**/image-tags.md");
    }
    const mutable: MutableCandidate = {
        pendingAtoms: [],
        issues: input.issues.map((issue) => ({...issue})),
    };
    const characterFields = emptyCharacterFields();
    for (const field of CHARACTER_IMAGE_TAG_FIELDS) {
        characterFields[field] = appendAtoms({
            mutable,
            ownerPath: characterPath,
            ownerKind: "character",
            field,
            value: input.character.fields[field],
        });
    }

    const expectedOutfitDirectory = `${characterDirectory}/outfits`;
    const outfits: CharacterVisualMigrationOutfit[] = input.outfits.map((draft) => {
        const outfitPath = normalizeProjectPath(draft.path);
        if (path.posix.dirname(outfitPath) !== expectedOutfitDirectory) {
            mutable.issues.push({
                code: "OUTFIT_PATH_MISMATCH",
                severity: "blocking",
                path: outfitPath,
                message: `服装必须位于 ${expectedOutfitDirectory}`,
            });
        }
        if (draft.ownerCharacterId !== input.character.characterId) {
            mutable.issues.push({
                code: "OUTFIT_OWNER_MISMATCH",
                severity: "blocking",
                path: outfitPath,
                message: `服装 owner ${draft.ownerCharacterId} 与角色 ${input.character.characterId} 不一致`,
            });
        }
        const fields = emptyOutfitFields();
        for (const field of OUTFIT_TAG_FIELDS) {
            fields[field] = appendAtoms({
                mutable,
                ownerPath: outfitPath,
                ownerKind: "outfit",
                field,
                value: draft.fields[field],
            });
        }
        return {
            path: outfitPath,
            targetBaseFileHash: draft.targetBaseFileHash,
            outfitId: draft.outfitId,
            ownerCharacterId: draft.ownerCharacterId,
            names: {...draft.names},
            fields,
        };
    }).sort((left, right) => compareText(left.path, right.path));

    const suppliedRefs = new Set(outfits.map((outfit) => `outfits/${path.posix.basename(outfit.path)}`));
    const outfitRefs = [...new Set(input.character.outfitRefs.map((outfitRef) => normalizeOutfitRef(characterDirectory, outfitRef)))]
        .sort(compareText);
    outfitRefs.forEach((outfitRef) => {
        if (!suppliedRefs.has(outfitRef)) {
            mutable.issues.push({
                code: "OUTFIT_REF_MISSING",
                severity: "blocking",
                path: `${characterDirectory}/${outfitRef}`,
                message: `角色引用的服装文件不存在：${characterDirectory}/${outfitRef}`,
            });
        }
    });
    suppliedRefs.forEach((outfitRef) => {
        if (!outfitRefs.includes(outfitRef)) outfitRefs.push(outfitRef);
    });
    outfitRefs.sort(compareText);

    const draftProjection = {
        source: input.source,
        character: {
            path: characterPath,
            targetBaseFileHash: input.character.targetBaseFileHash,
            characterId: input.character.characterId,
            names: {...input.character.names, aliasesCn: [...input.character.names.aliasesCn]},
            fields: Object.fromEntries(CHARACTER_IMAGE_TAG_FIELDS.map((field) => [field, input.character.fields[field]])),
            outfitRefs: [...outfitRefs],
        },
        outfits: input.outfits.map((outfit) => ({
            path: normalizeProjectPath(outfit.path),
            targetBaseFileHash: outfit.targetBaseFileHash,
            outfitId: outfit.outfitId,
            ownerCharacterId: outfit.ownerCharacterId,
            names: {...outfit.names},
            fields: Object.fromEntries(OUTFIT_TAG_FIELDS.map((field) => [field, outfit.fields[field]])),
        })).sort((left, right) => compareText(left.path, right.path)),
        issues: mutable.issues.map((issue) => ({...issue})),
    };
    const sourceSetHash = hashTextToImageContract(draftProjection);
    const migrationId = `character-migration-${sourceSetHash.slice("sha256:".length, "sha256:".length + 24)}`;
    return CharacterVisualMigrationCandidateSchema.parse({
        schemaVersion: CHARACTER_VISUAL_MIGRATION_SCHEMA_VERSION,
        migrationId,
        sourceSetHash,
        source: input.source,
        state: mutable.issues.length > 0 ? "blocked" : "pending_unresolved",
        character: {
            path: characterPath,
            targetBaseFileHash: input.character.targetBaseFileHash,
            characterId: input.character.characterId,
            names: input.character.names,
            fields: characterFields,
            outfitRefs,
        },
        outfits,
        pendingAtoms: mutable.pendingAtoms,
        issues: mutable.issues,
    });
}

/**
 * 把一个旧角色目录检查为纯 proposal。
 *
 * 该函数不访问 Tag index、不写文件，也不会把未知权重或宏解释成可执行语法。
 */
export function inspectLegacyCharacterVisualGroup(input: LegacyVisualGroupInput): CharacterVisualMigrationCandidate {
    return inspectCharacterVisualDraftGroup(createLegacyCharacterVisualDraftGroup(input));
}

/** 读取 legacy 文件为可与其它严格 source 合并的原始 draft，不拆 atom、不写文件。 */
export function createLegacyCharacterVisualDraftGroup(input: LegacyVisualGroupInput): CharacterVisualDraftGroupInput {
    const characterPath = normalizeProjectPath(input.characterPath);
    const characterDirectory = path.posix.dirname(characterPath);
    if (path.posix.basename(characterPath).toLocaleLowerCase() !== "image-tags.md"
        || !characterPath.startsWith("lorebook/character/")) {
        throw new Error("角色视觉迁移只接受 lorebook/character/**/image-tags.md");
    }
    const characterId = stablePathId(path.posix.basename(characterDirectory), "characterId");
    const legacyCharacter = parseTextToImageCharacterImageTags(input.characterMarkdown, {
        id: characterId,
        sourcePath: characterPath,
    });
    const names = splitCharacterNames(legacyCharacter.cnName, legacyCharacter.enName);
    const expectedOutfitDirectory = `${characterDirectory}/outfits`;
    const issues: CharacterVisualMigrationIssue[] = [];
    const parsedOutfits = input.outfits.map((source) => {
        const outfitPath = normalizeProjectPath(source.path);
        const parsed = parseTextToImageOutfitTags(source.markdown, {sourcePath: outfitPath});
        if (path.posix.dirname(outfitPath) !== expectedOutfitDirectory) {
            issues.push({
                code: "OUTFIT_PATH_MISMATCH",
                severity: "blocking",
                path: outfitPath,
                message: `服装必须位于 ${expectedOutfitDirectory}`,
            });
        }
        if (parsed.owner.trim() && ![names.cn, names.en, ...names.aliasesCn]
            .some((name) => sameIdentity(name, parsed.owner)) && !sameIdentity(characterId, parsed.owner)) {
            issues.push({
                code: "OUTFIT_OWNER_MISMATCH",
                severity: "blocking",
                path: outfitPath,
                message: `服装 owner ${parsed.owner} 与角色 ${characterId} 不一致`,
            });
        }
        return {
            path: outfitPath,
            targetBaseFileHash: createTextToImageMarkdownFileHash(source.markdown),
            outfitId: stablePathId(path.posix.basename(outfitPath, ".md"), "outfitId"),
            ownerCharacterId: characterId,
            names: {cn: parsed.nameCn.trim(), en: parsed.nameEn.trim()},
            fields: {
                upper: parsed.upper,
                upperBack: parsed.upperBack,
                lower: parsed.lower,
                lowerBack: parsed.lowerBack,
            },
        };
    }).sort((left, right) => compareText(left.path, right.path));
    const linkedRefs = legacyCharacter.outfits.map((outfit) => normalizeOutfitRef(characterDirectory, outfit.sourcePath));
    const validDiscoveredRefs = parsedOutfits
        .filter((outfit) => path.posix.dirname(outfit.path) === expectedOutfitDirectory)
        .map((outfit) => `outfits/${path.posix.basename(outfit.path)}`);
    const outfitRefs = [...new Set([...linkedRefs, ...validDiscoveredRefs])].sort(compareText);
    const sourceFiles = [
        {path: characterPath, hash: createTextToImageMarkdownFileHash(input.characterMarkdown)},
        ...input.outfits.map((outfit) => ({
            path: normalizeProjectPath(outfit.path),
            hash: createTextToImageMarkdownFileHash(outfit.markdown),
        })),
    ].sort((left, right) => compareText(left.path, right.path));
    return {
        source: {
            kind: "project_files",
            files: sourceFiles.map((source) => ({path: source.path, fileHash: source.hash})),
        },
        character: {
            path: characterPath,
            targetBaseFileHash: sourceFiles.find((source) => source.path === characterPath)!.hash,
            characterId,
            names,
            fields: {
                profileTraits: legacyCharacter.profileTraits,
                facialAppearance: legacyCharacter.facialAppearance,
                facialBack: legacyCharacter.facialBack,
                upperSfw: legacyCharacter.upperSfw,
                upperBackSfw: legacyCharacter.upperBackSfw,
                lowerSfw: legacyCharacter.lowerSfw,
                lowerBackSfw: legacyCharacter.lowerBackSfw,
                upperNsfw: legacyCharacter.upperNsfw,
                upperBackNsfw: legacyCharacter.upperBackNsfw,
                lowerNsfw: legacyCharacter.lowerNsfw,
                lowerBackNsfw: legacyCharacter.lowerBackNsfw,
                negativePrompt: legacyCharacter.negativePrompt,
            },
            outfitRefs,
        },
        outfits: parsedOutfits,
        issues,
    };
}

/** 在全部 atom 已有 terminal snapshot 后构造严格 V2 文件对象。 */
export function materializeCharacterVisualV2(input: {
    candidate: CharacterVisualMigrationCandidate;
    resolutions: Record<string, {terminal: SemanticTagResolution; reviewApproval: TagResolverPolicyApproval | null}>;
}): MaterializedCharacterVisual {
    const candidate = CharacterVisualMigrationCandidateSchema.parse(input.candidate);
    if (candidate.state === "blocked" || candidate.issues.length > 0) {
        throw new Error("blocking migration report 不能 materialize");
    }
    const expectedKeys = new Set(candidate.pendingAtoms.map((item) => item.resolutionKey));
    for (const key of Object.keys(input.resolutions)) {
        if (!expectedKeys.has(key)) throw new Error(`未知 terminal resolution：${key}`);
    }
    const parsedResolutions: Record<string, SemanticTagResolution> = {};
    const reviewApprovals: Record<string, TagResolverPolicyApproval | null> = {};
    for (const pending of candidate.pendingAtoms) {
        const entry = input.resolutions[pending.resolutionKey];
        if (!entry) throw new Error(`缺少 terminal resolution：${pending.resolutionKey}`);
        const parsed = SemanticTagResolutionSchema.parse(entry.terminal);
        if (parsed.sourceText !== pending.atom.sourceText || parsed.modelScope.kind !== "generic-novelai") {
            throw new Error(`terminal resolution 未绑定当前 generic atom：${pending.resolutionKey}`);
        }
        parsedResolutions[pending.resolutionKey] = parsed;
        reviewApprovals[pending.resolutionKey] = entry.reviewApproval === null
            ? null
            : TagResolverPolicyApprovalSchema.parse(entry.reviewApproval);
    }
    const character = CharacterImageTagsSchema.parse(buildCharacterV2(candidate, parsedResolutions, reviewApprovals));
    const outfits = candidate.outfits.map((source) => ({
        path: source.path,
        outfit: OutfitTagsSchema.parse(buildOutfitV2(candidate, source, parsedResolutions, reviewApprovals)),
    }));
    return {characterPath: candidate.character.path, character, outfits};
}

/** 将一个旧字段拆成普通 atom 或可证明的双括号权重 atom。 */
function appendAtoms<TField extends CharacterImageTagField | OutfitTagField>(input: {
    mutable: MutableCandidate;
    ownerPath: string;
    ownerKind: "character" | "outfit";
    field: TField;
    value: string;
}): string[] {
    const resolutionKeys: string[] = [];
    splitAtoms(input.value).forEach((rawAtom, index) => {
        const weighted = /^\(\(([^()]+)\)\)$/u.exec(rawAtom);
        const sourceText = (weighted?.[1] ?? rawAtom).trim();
        if (!weighted && hasUnknownSyntax(sourceText)) {
            input.mutable.issues.push({
                code: "UNKNOWN_PROVIDER_SYNTAX",
                severity: "blocking",
                path: `${input.ownerPath}#${input.field}[${index}]`,
                message: `未知宏或 Provider 语法必须人工处理：${sourceText}`,
            });
            return;
        }
        const resolutionKey = stableOwnerKey("tag", input.ownerPath, input.field, index, sourceText);
        const syntaxKey = weighted ? stableOwnerKey("syntax", input.ownerPath, input.field, index, sourceText) : null;
        const ownerSlot = input.ownerKind === "character"
            ? {kind: "character" as const, field: input.field as CharacterImageTagField}
            : {kind: "outfit" as const, field: input.field as OutfitTagField};
        input.mutable.pendingAtoms.push({
            resolutionKey,
            ownerPath: input.ownerPath,
            atom: PendingTagAtomSchema.parse({
                schemaVersion: "nbook.pending-tag-atom/v1",
                state: "unresolved",
                sourceText,
                sourcePath: `/${input.ownerKind}/${escapePointer(input.ownerPath)}/fields/${input.field}/${index}`,
                ownerSlot,
            }),
            syntaxKey,
            syntax: weighted ? {kind: "novelai-tag-weight", weight: 1.1} : null,
        });
        resolutionKeys.push(resolutionKey);
    });
    return resolutionKeys;
}

/** 构造角色文件并把每个 terminal/syntax 限定在当前文件。 */
function buildCharacterV2(
    candidate: CharacterVisualMigrationCandidate,
    resolutions: Record<string, SemanticTagResolution>,
    reviewApprovals: Record<string, TagResolverPolicyApproval | null>,
): CharacterImageTags {
    const owned = candidate.pendingAtoms.filter((item) => item.ownerPath === candidate.character.path);
    const syntax = buildSyntax(owned);
    return CharacterImageTagsSchema.parse({
        schema: "nbook.character-image-tags/v2",
        characterId: candidate.character.characterId,
        names: candidate.character.names,
        resolutionScope: {providerKind: "novelai", modelScope: {kind: "generic-novelai"}},
        fields: candidate.character.fields,
        outfitRefs: candidate.character.outfitRefs,
        fieldProviderSyntaxRefs: syntax.fieldRefs,
        providerSyntaxNodes: syntax.nodes,
        tagResolutions: selectResolutions(owned, resolutions),
        policyApprovals: buildPolicyApprovals(owned, resolutions, reviewApprovals, `character:${candidate.character.characterId}`),
    });
}

/** 构造单个服装文件并把每个 terminal/syntax 限定在当前文件。 */
function buildOutfitV2(
    candidate: CharacterVisualMigrationCandidate,
    source: CharacterVisualMigrationOutfit,
    resolutions: Record<string, SemanticTagResolution>,
    reviewApprovals: Record<string, TagResolverPolicyApproval | null>,
): OutfitTags {
    const owned = candidate.pendingAtoms.filter((item) => item.ownerPath === source.path);
    const syntax = buildSyntax(owned);
    return OutfitTagsSchema.parse({
        schema: "nbook.outfit-tags/v2",
        outfitId: source.outfitId,
        ownerCharacterId: source.ownerCharacterId,
        names: source.names,
        resolutionScope: {providerKind: "novelai", modelScope: {kind: "generic-novelai"}},
        fields: source.fields,
        fieldProviderSyntaxRefs: syntax.fieldRefs,
        providerSyntaxNodes: syntax.nodes,
        tagResolutions: selectResolutions(owned, resolutions),
        policyApprovals: buildPolicyApprovals(owned, resolutions, reviewApprovals, `outfit:${source.ownerCharacterId}/${source.outfitId}`),
    });
}

/** 从 pending 权重 proposal 构造同文件 field refs 与 typed nodes。 */
function buildSyntax(items: CharacterVisualPendingAtom[]): {
    fieldRefs: Partial<Record<CharacterImageTagField | OutfitTagField, string[]>>;
    nodes: Record<string, {kind: "novelai-tag-weight"; weight: number; resolutionKeys: string[]}>;
} {
    const fieldRefs: Partial<Record<CharacterImageTagField | OutfitTagField, string[]>> = {};
    const nodes: Record<string, {kind: "novelai-tag-weight"; weight: number; resolutionKeys: string[]}> = {};
    for (const item of items) {
        if (!item.syntax || !item.syntaxKey) continue;
        const field = item.atom.ownerSlot.field as CharacterImageTagField | OutfitTagField;
        (fieldRefs[field] ??= []).push(item.syntaxKey);
        nodes[item.syntaxKey] = {...item.syntax, resolutionKeys: [item.resolutionKey]};
    }
    return {fieldRefs, nodes};
}

/** 只选择属于当前文件的 resolution snapshots。 */
function selectResolutions(
    items: CharacterVisualPendingAtom[],
    resolutions: Record<string, SemanticTagResolution>,
): Record<string, SemanticTagResolution> {
    return Object.fromEntries(items.map((item) => [item.resolutionKey, resolutions[item.resolutionKey]!]));
}

/** 把 migration review grant 绑定为随 owner Markdown 持久化的长期批准证据。 */
function buildPolicyApprovals(
    items: CharacterVisualPendingAtom[],
    resolutions: Record<string, SemanticTagResolution>,
    reviewApprovals: Record<string, TagResolverPolicyApproval | null>,
    ownerIdentity: string,
): Record<string, TagPolicyApproval> {
    const approvals: Record<string, TagPolicyApproval> = {};
    for (const item of items) {
        const grant = reviewApprovals[item.resolutionKey];
        if (!grant) continue;
        const resolution = resolutions[item.resolutionKey];
        if (!resolution) throw new Error(`approval 缺少 terminal resolution：${item.resolutionKey}`);
        approvals[item.resolutionKey] = TagPolicyApprovalSchema.parse({
            schemaVersion: "nbook.tag-policy-approval/v1",
            ...grant,
            resolutionKey: item.resolutionKey,
            ownerIdentity,
            ownerSlot: `${item.atom.ownerSlot.kind}:${item.atom.ownerSlot.field}`,
            sourcePath: item.atom.sourcePath,
            sourceTextHash: hashTextToImageContract({sourceText: resolution.sourceText}),
        });
    }
    return approvals;
}

/** 拆分旧字段中的逗号、全角逗号或换行分隔项。 */
function splitAtoms(value: string): string[] {
    return value.split(/[,，\n]/u).map((item) => item.trim()).filter(Boolean);
}

/** 双括号以外的控制定界符全部 report-only。 */
function hasUnknownSyntax(value: string): boolean {
    return /[{}[\]<>`$]|::|\{%|%\}|\$\{/u.test(value);
}

/** 从旧中文名称的 `|` 结构恢复主名与别名。 */
function splitCharacterNames(cnName: string, enName: string): {cn: string; aliasesCn: string[]; en: string} {
    const names = cnName.split(/[|｜]/u).map((item) => item.trim()).filter(Boolean);
    return {cn: names[0] ?? "", aliasesCn: names.slice(1), en: enName.trim()};
}

/** 规范 Project-relative 文件路径。 */
function normalizeProjectPath(value: string): string {
    const normalized = value.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
    if (!normalized || normalized.includes("..") || /^[A-Za-z]+:/u.test(normalized)) {
        throw new Error(`非法 Project-relative path：${value}`);
    }
    return normalized;
}

/** 把角色链接转换为同目录 outfit ref。 */
function normalizeOutfitRef(characterDirectory: string, sourcePath: string): string {
    const normalized = normalizeProjectPath(sourcePath);
    const relative = normalized.startsWith(`${characterDirectory}/`)
        ? normalized.slice(characterDirectory.length + 1)
        : normalized;
    if (!/^outfits\/[^/]+\.md$/iu.test(relative)) {
        throw new Error(`非法 outfit ref：${sourcePath}`);
    }
    return relative;
}

/** 目录 identity 允许 Unicode，但拒绝 Windows/URL/path 控制字符。 */
function stablePathId(value: string, label: string): string {
    const id = value.trim();
    if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,159}$/u.test(id)) throw new Error(`${label} 不是稳定 ID：${value}`);
    return id;
}

/** 由 owner/path/slot/index/source 产生重复扫描稳定的局部 key。 */
function stableOwnerKey(prefix: "tag" | "syntax", ownerPath: string, field: string, index: number, sourceText: string): string {
    const hash = hashTextToImageContract({ownerPath, field, index, sourceText});
    return `${prefix}-${hash.slice("sha256:".length, "sha256:".length + 24)}`;
}

/** JSON Pointer segment escaping。 */
function escapePointer(value: string): string {
    return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** 旧 owner 仅做规范化 identity equality，不做模糊猜测。 */
function sameIdentity(left: string, right: string): boolean {
    const normalize = (value: string) => value.trim().normalize("NFKC").replace(/[\s_.-]+/gu, "").toLocaleLowerCase();
    return Boolean(normalize(left)) && normalize(left) === normalize(right);
}

/** 创建完整角色固定字段。 */
function emptyCharacterFields(): Record<CharacterImageTagField, string[]> {
    return {
        profileTraits: [],
        facialAppearance: [],
        facialBack: [],
        upperSfw: [],
        upperBackSfw: [],
        lowerSfw: [],
        lowerBackSfw: [],
        upperNsfw: [],
        upperBackNsfw: [],
        lowerNsfw: [],
        lowerBackNsfw: [],
        negativePrompt: [],
    };
}

/** 创建完整服装固定字段。 */
function emptyOutfitFields(): Record<OutfitTagField, string[]> {
    return {upper: [], upperBack: [], lower: [], lowerBack: []};
}

/** locale-independent code point 顺序。 */
function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
