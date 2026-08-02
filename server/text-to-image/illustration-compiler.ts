import {z} from "zod";
import {
    createCharacterImageTagHashes,
    createOutfitTagHashes,
    CharacterImageTagFieldSchema,
    CharacterImageTagsSchema,
    OutfitTagFieldSchema,
    OutfitTagsSchema,
    type CharacterImageTagField,
    type OutfitTagField,
    type ProviderSyntaxNode,
} from "nbook/shared/text-to-image-character-visual";
import {ChapterIllustrationShotSchema, type ChapterIllustrationShot} from "nbook/shared/text-to-image-chapter-storyboard";
import {createIllustrationRecipePlanningConstraints} from "nbook/shared/text-to-image-illustration-planning";
import {
    createFrozenReferenceSnapshotHash,
    createIllustrationCompiledRequestHash,
    createIllustrationExecutionInputHash,
    createIllustrationExecutionManifestHash,
    IllustrationCompiledRequestSchema,
    IllustrationExecutionProviderSchema,
    IllustrationExecutionSourceSchema,
    type IllustrationCompiledRequest,
} from "nbook/shared/text-to-image-execution";
import {
    NovelAiProviderModelIdSchema,
    preflightNovelAiCapabilities,
    PROVIDER_GRAMMAR_REGISTRY,
    ProviderCapabilitySnapshotSchema,
    type ProviderCapabilitySnapshot,
} from "nbook/shared/text-to-image-provider-registry";
import {novelAiQualityTags, resolveNovelAiNegativePreset} from "nbook/shared/text-to-image-novelai-quality";
import {
    splitTextToImageRecipeStyleAtoms,
    getActiveTextToImageRecipeStyle,
    TextToImageRecipeSnapshotSchema,
    type TextToImageRecipeSnapshot,
} from "nbook/shared/text-to-image-recipe";
import {
    createTagPatternRenderHash,
    TagPatternSchema,
    type TagPattern,
} from "nbook/shared/text-to-image-tag-pattern";
import {TagPolicyApprovalSchema, type TagPolicyApproval} from "nbook/shared/text-to-image-tag-policy";
import {
    createSemanticTagResolutionHash,
    SemanticTagResolutionSchema,
    TextToImageContractHashSchema,
    type SemanticTagResolution,
} from "nbook/shared/text-to-image-tag-resolution";
import type {CharacterVisualRegistrySnapshot} from "nbook/server/text-to-image/character-visual-registry.service";
import type {NovelAiProviderModelId} from "nbook/shared/text-to-image-provider-registry";
import type {
    FrozenReferenceAsset,
    TextToImageReferenceAssetDto,
    TextToImageReferenceSelection,
} from "nbook/shared/text-to-image-reference-asset";

export const ILLUSTRATION_COMPILER_VERSION = "route-b-compiler-v1" as const;
export const ILLUSTRATION_EXECUTION_POLICY_VERSION = "route-b-execution-v1" as const;

const IllustrationPlanningFactsSchema = z.object({
    effectivePresetSemanticHash: TextToImageContractHashSchema,
    effectivePatternPlanningHash: TextToImageContractHashSchema,
    visualPlanningFactsHash: TextToImageContractHashSchema,
    recipePlanningConstraintsHash: TextToImageContractHashSchema,
}).strict();

export type IllustrationResolvedStyleTag = {
    resolution: SemanticTagResolution;
    policyApproval: TagPolicyApproval | null;
};

export type IllustrationResolutionValidator = {
    /** 把 owner Markdown 中的 generic snapshots 按当前 Recipe model/Policy/Index 复验并派生为执行 snapshots。 */
    revalidate(input: {
        contextId: string;
        targetScope: {kind: "novelai-model"; modelId: string};
        resolutions: SemanticTagResolution[];
        policyApprovals: Array<TagPolicyApproval | null>;
    }): Promise<{validationHash: string; resolutions: SemanticTagResolution[]}>;
};

export type IllustrationCompileInput = {
    source: z.input<typeof IllustrationExecutionSourceSchema>;
    publicationJournalId: string;
    planningFacts: z.input<typeof IllustrationPlanningFactsSchema>;
    shot: ChapterIllustrationShot;
    effectivePatterns: {presetSemanticHash: string; planningHash: string; patterns: TagPattern[]};
    characters: CharacterVisualRegistrySnapshot;
    recipeSnapshot: TextToImageRecipeSnapshot;
    recipeStyle: {
        positivePrefix: IllustrationResolvedStyleTag[];
        positiveSuffix: IllustrationResolvedStyleTag[];
        negativePrefix: IllustrationResolvedStyleTag[];
        negativeSuffix: IllustrationResolvedStyleTag[];
    };
    provider: z.input<typeof IllustrationExecutionProviderSchema>;
    capabilitySnapshot: ProviderCapabilitySnapshot;
    /** P5：参考资产存在性校验器；有非空引用时必须提供，返回 contentHash → DTO 映射。 */
    referenceAssetVerifier?: (contentHashes: string[]) => Promise<Map<string, TextToImageReferenceAssetDto>>;
    executionNonce: string;
    variantIndex: number;
    outputIndex: number;
    outputCount: number;
    seed: number;
};

export type IllustrationCompileResult = {
    request: IllustrationCompiledRequest;
    executionInputHash: string;
    compiledRequestHash: string;
    executionManifestHash: string;
};

