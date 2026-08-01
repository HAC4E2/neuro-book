import {
    canonicalizeCharacterImageTags,
    canonicalizeOutfitTags,
    CharacterImageTagsSchema,
    CHARACTER_IMAGE_TAG_FIELDS,
    OUTFIT_TAG_FIELDS,
    OutfitTagsSchema,
    VisualStableIdSchema,
    type CharacterImageTagField,
    type CharacterImageTags,
    type OutfitTagField,
    type OutfitTags,
} from "nbook/shared/text-to-image-character-visual";
import {
    CharacterVisualDirectorOutputSchema,
    type CharacterVisualDirectorOutput,
    type CharacterVisualDirectWriteDiagnostic,
} from "nbook/shared/text-to-image-character-direct-write";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {sanitizeProviderPassthrough, type SemanticTagResolution} from "nbook/shared/text-to-image-tag-resolution";
import {TagResolverExplicitResultSchema, type TagResolverExplicitResult} from "nbook/shared/text-to-image-tag-resolver";
import {
    parseCharacterImageTagsMarkdown,
    parseOutfitTagsMarkdown,
    renderCharacterImageTagsMarkdown,
    renderOutfitTagsMarkdown,
} from "nbook/server/text-to-image/character-visual.codec";

/** 传递给显式 Tag Resolver 的单个原子 tag；owner/field 只用于固定持久化归属。 */
export type DirectVisualTagInput = {
    runId: string;
    contextId: string;
    resolutionId: string;
    sourceText: string;
    modelScope: {kind: "generic-novelai"};
    approval: null;
    owner: string;
    field: CharacterImageTagField | OutfitTagField;
    index: number;
};

/** 显式 Tag Resolver 的终态、待审核或阻断结果。 */
export type DirectVisualTagResolution = TagResolverExplicitResult;

type MaterializationErrorCode = "CHARACTER_VISUAL_POLICY_BLOCKED" | "CHARACTER_VISUAL_OUTFIT_NAME_INVALID" | "CHARACTER_VISUAL_OUTFIT_CONFLICT";

/** 供 direct-write service 映射为冻结 HTTP 错误码的可预期 materialization 失败。 */
export class CharacterVisualMaterializationError extends Error {
    readonly code: MaterializationErrorCode;

    constructor(code: MaterializationErrorCode, message: string) {
        super(`${code}: ${message}`);
        this.name = "CharacterVisualMaterializationError";
        this.code = code;
    }
}

/**
 * 将导演输出的服装显示名收敛成单一文件 stem。
 * 中文非空时始终优先；英文只在中文为空时使用，并把空白规范为连字符。
 */
export function normalizeOutfitFileStem(names: {cn: string; en: string}): string {
    const raw = (names.cn.trim() ? names.cn : names.en).normalize("NFKC");
    if (!raw || raw.endsWith(".") || raw.endsWith(" ") || /[/\\:*?"<>|\u0000-\u001f\u007f]/u.test(raw)) {
        throw invalidOutfitName(names);
    }
    const stem = names.cn.trim() ? raw.trim() : raw.trim().replace(/\s+/gu, "-");
    const deviceName = stem.split(".", 1)[0]?.toUpperCase();
    if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(deviceName ?? "") || !VisualStableIdSchema.safeParse(stem).success) {
        throw invalidOutfitName(names);
    }
    return stem;
}

/**
 * 严格 materialize 导演草稿：所有 atom 都先通过显式 Resolver，再构造可 round-trip 的 V2 文档。
 * 本函数没有写文件副作用，direct-write journal 在验证全部成功后才负责落盘。
 */