export type IllustrationCompileErrorCode =
    | "ILLUSTRATION_SHOT_STALE"
    | "REFERENCE_ASSET_UNVERIFIED"
    | "REFERENCE_ASSET_NOT_FOUND"
    | "REFERENCE_ASSET_TAMPERED"
    | "REFERENCE_ASSET_INPAINT_NOT_PNG"
    | "REFERENCE_ASSET_INPAINT_DIMENSIONS_MISMATCH"
    | "ILLUSTRATION_PATTERN_INVALID"
    | "CHARACTER_VISUAL_TAGS_UNRESOLVED"
    | "TEXT_TO_IMAGE_RECIPE_INVALID"
    | "TAG_RESOLUTION_INVALID"
    | "ILLUSTRATION_COMPILE_CONFLICT";

/** Compiler 的稳定 blocking error；调用方不得在该错误后创建 Manifest/Job。 */
export class IllustrationCompileError extends Error {
    constructor(readonly code: IllustrationCompileErrorCode, message: string) {
        super(`${code}: ${message}`);
        this.name = "IllustrationCompileError";
    }
}

type TokenSource = {
    kind: "pattern" | "shot-prefer" | "shot-avoid" | "character" | "outfit" | "recipe-style";
    sourceId: string;
};

type PendingToken = {
    resolution: SemanticTagResolution;
    policyApproval: TagPolicyApproval | null;
    weight: number;
    mandatory: boolean;
    source: TokenSource;
};

type CompiledToken = {
    wireText: string;
    semanticText: string;
    resolutionHashes: string[];
    weight: number;
    mandatory: boolean;
    sources: TokenSource[];
};

type PendingChannels = {
    positive: PendingToken[];
    negative: PendingToken[];
    characters: Map<string, {positive: PendingToken[]; negative: PendingToken[]}>;
};

/** Pattern/角色/Recipe 的唯一确定性编译入口；validation 之外没有 I/O。 */
export async function compileIllustration(
    rawInput: IllustrationCompileInput,
    dependencies: {resolutionValidator: IllustrationResolutionValidator},
): Promise<IllustrationCompileResult> {
    const source = IllustrationExecutionSourceSchema.parse(rawInput.source);
    const provider = IllustrationExecutionProviderSchema.parse(rawInput.provider);
    const shot = ChapterIllustrationShotSchema.parse(rawInput.shot);
    const recipeSnapshot = TextToImageRecipeSnapshotSchema.parse(rawInput.recipeSnapshot);
    const capabilitySnapshot = ProviderCapabilitySnapshotSchema.parse(rawInput.capabilitySnapshot);
    const planningFacts = IllustrationPlanningFactsSchema.parse(rawInput.planningFacts);
    const effectivePresetSemanticHash = TextToImageContractHashSchema.parse(rawInput.effectivePatterns.presetSemanticHash);
    const effectivePatternPlanningHash = TextToImageContractHashSchema.parse(rawInput.effectivePatterns.planningHash);
    const visualPlanningFactsHash = TextToImageContractHashSchema.parse(rawInput.characters.visualPlanningFactsHash);
    const publicationJournalId = parseStableId(rawInput.publicationJournalId, "publicationJournalId");
    const executionNonce = parseStableId(rawInput.executionNonce, "executionNonce");
    const variantIndex = z.number().int().min(0).max(31).parse(rawInput.variantIndex);
    const outputIndex = z.number().int().min(0).max(31).parse(rawInput.outputIndex);
    const outputCount = z.number().int().min(1).max(32).parse(rawInput.outputCount);
    const seed = z.number().int().min(0).max(4_294_967_295).parse(rawInput.seed);

    assertSourceIdentity(source, shot, publicationJournalId);
    if (planningFacts.effectivePresetSemanticHash !== effectivePresetSemanticHash
        || planningFacts.effectivePatternPlanningHash !== effectivePatternPlanningHash
        || planningFacts.visualPlanningFactsHash !== visualPlanningFactsHash
        || planningFacts.recipePlanningConstraintsHash !== createIllustrationRecipePlanningConstraints(recipeSnapshot).constraintsHash) {
        throw new IllustrationCompileError("ILLUSTRATION_SHOT_STALE", "规划域事实已漂移，必须重新规划 Shot Intent");
    }

    const parsedModel = NovelAiProviderModelIdSchema.safeParse(
        getActiveTextToImageRecipeStyle(recipeSnapshot).useFurryDataset ? "nai-diffusion-furry-3" : recipeSnapshot.model,
    );
    if (!parsedModel.success) {
        throw new IllustrationCompileError("TEXT_TO_IMAGE_RECIPE_INVALID", `Recipe model 未注册：${recipeSnapshot.model}`);
    }
    const effectiveModel = parsedModel.data;
    if (capabilitySnapshot.modelScope.kind !== "novelai-model"
        || capabilitySnapshot.modelScope.modelId !== effectiveModel
        || !capabilitySnapshot.supportedModelIds.includes(effectiveModel)) {
        throw new IllustrationCompileError("TEXT_TO_IMAGE_RECIPE_INVALID", "Recipe model 与 Provider capability snapshot 不一致");
    }

    const style = parseRecipeStyle(rawInput.recipeStyle, recipeSnapshot);
    const patterns = selectPatterns(rawInput.effectivePatterns.patterns, shot.tagPatternRefs);
    const selectedCharacters = selectCharacters(rawInput.characters, shot);
    const channels: PendingChannels = {positive: [], negative: [], characters: new Map()};

    channels.positive.push(...style.positivePrefix);
    channels.negative.push(...style.negativePrefix);
    for (const pattern of patterns) addPatternTokens(channels, pattern);
    addShotTokens(channels, shot);
    for (const selected of selectedCharacters) addCharacterTokens(channels, selected, shot.composition.shotSize, patterns);
    channels.positive.push(...style.positiveSuffix);
    channels.negative.push(...style.negativeSuffix);

    const pending = flattenChannels(channels);
    const validation = await dependencies.resolutionValidator.revalidate({
        contextId: source.projectId,
        targetScope: {kind: "novelai-model", modelId: effectiveModel},
        resolutions: pending.map((token) => token.resolution),
        policyApprovals: pending.map((token) => token.policyApproval),
    });
    const validationHash = TextToImageContractHashSchema.parse(validation.validationHash);
    if (validation.resolutions.length !== pending.length) {
        throw new IllustrationCompileError("TAG_RESOLUTION_INVALID", "终态复验返回数量与 owner snapshots 不一致");
    }
    const modelResolutions = validation.resolutions.map((resolution, index) => {
        const parsed = SemanticTagResolutionSchema.parse(resolution);
        if (parsed.sourceText !== pending[index]?.resolution.sourceText
            || parsed.modelScope.kind !== "novelai-model"
            || parsed.modelScope.modelId !== effectiveModel) {
            throw new IllustrationCompileError("TAG_RESOLUTION_INVALID", "终态复验未返回当前 Recipe model 的同源 snapshot");
        }
        return parsed;
    });

    let resolutionIndex = 0;
    const positive = compileChannel(channels.positive, modelResolutions.slice(resolutionIndex, resolutionIndex += channels.positive.length));
    const negative = compileChannel(channels.negative, modelResolutions.slice(resolutionIndex, resolutionIndex += channels.negative.length));
    const compiledCharacters = new Map<string, {positive: CompiledToken[]; negative: CompiledToken[]}>();
    for (const [characterId, characterChannels] of channels.characters) {
        const characterPositive = compileChannel(
            characterChannels.positive,
            modelResolutions.slice(resolutionIndex, resolutionIndex += characterChannels.positive.length),
        );
        const characterNegative = compileChannel(
            characterChannels.negative,
            modelResolutions.slice(resolutionIndex, resolutionIndex += characterChannels.negative.length),
        );
        compiledCharacters.set(characterId, {positive: characterPositive, negative: characterNegative});
    }

    resolveGlobalConflicts(positive, negative);
    for (const [characterId, character] of compiledCharacters) {
        resolveChannelConflicts(character.positive, character.negative, `角色 ${characterId}`);
        assertLockedCharacterConflicts(characterId, character, positive, negative);
    }
    if (positive.length === 0) {
        throw new IllustrationCompileError("ILLUSTRATION_COMPILE_CONFLICT", "全局 positive prompt 不能为空");
    }

    const dimensions = resolveDimensions(recipeSnapshot, shot.composition.canvasIntent);
    const negativePreset = resolveNovelAiNegativePreset(effectiveModel, getActiveTextToImageRecipeStyle(recipeSnapshot).negativeQualityPreset);
    const prompt = mergePrompt(
        positive.map((token) => token.wireText).join(", "),
        getActiveTextToImageRecipeStyle(recipeSnapshot).positiveQualityPreset ? novelAiQualityTags(effectiveModel) : "",
    );
    const negativePrompt = mergePrompt(negativePreset.content, negative.map((token) => token.wireText).join(", "));
    const patternSnapshots = patterns.map((pattern) => ({patternId: pattern.patternId, renderHash: createTagPatternRenderHash(pattern)}));
    const characterSnapshots = selectedCharacters.map((selected) => ({
        characterId: selected.character.characterId,
        renderTagFactsHash: selected.hashes.renderTagFactsHash,
        outfits: selected.outfits.map((outfit) => ({path: outfit.path, renderTagFactsHash: outfit.hashes.renderTagFactsHash})),
    }));
    const characterPrompts = selectedCharacters.map((selected, index) => {
        const compiled = compiledCharacters.get(selected.character.characterId);
        if (!compiled) throw new IllustrationCompileError("CHARACTER_VISUAL_TAGS_UNRESOLVED", `角色编译通道缺失：${selected.character.characterId}`);
        return {
            characterId: selected.character.characterId,
            center: {x: roundPosition((index + 1) / (selectedCharacters.length + 1)), y: 0.5},
            prompt: compiled.positive.map((token) => token.wireText).join(", "),
            negativePrompt: compiled.negative.map((token) => token.wireText).join(", "),
        };
    });
    const expansion = {
        patternSnapshots,
        characterSnapshots,
        resolutionValidationHash: validationHash,
        positive,
        negative,
        characters: selectedCharacters.map((selected) => ({
            characterId: selected.character.characterId,
            positive: compiledCharacters.get(selected.character.characterId)?.positive ?? [],
            negative: compiledCharacters.get(selected.character.characterId)?.negative ?? [],
        })),
    };
    const references = await resolveReferences(recipeSnapshot.references, rawInput.referenceAssetVerifier);
    // P5 preflight：有效 model + 冻结的 reference evidence 都已知后才调用，任何失败都不得创建 Manifest。
    const preflight = preflightNovelAiCapabilities({
        model: effectiveModel,
        smeaMode: recipeSnapshot.advanced.smeaMode,
        smeaDyn: recipeSnapshot.advanced.smeaDyn,
        useFurryDataset: getActiveTextToImageRecipeStyle(recipeSnapshot).useFurryDataset,
        vibeReferenceCount: references.vibeReferences.length,
        characterReferenceCount: references.characterReferences.length,
        hasInpaint: references.inpaint !== null,
    });
    const encoderVersion = references.vibeReferences.length > 0 ? vibeEncoderVersionForModel(effectiveModel) : null;
    const referenceSnapshotHash = createFrozenReferenceSnapshotHash({
        vibeReferences: references.vibeReferences,
        characterReferences: references.characterReferences,
        inpaint: references.inpaint ? {base: references.inpaint.base, mask: references.inpaint.mask} : null,
        model: effectiveModel,
        action: preflight.action,
        encoderVersion,
    });
    const requestReferences = {
        normalizeVibeStrengths: references.normalizeVibeStrengths,
        vibeReferences: references.vibeReferences.map(({evidence: _evidence, ...selection}) => selection),
        characterReferences: references.characterReferences.map(({evidence: _evidence, ...selection}) => selection),
        inpaint: references.inpaint
            ? {
                baseImageContentHash: references.inpaint.base.contentHash,
                maskContentHash: references.inpaint.mask.contentHash,
            }
            : null,
    };
    const requestBase = {
        schemaVersion: "nbook.illustration-compiled-request/v1" as const,
        compilerVersion: ILLUSTRATION_COMPILER_VERSION,
        executionPolicyVersion: ILLUSTRATION_EXECUTION_POLICY_VERSION,
        providerKind: "novelai" as const,
        source,
        provider,
        capabilitySnapshot,
        model: effectiveModel,
        action: preflight.action,
        wireModel: preflight.wireModel,
        referenceSnapshotHash,
        prompt,
        negativePrompt,
        characterPrompts,
        parameters: {
            sampler: mapSampler(recipeSnapshot.sampler, effectiveModel),
            noiseSchedule: normalizeNoiseSchedule(recipeSnapshot.noiseSchedule, effectiveModel),
            steps: recipeSnapshot.steps,
            promptGuidance: recipeSnapshot.promptGuidance,
            promptGuidanceRescale: recipeSnapshot.promptGuidanceRescale,
            width: dimensions.width,
            height: dimensions.height,
            seed,
            count: 1 as const,
            aiDefaultCharacterPosition: recipeSnapshot.advanced.aiDefaultCharacterPosition,
            variety: recipeSnapshot.advanced.variety,
            smeaMode: recipeSnapshot.advanced.smeaMode,
            smeaDyn: recipeSnapshot.advanced.smeaDyn,
            decrisper: recipeSnapshot.advanced.decrisper,
            qualityToggle: getActiveTextToImageRecipeStyle(recipeSnapshot).positiveQualityPreset,
            ucPreset: negativePreset.ucPreset,
        },
        recipeSnapshot,
        references: requestReferences,
        expansion,
    };
    const request = IllustrationCompiledRequestSchema.parse({
        ...requestBase,
        compiledRequestHash: createIllustrationCompiledRequestHash(requestBase),
    });
    const executionInputHash = createIllustrationExecutionInputHash({
        source,
        publicationJournalId,
        patternSnapshots,
        characterSnapshots,
        recipeSnapshot,
        provider,
        capabilitySnapshot,
        resolutionValidationHash: validationHash,
        referenceSnapshotHash,
        executionNonce,
        variantIndex,
        outputIndex,
        outputCount,
        seed,
        compilerVersion: ILLUSTRATION_COMPILER_VERSION,
        executionPolicyVersion: ILLUSTRATION_EXECUTION_POLICY_VERSION,
    });
    return {
        request,
        executionInputHash,
        compiledRequestHash: request.compiledRequestHash,
        executionManifestHash: createIllustrationExecutionManifestHash({
            executionInputHashes: [executionInputHash],
            recipeSnapshot,
            compiledRequests: [request],
            outputCount,
            additionalCostLowerBound: preflight.additionalCostLowerBound,
            tokenLowerBound: preflight.tokenLowerBound,
        }),
    };
}