export async function materializeCharacterVisualDirect(input: {
    runId: string;
    characterId: string;
    existingCharacter: CharacterImageTags | null;
    existingOutfits: Array<{path: string; outfit: OutfitTags}>;
    output: CharacterVisualDirectorOutput;
    resolveTag(input: DirectVisualTagInput): Promise<DirectVisualTagResolution>;
}): Promise<{
    character: CharacterImageTags;
    outfits: Array<{path: string; outfit: OutfitTags}>;
    diagnostics: CharacterVisualDirectWriteDiagnostic[];
}> {
    const output = CharacterVisualDirectorOutputSchema.parse(input.output);
    const characterId = VisualStableIdSchema.parse(input.characterId);
    if (output.state !== "completed" || output.character === null) {
        throw new CharacterVisualMaterializationError("CHARACTER_VISUAL_POLICY_BLOCKED", "只有 completed director 输出可以 materialize");
    }
    if (input.existingCharacter !== null && CharacterImageTagsSchema.parse(input.existingCharacter).characterId !== characterId) {
        throw new CharacterVisualMaterializationError("CHARACTER_VISUAL_OUTFIT_CONFLICT", "既有角色文档与当前 characterId 不一致");
    }

    const characterDirectory = `lorebook/character/${characterId}`;
    const diagnostics: CharacterVisualDirectWriteDiagnostic[] = [];
    const existing = new Map<string, {path: string; outfit: OutfitTags}>();
    for (const item of input.existingOutfits) {
        const outfit = canonicalizeOutfitTags(OutfitTagsSchema.parse(item.outfit));
        const expectedPath = `${characterDirectory}/outfits/${outfit.outfitId}.md`;
        if (outfit.ownerCharacterId !== characterId || item.path !== expectedPath || existing.has(item.path)) {
            throw new CharacterVisualMaterializationError("CHARACTER_VISUAL_OUTFIT_CONFLICT", `既有服装路径不唯一或不匹配：${item.path}`);
        }
        existing.set(item.path, {path: item.path, outfit});
    }

    const nextOutfits = new Map(existing);
    const newRefs = new Set<string>();
    for (const draft of output.outfits) {
        const stem = normalizeOutfitFileStem(draft.names);
        const path = `${characterDirectory}/outfits/${stem}.md`;
        const outfitRef = `outfits/${stem}.md`;
        const outfitId = stem;
        if (newRefs.has(outfitRef)) {
            throw new CharacterVisualMaterializationError("CHARACTER_VISUAL_OUTFIT_CONFLICT", `重复服装名称：${stem}`);
        }
        newRefs.add(outfitRef);
        const previous = existing.get(path);
        if (previous && previous.outfit.ownerCharacterId !== characterId) {
            throw new CharacterVisualMaterializationError("CHARACTER_VISUAL_OUTFIT_CONFLICT", `服装 stem 已属于其他角色：${stem}`);
        }
        const owner = `outfit:${characterId}/${outfitId}`;
        const built = await materializeFields({
            runId: input.runId,
            characterId,
            owner,
            fields: OUTFIT_TAG_FIELDS,
            rawFields: draft.fields,
            resolveTag: input.resolveTag,
            diagnostics,
        });
        nextOutfits.set(path, {
            path,
            outfit: canonicalizeOutfitTags(OutfitTagsSchema.parse({
                schema: "nbook.outfit-tags/v2",
                outfitId,
                ownerCharacterId: characterId,
                names: draft.names,
                resolutionScope: {providerKind: "novelai", modelScope: {kind: "generic-novelai"}},
                fields: built.fields,
                fieldProviderSyntaxRefs: {},
                providerSyntaxNodes: {},
                tagResolutions: built.tagResolutions,
                policyApprovals: {},
            })),
        });
    }

    const characterFields = await materializeFields({
        runId: input.runId,
        characterId,
        owner: `character:${characterId}`,
        fields: CHARACTER_IMAGE_TAG_FIELDS,
        rawFields: output.character.fields,
        resolveTag: input.resolveTag,
        diagnostics,
    });
    const outfits = [...nextOutfits.values()].sort((left, right) => compareText(left.path, right.path));
    const character = canonicalizeCharacterImageTags(CharacterImageTagsSchema.parse({
        schema: "nbook.character-image-tags/v2",
        characterId,
        names: {cn: output.character.names.cn, aliasesCn: [], en: output.character.names.en},
        resolutionScope: {providerKind: "novelai", modelScope: {kind: "generic-novelai"}},
        fields: characterFields.fields,
        outfitRefs: outfits.map((item) => `outfits/${item.outfit.outfitId}.md`),
        fieldProviderSyntaxRefs: {},
        providerSyntaxNodes: {},
        tagResolutions: characterFields.tagResolutions,
        policyApprovals: {},
    }));
    assertRoundTrip(character, outfits);
    return {character, outfits, diagnostics};
}