/** 确认执行入口仍指向已发布的同一 Shot/placeholder 事实。 */
function assertSourceIdentity(
    source: z.output<typeof IllustrationExecutionSourceSchema>,
    shot: ChapterIllustrationShot,
    publicationJournalId: string,
): void {
    if (shot.state !== "active" || shot.publication.status !== "applied"
        || shot.publication.journalId !== publicationJournalId
        || shot.shotId !== source.shotId
        || shot.placeholderId !== source.placeholderId
        || shot.origin.kind !== source.shotOrigin
        || shot.shotIntentHash !== source.shotIntentHash) {
        throw new IllustrationCompileError("ILLUSTRATION_SHOT_STALE", "placeholder/shot/publication identity 已漂移");
    }
}

/** P5：reference selection 与上传时冻结的不可变磁盘证据合并。 */
type FrozenReferenceSelection = TextToImageReferenceSelection & {evidence: FrozenReferenceAsset};

/** P5：Compiler 冻结后的参考资源；evidence 供 snapshot hash 与 wire 校验消费。 */
type ResolvedReferences = {
    normalizeVibeStrengths: boolean;
    vibeReferences: FrozenReferenceSelection[];
    characterReferences: FrozenReferenceSelection[];
    inpaint: {base: FrozenReferenceSelection; mask: FrozenReferenceSelection} | null;
};

/**
 * P5 参考：从 Recipe 顶层 references 冻结引用选择，校验资产存在性、状态、
 * Inpaint base/mask 的 MIME 与同尺寸约束。不读文件 bytes，只消费 DB 元数据。
 */
async function resolveReferences(
    references: TextToImageRecipeSnapshot["references"],
    verifier: IllustrationCompileInput["referenceAssetVerifier"],
): Promise<ResolvedReferences> {
    const {normalizeVibeStrengths, vibeReferences, characterReferences, inpaint} = references;
    const contentHashes = [
        ...vibeReferences.map((item) => item.contentHash),
        ...characterReferences.map((item) => item.contentHash),
        ...(inpaint ? [inpaint.baseImageContentHash, inpaint.maskContentHash] : []),
    ];
    if (contentHashes.length === 0) {
        return {normalizeVibeStrengths, vibeReferences: [], characterReferences: [], inpaint: null};
    }
    if (!verifier) {
        throw new IllustrationCompileError("REFERENCE_ASSET_UNVERIFIED", "参考资产非空但未提供校验器");
    }
    const verified = await verifier(contentHashes);
    const missing = contentHashes.filter((hash) => !verified.has(hash));
    if (missing.length > 0) {
        throw new IllustrationCompileError("REFERENCE_ASSET_NOT_FOUND", `参考资产缺失：${missing.join(", ")}`);
    }
    const frozen = new Map<string, FrozenReferenceSelection>();
    for (const selection of [...vibeReferences, ...characterReferences]) {
        const dto = verified.get(selection.contentHash);
        if (!dto) continue;
        frozen.set(selection.contentHash, {...selection, evidence: toFrozenEvidence(dto)});
    }
    if (inpaint) {
        const baseDto = verified.get(inpaint.baseImageContentHash);
        const maskDto = verified.get(inpaint.maskContentHash);
        if (!baseDto || !maskDto) {
            throw new IllustrationCompileError("REFERENCE_ASSET_NOT_FOUND", "Inpaint base/mask 参考资产缺失");
        }
        if (maskDto.mimeType !== "image/png") {
            throw new IllustrationCompileError(
                "REFERENCE_ASSET_INPAINT_NOT_PNG",
                `Inpaint 蒙版必须是 PNG，实际 MIME=${maskDto.mimeType}`,
            );
        }
        if (baseDto.width !== maskDto.width || baseDto.height !== maskDto.height) {
            throw new IllustrationCompileError(
                "REFERENCE_ASSET_INPAINT_DIMENSIONS_MISMATCH",
                `Inpaint base/mask 尺寸不一致：${baseDto.width}x${baseDto.height} vs ${maskDto.width}x${maskDto.height}`,
            );
        }
    }
    return {
        normalizeVibeStrengths,
        vibeReferences: vibeReferences.map((selection) => requireFrozen(frozen, selection)),
        characterReferences: characterReferences.map((selection) => requireFrozen(frozen, selection)),
        inpaint: inpaint
            ? {
                base: requireFrozen(frozen, {contentHash: inpaint.baseImageContentHash, strength: 1, informationExtracted: null}),
                mask: requireFrozen(frozen, {contentHash: inpaint.maskContentHash, strength: 1, informationExtracted: null}),
            }
            : null,
    };
}

/** 把上传时冻结的 DTO 元数据转为不可变证据；missing/tampered 状态不允许进入编译。 */
function toFrozenEvidence(dto: TextToImageReferenceAssetDto): FrozenReferenceAsset {
    if (dto.status !== "available") {
        throw new IllustrationCompileError("REFERENCE_ASSET_TAMPERED", `参考资产不可用：${dto.contentHash}`);
    }
    return {
        contentHash: dto.contentHash,
        kind: dto.kind,
        mimeType: dto.mimeType,
        byteLength: dto.byteLength,
        width: dto.width,
        height: dto.height,
    };
}

function requireFrozen(
    frozen: Map<string, FrozenReferenceSelection>,
    selection: TextToImageReferenceSelection,
): FrozenReferenceSelection {
    const entry = frozen.get(selection.contentHash);
    if (!entry) {
        throw new IllustrationCompileError("REFERENCE_ASSET_NOT_FOUND", `参考资产缺失：${selection.contentHash}`);
    }
    return entry;
}

/** 校验 Recipe 原始画风串与调用方提供的 terminal expansion 一一对应。 */
function parseRecipeStyle(
    raw: IllustrationCompileInput["recipeStyle"],
    recipe: TextToImageRecipeSnapshot,
): Record<keyof IllustrationCompileInput["recipeStyle"], PendingToken[]> {
    const result: Record<keyof IllustrationCompileInput["recipeStyle"], PendingToken[]> = {
        positivePrefix: [],
        positiveSuffix: [],
        negativePrefix: [],
        negativeSuffix: [],
    };
    for (const key of ["positivePrefix", "positiveSuffix", "negativePrefix", "negativeSuffix"] as const) {
        let expected: string[];
        try {
            expected = splitTextToImageRecipeStyleAtoms(getActiveTextToImageRecipeStyle(recipe)[key]);
        } catch {
            throw new IllustrationCompileError("TEXT_TO_IMAGE_RECIPE_INVALID", "Recipe 画风串不能包含空 Tag 项");
        }
        const entries = raw[key].map((entry) => ({
            resolution: SemanticTagResolutionSchema.parse(entry.resolution),
            policyApproval: entry.policyApproval === null ? null : TagPolicyApprovalSchema.parse(entry.policyApproval),
        }));
        if (entries.length !== expected.length || entries.some((entry, index) => entry.resolution.sourceText !== expected[index])) {
            throw new IllustrationCompileError("TEXT_TO_IMAGE_RECIPE_INVALID", `Recipe ${key} 未绑定精确 terminal expansion`);
        }
        result[key] = entries.map((entry, index) => ({
            ...entry,
            weight: 1,
            mandatory: true,
            source: {kind: "recipe-style", sourceId: `${key}-${String(index + 1)}`},
        }));
    }
    return result;
}

/** 仅按 Shot 引用顺序选择启用的有效 Pattern。 */
function selectPatterns(patterns: TagPattern[], refs: string[]): TagPattern[] {
    const byId = new Map(patterns.map((pattern) => {
        const parsed = TagPatternSchema.parse(pattern);
        return [parsed.patternId, parsed] as const;
    }));
    return refs.map((ref) => {
        const pattern = byId.get(ref);
        if (!pattern || !pattern.enabled) {
            throw new IllustrationCompileError("ILLUSTRATION_PATTERN_INVALID", `引用 Pattern 已消失或禁用：${ref}`);
        }
        return pattern;
    });
}