/** 逐字段解析逗号分隔原子，绝不截断或在文档间共享 resolution ownership。 */
async function materializeFields<TField extends CharacterImageTagField | OutfitTagField>(input: {
    runId: string;
    characterId: string;
    owner: string;
    fields: readonly TField[];
    rawFields: Record<TField, string>;
    resolveTag(input: DirectVisualTagInput): Promise<DirectVisualTagResolution>;
    diagnostics: CharacterVisualDirectWriteDiagnostic[];
}): Promise<{fields: Record<TField, string[]>; tagResolutions: Record<string, SemanticTagResolution>}> {
    const fields = {} as Record<TField, string[]>;
    const tagResolutions: Record<string, SemanticTagResolution> = {};
    const contextId = stableResolverId("character", input.characterId);
    for (const field of input.fields) {
        const atoms = splitAtoms(input.rawFields[field]);
        if (atoms.length > 20) {
            throw new CharacterVisualMaterializationError("CHARACTER_VISUAL_POLICY_BLOCKED", `${input.owner}.${field} 超过 20 个 tag`);
        }
        const seen = new Set<string>();
        fields[field] = [];
        for (const [index, sourceText] of atoms.entries()) {
            if (seen.has(sourceText)) {
                throw new CharacterVisualMaterializationError("CHARACTER_VISUAL_POLICY_BLOCKED", `${input.owner}.${field} 存在重复 tag：${sourceText}`);
            }
            seen.add(sourceText);
            try {
                sanitizeProviderPassthrough(sourceText);
            } catch (error) {
                const message = error instanceof Error ? error.message : "tag 语法无效";
                throw new CharacterVisualMaterializationError("CHARACTER_VISUAL_POLICY_BLOCKED", `${input.owner}.${field}：${message}`);
            }
            const resolutionId = stableResolverId("tag", `${input.owner}:${field}:${index}:${sourceText}`);
            const request: DirectVisualTagInput = {
                runId: input.runId,
                contextId,
                resolutionId,
                sourceText,
                modelScope: {kind: "generic-novelai"},
                approval: null,
                owner: input.owner,
                field,
                index,
            };
            const result = TagResolverExplicitResultSchema.parse(await input.resolveTag(request));
            if (result.state === "blocked") {
                throw new CharacterVisualMaterializationError("CHARACTER_VISUAL_POLICY_BLOCKED", `${input.owner}.${field}：${result.code}`);
            }
            if (result.state === "review_required") {
                input.diagnostics.push({
                    code: "TAG_REVIEW_EXCLUDED",
                    owner: input.owner,
                    field,
                    sourceText,
                    message: "该 tag 需要人工批准，未写入角色视觉文档",
                });
                continue;
            }
            if (result.reviewApproval !== null) {
                throw new CharacterVisualMaterializationError("CHARACTER_VISUAL_POLICY_BLOCKED", `${input.owner}.${field} 返回了不允许的 policy 终态`);
            }
            const run = result.run;
            if (run.state !== "terminal_canonical" && run.state !== "terminal_replacement" && run.state !== "terminal_passthrough") {
                throw new CharacterVisualMaterializationError("CHARACTER_VISUAL_POLICY_BLOCKED", `${input.owner}.${field} 返回了非终态 resolution`);
            }
            if (run.runId !== request.runId
                || run.contextId !== request.contextId
                || run.resolutionId !== request.resolutionId
                || run.sourceText !== request.sourceText
                || hashTextToImageContract(run.modelScope) !== hashTextToImageContract(request.modelScope)) {
                throw new CharacterVisualMaterializationError("CHARACTER_VISUAL_POLICY_BLOCKED", `${input.owner}.${field} 的 Resolver terminal envelope 已失效`);
            }
            const terminal = run.terminal;
            if (terminal.sourceText !== sourceText || terminal.modelScope.kind !== "generic-novelai") {
                throw new CharacterVisualMaterializationError("CHARACTER_VISUAL_POLICY_BLOCKED", `${input.owner}.${field} 的终态证据不属于当前 atom`);
            }
            tagResolutions[resolutionId] = terminal;
            fields[field].push(resolutionId);
        }
    }
    return {fields, tagResolutions};
}

/** 严格逗号语义：空字段可为空，任何显式空 atom 一律拒绝。 */
function splitAtoms(value: string): string[] {
    if (!value.trim()) return [];
    const atoms = value.split(",").map((item) => item.trim());
    if (atoms.some((item) => !item)) {
        throw new CharacterVisualMaterializationError("CHARACTER_VISUAL_POLICY_BLOCKED", "tag 列表不能包含空 atom");
    }
    return atoms;
}

/** 用 hash 收敛为 Resolver 可接受的 ASCII stable ID，同时避免中文 owner 泄漏到 resolver 边界。 */
function stableResolverId(prefix: "character" | "tag", identity: string): string {
    return `${prefix}-${hashTextToImageContract({identity}).slice("sha256:".length, "sha256:".length + 24)}`;
}

/** 每份即将写入或保留的文档必须经历 renderer/parser 闭环。 */
function assertRoundTrip(character: CharacterImageTags, outfits: Array<{path: string; outfit: OutfitTags}>): void {
    const canonicalCharacter = canonicalizeCharacterImageTags(character);
    const renderedCharacter = renderCharacterImageTagsMarkdown(canonicalCharacter);
    const parsedCharacter = parseCharacterImageTagsMarkdown(renderedCharacter).character;
    if (hashTextToImageContract(parsedCharacter) !== hashTextToImageContract(canonicalCharacter)) {
        throw new Error("角色视觉文档 round-trip 不一致");
    }
    for (const item of outfits) {
        const canonicalOutfit = canonicalizeOutfitTags(item.outfit);
        const renderedOutfit = renderOutfitTagsMarkdown(canonicalOutfit);
        const parsedOutfit = parseOutfitTagsMarkdown(renderedOutfit).outfit;
        if (hashTextToImageContract(parsedOutfit) !== hashTextToImageContract(canonicalOutfit)) {
            throw new Error(`服装视觉文档 round-trip 不一致：${item.path}`);
        }
    }
}

function invalidOutfitName(names: {cn: string; en: string}): CharacterVisualMaterializationError {
    return new CharacterVisualMaterializationError("CHARACTER_VISUAL_OUTFIT_NAME_INVALID", `无法生成稳定服装文件名：${names.cn || names.en}`);
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