type SelectedCharacter = CharacterVisualRegistrySnapshot["characters"][number];

/** 选择 Shot 引用的角色与服装，并复核各 owner 的 render hash。 */
function selectCharacters(snapshot: CharacterVisualRegistrySnapshot, shot: ChapterIllustrationShot): SelectedCharacter[] {
    const byId = new Map(snapshot.characters.map((entry) => [entry.character.characterId, entry]));
    const selected = shot.characterIds.map((characterId) => {
        const entry = byId.get(characterId);
        if (!entry) throw new IllustrationCompileError("CHARACTER_VISUAL_TAGS_UNRESOLVED", `角色 V2 不存在：${characterId}`);
        const character = CharacterImageTagsSchema.parse(entry.character);
        if (createCharacterImageTagHashes(character).renderTagFactsHash !== entry.hashes.renderTagFactsHash) {
            throw new IllustrationCompileError("CHARACTER_VISUAL_TAGS_UNRESOLVED", `角色 render hash 已漂移：${characterId}`);
        }
        return {...entry, character};
    });
    const selectedIds = new Set(selected.map((entry) => entry.character.characterId));
    const outfitOwners = new Map<string, string>();
    for (const entry of snapshot.characters) {
        for (const outfit of entry.outfits) outfitOwners.set(outfit.path, entry.character.characterId);
    }
    for (const outfitRef of shot.outfitRefs) {
        const owner = outfitOwners.get(outfitRef);
        if (!owner || !selectedIds.has(owner)) {
            throw new IllustrationCompileError("CHARACTER_VISUAL_TAGS_UNRESOLVED", `服装 V2 不存在或 owner 未选中：${outfitRef}`);
        }
    }
    return selected.map((entry) => ({
        ...entry,
        outfits: entry.outfits.filter((outfit) => shot.outfitRefs.includes(outfit.path)).map((outfit) => {
            const parsed = OutfitTagsSchema.parse(outfit.outfit);
            if (createOutfitTagHashes(parsed).renderTagFactsHash !== outfit.hashes.renderTagFactsHash) {
                throw new IllustrationCompileError("CHARACTER_VISUAL_TAGS_UNRESOLVED", `服装 render hash 已漂移：${outfit.path}`);
            }
            return {...outfit, outfit: parsed};
        }),
    }));
}

/** 把 Pattern 的全局正负向引用加入待复验通道。 */
function addPatternTokens(channels: PendingChannels, pattern: TagPattern): void {
    const weights = syntaxWeights(pattern.providerSyntaxRefs, pattern.providerSyntaxNodes);
    addRefs(channels.positive, pattern, [
        ...pattern.positive.scene,
        ...pattern.positive.composition,
        ...pattern.positive.lighting,
        ...pattern.positive.action,
    ], weights, false, {kind: "pattern", sourceId: pattern.patternId});
    addRefs(channels.negative, pattern, pattern.negative.global, weights, false, {kind: "pattern", sourceId: pattern.patternId});
}

/** 把 Shot 的 prefer/avoid delta 加入全局待复验通道。 */
function addShotTokens(channels: PendingChannels, shot: ChapterIllustrationShot): void {
    addRefs(channels.positive, shot, shot.tagDelta.prefer, new Map(), false, {kind: "shot-prefer", sourceId: shot.shotId});
    addRefs(channels.negative, shot, shot.tagDelta.avoid, new Map(), false, {kind: "shot-avoid", sourceId: shot.shotId});
}

/** 按景别可见性规则构造角色与服装锁定通道。 */
function addCharacterTokens(
    channels: PendingChannels,
    selected: SelectedCharacter,
    shotSize: "close-up" | "medium" | "wide",
    patterns: TagPattern[],
): void {
    const characterId = selected.character.characterId;
    const characterChannels: {positive: PendingToken[]; negative: PendingToken[]} = {positive: [], negative: []};
    channels.characters.set(characterId, characterChannels);
    const positiveFields: CharacterImageTagField[] = ["profileTraits", "facialAppearance"];
    if (shotSize !== "close-up") positiveFields.push("upperSfw");
    if (shotSize === "wide") positiveFields.push("lowerSfw");
    addVisualFields(characterChannels.positive, selected.character, positiveFields, `character:${characterId}`);
    addVisualFields(characterChannels.negative, selected.character, ["negativePrompt"], `character:${characterId}`);
    for (const outfitEntry of selected.outfits) {
        const outfitFields: OutfitTagField[] = shotSize === "close-up" ? [] : shotSize === "medium" ? ["upper"] : ["upper", "lower"];
        addVisualFields(characterChannels.positive, outfitEntry.outfit, outfitFields, outfitEntry.path);
    }
    for (const pattern of patterns) {
        const weights = syntaxWeights(pattern.providerSyntaxRefs, pattern.providerSyntaxNodes);
        addRefs(characterChannels.negative, pattern, pattern.negative.characters, weights, false, {kind: "pattern", sourceId: pattern.patternId});
    }
}

/** 从角色或服装 owner 中展开字段引用及其 Provider syntax 权重。 */
function addVisualFields<TField extends CharacterImageTagField | OutfitTagField>(
    target: PendingToken[],
    document: z.output<typeof CharacterImageTagsSchema> | z.output<typeof OutfitTagsSchema>,
    fields: TField[],
    sourceId: string,
): void {
    if (document.schema === "nbook.character-image-tags/v2") {
        const parsedFields = fields.map((field) => CharacterImageTagFieldSchema.parse(field));
        const weights = syntaxWeights(
            parsedFields.flatMap((field) => document.fieldProviderSyntaxRefs[field] ?? []),
            document.providerSyntaxNodes,
        );
        for (const field of parsedFields) addVisualField(target, document, field, weights, {kind: "character", sourceId});
        return;
    }
    const parsedFields = fields.map((field) => OutfitTagFieldSchema.parse(field));
    const weights = syntaxWeights(
        parsedFields.flatMap((field) => document.fieldProviderSyntaxRefs[field] ?? []),
        document.providerSyntaxNodes,
    );
    for (const field of parsedFields) addVisualField(target, document, field, weights, {kind: "outfit", sourceId});
}

/** 向单个角色字段通道加入同 owner resolution。 */
function addVisualField(
    target: PendingToken[],
    document: z.output<typeof CharacterImageTagsSchema>,
    field: CharacterImageTagField,
    weights: ReadonlyMap<string, number>,
    source: TokenSource,
): void;
/** 向单个服装字段通道加入同 owner resolution。 */
function addVisualField(
    target: PendingToken[],
    document: z.output<typeof OutfitTagsSchema>,
    field: OutfitTagField,
    weights: ReadonlyMap<string, number>,
    source: TokenSource,
): void;
/** 向已判别的视觉 owner 字段通道加入 resolution 与审批证据。 */
function addVisualField(
    target: PendingToken[],
    document: z.output<typeof CharacterImageTagsSchema> | z.output<typeof OutfitTagsSchema>,
    field: CharacterImageTagField | OutfitTagField,
    weights: ReadonlyMap<string, number>,
    source: TokenSource,
): void {
    const refs = document.schema === "nbook.character-image-tags/v2"
        ? document.fields[CharacterImageTagFieldSchema.parse(field)]
        : document.fields[OutfitTagFieldSchema.parse(field)];
    for (const ref of refs) {
        const resolution = document.tagResolutions[ref];
        if (!resolution) throw new IllustrationCompileError("CHARACTER_VISUAL_TAGS_UNRESOLVED", `字段 ${field} 缺少 resolution：${ref}`);
        target.push({
            resolution,
            policyApproval: document.policyApprovals[ref] ?? null,
            weight: weights.get(ref) ?? 1,
            mandatory: true,
            source,
        });
    }
}

/** 从通用 owner 的引用键展开待复验 token，缺证据时 fail closed。 */
function addRefs(
    target: PendingToken[],
    owner: Pick<TagPattern, "tagResolutions" | "policyApprovals"> | Pick<ChapterIllustrationShot, "tagResolutions">,
    refs: string[],
    weights: ReadonlyMap<string, number>,
    mandatory: boolean,
    source: TokenSource,
): void {
    for (const ref of refs) {
        const resolution = owner.tagResolutions[ref];
        if (!resolution) throw new IllustrationCompileError("TAG_RESOLUTION_INVALID", `owner 缺少 resolution：${ref}`);
        target.push({
            resolution,
            policyApproval: "policyApprovals" in owner ? owner.policyApprovals[ref] ?? null : null,
            weight: weights.get(ref) ?? 1,
            mandatory,
            source,
        });
    }
}

/** 将结构化 Provider syntax 节点收敛为 resolutionKey 到唯一权重的映射。 */
function syntaxWeights(refs: string[], nodes: Record<string, ProviderSyntaxNode>): Map<string, number> {
    const weights = new Map<string, number>();
    for (const ref of refs) {
        const node = nodes[ref];
        if (!node) throw new IllustrationCompileError("TAG_RESOLUTION_INVALID", `Provider syntax node 不存在：${ref}`);
        for (const resolutionKey of node.resolutionKeys) {
            const previous = weights.get(resolutionKey);
            if (previous !== undefined && previous !== node.weight) {
                throw new IllustrationCompileError("ILLUSTRATION_COMPILE_CONFLICT", `同一 Tag 存在冲突权重：${resolutionKey}`);
            }
            weights.set(resolutionKey, node.weight);
        }
    }
    return weights;
}

/** 以固定通道顺序扁平化复验输入，便于位置式闭包校验。 */
function flattenChannels(channels: PendingChannels): PendingToken[] {
    return [
        ...channels.positive,
        ...channels.negative,
        ...[...channels.characters.values()].flatMap((character) => [...character.positive, ...character.negative]),
    ];
}

/** 把复验后的 resolutions 编译为稳定顺序、去重且保留证据的 token。 */
function compileChannel(pending: PendingToken[], resolutions: SemanticTagResolution[]): CompiledToken[] {
    const result: CompiledToken[] = [];
    const byText = new Map<string, CompiledToken>();
    pending.forEach((token, index) => {
        const resolution = resolutions[index];
        if (!resolution) throw new IllustrationCompileError("TAG_RESOLUTION_INVALID", "终态复验结果缺失");
        const semanticText = resolution.kind === "provider_passthrough" ? resolution.wireText : resolution.canonical.canonicalName;
        const resolutionHash = createSemanticTagResolutionHash(resolution);
        const existing = byText.get(semanticText);
        if (existing) {
            existing.weight = Math.max(existing.weight, token.weight);
            existing.mandatory ||= token.mandatory;
            if (!existing.resolutionHashes.includes(resolutionHash)) existing.resolutionHashes.push(resolutionHash);
            if (!existing.sources.some((source) => source.kind === token.source.kind && source.sourceId === token.source.sourceId)) {
                existing.sources.push(token.source);
            }
            existing.wireText = encodeWeight(semanticText, existing.weight);
            return;
        }
        const compiled: CompiledToken = {
            wireText: encodeWeight(semanticText, token.weight),
            semanticText,
            resolutionHashes: [resolutionHash],
            weight: token.weight,
            mandatory: token.mandatory,
            sources: [token.source],
        };
        byText.set(semanticText, compiled);
        result.push(compiled);
    });
    return result;
}

/** 处理全局正负向冲突；仅允许 Shot avoid 移除非强制 Pattern 建议。 */
function resolveGlobalConflicts(positive: CompiledToken[], negative: CompiledToken[]): void {
    for (let index = positive.length - 1; index >= 0; index -= 1) {
        const positiveToken = positive[index];
        if (!positiveToken) continue;
        const negativeToken = negative.find((candidate) => candidate.semanticText === positiveToken.semanticText);
        if (!negativeToken) continue;
        const avoidOnly = negativeToken.sources.every((source) => source.kind === "shot-avoid");
        const patternOnly = positiveToken.sources.every((source) => source.kind === "pattern");
        if (!positiveToken.mandatory && patternOnly && avoidOnly) {
            positive.splice(index, 1);
            continue;
        }
        throw new IllustrationCompileError("ILLUSTRATION_COMPILE_CONFLICT", `positive/negative Tag 冲突：${positiveToken.semanticText}`);
    }
}

/** 拒绝同一角色通道内相同语义同时出现在 positive 与 UC。 */
function resolveChannelConflicts(positive: CompiledToken[], negative: CompiledToken[], label: string): void {
    const negativeTexts = new Set(negative.map((token) => token.semanticText));
    const conflict = positive.find((token) => negativeTexts.has(token.semanticText));
    if (conflict) throw new IllustrationCompileError("ILLUSTRATION_COMPILE_CONFLICT", `${label} positive/UC 冲突：${conflict.semanticText}`);
}

/** 拒绝全局通道覆盖角色 V2 中的锁定正向或负向事实。 */
function assertLockedCharacterConflicts(
    characterId: string,
    character: {positive: CompiledToken[]; negative: CompiledToken[]},
    globalPositive: CompiledToken[],
    globalNegative: CompiledToken[],
): void {
    const globalNegativeTexts = new Set(globalNegative.map((token) => token.semanticText));
    const lockedPositive = character.positive.find((token) => globalNegativeTexts.has(token.semanticText));
    if (lockedPositive) {
        throw new IllustrationCompileError("ILLUSTRATION_COMPILE_CONFLICT", `全局 negative 试图覆盖角色 ${characterId} 锁定事实：${lockedPositive.semanticText}`);
    }
    const globalPositiveTexts = new Set(globalPositive.map((token) => token.semanticText));
    const lockedNegative = character.negative.find((token) => globalPositiveTexts.has(token.semanticText));
    if (lockedNegative) {
        throw new IllustrationCompileError("ILLUSTRATION_COMPILE_CONFLICT", `全局 positive 与角色 ${characterId} UC 冲突：${lockedNegative.semanticText}`);
    }
}

/** 按 Recipe 的 fixed/byIntent 策略解析最终尺寸。 */
function resolveDimensions(recipe: TextToImageRecipeSnapshot, intent: "portrait" | "landscape" | "square") {
    return recipe.dimensions.mode === "fixed" ? recipe.dimensions.fixed : recipe.dimensions[intent];
}

/** 应用 NovelAI 模型家族的 sampler 硬约束。 */
function mapSampler(sampler: string, model: string): string {
    if ((sampler === "ddim" || sampler === "ddim_v3") && model.includes("diffusion-3")) return "ddim_v3";
    if ((sampler === "ddim" || sampler === "ddim_v3") && isV4(model)) return "k_euler_ancestral";
    return sampler;
}

/** 应用 V4 对 native noise schedule 的稳定映射。 */
function normalizeNoiseSchedule(schedule: string, model: string): string {
    return isV4(model) && schedule === "native" ? "karras" : schedule;
}

/** 判断当前模型是否属于 NovelAI V4 家族。 */
function isV4(model: string): boolean {
    return model.includes("diffusion-4") || model.includes("diffusion-4-5");
}

/** 将规范化权重编码为 NovelAI wire syntax。 */
function encodeWeight(tag: string, weight: number): string {
    if (weight === 1) return tag;
    return `${String(Math.round(weight * 1000) / 1000)}::${tag}::`;
}

/** 清理并按逗号稳定拼接 prompt 片段。 */
function mergePrompt(...parts: string[]): string {
    return parts.map((part) => part.trim().replace(/^,+|,+$/gu, "")).filter(Boolean).join(", ");
}

/** 固定角色中心点的小数精度，避免跨运行 hash 抖动。 */
function roundPosition(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
}

/** 校验执行身份字段并映射为稳定业务错误。 */
function parseStableId(value: string, label: string): string {
    try {
        return z.string().trim().min(1).max(200).parse(value);
    } catch {
        throw new IllustrationCompileError("ILLUSTRATION_SHOT_STALE", `${label} 非法`);
    }
}

/** registry 固定 model → Vibe encoder 映射；未登记 model 拒绝进入 frozen snapshot。 */
function vibeEncoderVersionForModel(model: NovelAiProviderModelId): string {
    const container = PROVIDER_GRAMMAR_REGISTRY.advanced.vibeTransfer.containers.find(
        (entry) => entry.model === model,
    );
    if (!container) {
        throw new IllustrationCompileError("TEXT_TO_IMAGE_RECIPE_INVALID", `model=${model} 没有登记 Vibe 容器映射`);
    }
    return container.encoderVersion;
}
