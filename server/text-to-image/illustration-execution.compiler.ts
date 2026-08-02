import {z} from "zod";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    ChapterIllustrationShotSchema,
    type ChapterIllustrationPlanningSource,
    type ChapterIllustrationShot,
} from "nbook/shared/text-to-image-chapter-storyboard";
import {
    createIllustrationExecutionSourceIdentityHash,
    IllustrationExecutionSourceSchema,
    type IllustrationExecutionSource,
} from "nbook/shared/text-to-image-execution";
import {renderTextToImageAssetMarkdown, findTextToImagePromptMarkdown} from "nbook/shared/text-to-image-markdown";
import {NovelAiProviderModelIdSchema, resolveProviderCapability} from "nbook/shared/text-to-image-provider-registry";
import {
    splitTextToImageRecipeStyleAtoms,
    getActiveTextToImageRecipeStyle,
    type TextToImageRecipeSnapshot,
} from "nbook/shared/text-to-image-recipe";
import type {TagResolutionRun} from "nbook/shared/text-to-image-tag-resolver";
import {TAG_INDEX_CAPABILITY_VERSION} from "nbook/shared/text-to-image-tag-index";
import {loadEffectiveConfigForAgentRuntime} from "nbook/server/config/config-service";
import {parseChapterStoryboardMarkdown} from "nbook/server/text-to-image/chapter-storyboard.codec";
import {CharacterVisualRegistryService} from "nbook/server/text-to-image/character-visual-registry.service";
import {TextToImageReferenceAssetService} from "nbook/server/text-to-image/reference-asset.service";
import type {TextToImageReferenceAssetDto} from "nbook/shared/text-to-image-reference-asset";
import {
    compileIllustration,
    type IllustrationCompileInput,
    type IllustrationCompileResult,
    type IllustrationResolutionValidator,
    type IllustrationResolvedStyleTag,
} from "nbook/server/text-to-image/illustration-compiler";
import {IllustrationChapterParser} from "nbook/server/text-to-image/illustration-chapter-parser";
import type {IllustrationExecutionCompilePort} from "nbook/server/text-to-image/illustration-execution.service";
import {textToImageProjectClient} from "nbook/server/text-to-image/project-client";
import {StoryboardPlanningSnapshotService} from "nbook/server/text-to-image/storyboard-planning-snapshot.service";
import {
    DEFAULT_TEXT_TO_IMAGE_RECIPE_PATH,
} from "nbook/server/text-to-image/recipe.codec";
import {
    TextToImageRecipeNotConfiguredError,
    TextToImageRecipeService,
    type TextToImageRecipeDocument,
} from "nbook/server/text-to-image/recipe.service";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {TagIndexReader} from "nbook/server/text-to-image/tag-index/tag-index-reader";
import {TagIndexStore} from "nbook/server/text-to-image/tag-index/tag-index-store";
import {TagPolicyRegistryService} from "nbook/server/text-to-image/tag-index/tag-policy-registry";
import {TagResolverService} from "nbook/server/text-to-image/tag-index/tag-resolver.service";
import {assertProjectOpen} from "nbook/server/workspace-files/project-session";
import {resolveWorkspaceRootInput, textToImageProjectRef} from "nbook/server/text-to-image/compat";
import {readWorkspaceTextFile, scanWorkspaceTree} from "nbook/server/workspace-files/workspace-files";

const StyleChannelSchema = z.enum(["positivePrefix", "positiveSuffix", "negativePrefix", "negativeSuffix"]);
type StyleChannel = z.infer<typeof StyleChannelSchema>;

export type IllustrationExecutionTargetSnapshot = {
    source: IllustrationExecutionSource;
    publicationJournalId: string;
    shot: ChapterIllustrationShot;
    planningSource: ChapterIllustrationPlanningSource;
};

export type IllustrationExecutionCompilerErrorCode =
    | "ILLUSTRATION_EXECUTION_TARGET_NOT_FOUND"
    | "ILLUSTRATION_EXECUTION_TARGET_AMBIGUOUS"
    | "ILLUSTRATION_EXECUTION_TARGET_INVALID"
    | "ILLUSTRATION_PROJECT_ID_MISSING"
    | "TEXT_TO_IMAGE_RECIPE_STYLE_INVALID";

/** Preview 读取目标或展开 Recipe style 失败时的稳定错误。 */
export class IllustrationExecutionCompilerError extends Error {
    constructor(readonly code: IllustrationExecutionCompilerErrorCode, message: string) {
        super(`${code}: ${message}`);
        this.name = "IllustrationExecutionCompilerError";
    }
}

export type IllustrationExecutionResolver = Pick<
    TagResolverService,
    "resolveTags" | "suggestTagReplacements" | "finalizeTagResolution" | "revalidateForExecution"
>;

export type IllustrationExecutionCompilerDependencies = {
    readTarget(input: {projectPath: string; placeholderId: string}): Promise<IllustrationExecutionTargetSnapshot>;
    readRecipe(projectPath: string): Promise<TextToImageRecipeDocument>;
    readPlanningRules: StoryboardPlanningSnapshotService["read"];
    readCharacters: CharacterVisualRegistryService["read"];
    readProviderSnapshot: TextToImageProviderService["resolveNovelAiSnapshot"];
    createResolver(input: {projectPath: string; executionNonce: string}): Promise<IllustrationExecutionResolver>;
    /** P5：校验 Recipe 参考资产是否真实存在于当前 Project；空引用时不调用。 */
    verifyReferenceAssets(projectPath: string, contentHashes: string[]): Promise<Map<string, TextToImageReferenceAssetDto>>;
    compile(input: IllustrationCompileInput, dependencies: {resolutionValidator: IllustrationResolutionValidator}): Promise<IllustrationCompileResult>;
};

/** 把已发布 placeholder 的全部服务端真相源接入唯一 Prompt Compiler。 */
export class ProductionIllustrationExecutionCompiler implements IllustrationExecutionCompilePort {
    private readonly dependencies: IllustrationExecutionCompilerDependencies;

    constructor(dependencies: IllustrationExecutionCompilerDependencies = createProductionDependencies()) {
        this.dependencies = dependencies;
    }

    /** 只读 source identity 与当前已保存 Recipe seed policy。 */
    async readTarget(input: {projectPath: string; ownerUserId: number; placeholderId: string}): Promise<{
        sourceIdentityHash: string;
        seedPolicy: {kind: "random"} | {kind: "fixed"; seed: number};
    }> {
        z.number().int().positive().safe().parse(input.ownerUserId);
        const [target, recipe] = await Promise.all([
            this.dependencies.readTarget({projectPath: input.projectPath, placeholderId: input.placeholderId}),
            this.requireRecipe(input.projectPath),
        ]);
        return {
            sourceIdentityHash: createIllustrationExecutionSourceIdentityHash(target.source),
            seedPolicy: recipe.snapshot.seed.policy === "fixed"
                ? {kind: "fixed", seed: recipe.snapshot.seed.fixed}
                : {kind: "random"},
        };
    }

    /** 重读当前事实、解析 Recipe style terminal snapshots，并执行唯一 Compiler。 */
    async compile(input: {
        projectPath: string;
        ownerUserId: number;
        placeholderId: string;
        expectedSourceIdentityHash: string;
        executionNonce: string;
        variantIndex: number;
        outputIndex: number;
        outputCount: number;
        seed: number;
    }): Promise<IllustrationCompileResult> {
        const target = await this.dependencies.readTarget({projectPath: input.projectPath, placeholderId: input.placeholderId});
        if (createIllustrationExecutionSourceIdentityHash(target.source) !== input.expectedSourceIdentityHash) {
            throw new IllustrationExecutionCompilerError(
                "ILLUSTRATION_EXECUTION_TARGET_INVALID",
                "placeholder source identity 已变化，请刷新 Execution Preview",
            );
        }
        const [recipe, planningRules, characters, provider, resolver] = await Promise.all([
            this.requireRecipe(input.projectPath),
            this.dependencies.readPlanningRules(),
            this.dependencies.readCharacters({projectPath: input.projectPath}),
            this.dependencies.readProviderSnapshot(input.ownerUserId),
            this.dependencies.createResolver({projectPath: input.projectPath, executionNonce: input.executionNonce}),
        ]);
        const effectiveModel = NovelAiProviderModelIdSchema.safeParse(
            getActiveTextToImageRecipeStyle(recipe.snapshot).useFurryDataset ? "nai-diffusion-furry-3" : recipe.snapshot.model,
        );
        if (!effectiveModel.success) {
            throw new IllustrationExecutionCompilerError(
                "ILLUSTRATION_EXECUTION_TARGET_INVALID",
                `Recipe model 未注册：${recipe.snapshot.model}`,
            );
        }
        const recipeStyle = await resolveRecipeStyle({
            resolver,
            projectId: target.source.projectId,
            executionNonce: input.executionNonce,
            modelId: effectiveModel.data,
            recipe: recipe.snapshot,
        });
        const resolutionValidator: IllustrationResolutionValidator = {
            revalidate: async (request) => await resolver.revalidateForExecution(request),
        };
        return await this.dependencies.compile({
            source: target.source,
            publicationJournalId: target.publicationJournalId,
            planningFacts: {
                effectivePresetSemanticHash: target.planningSource.effectivePreset.semanticHash,
                effectivePatternPlanningHash: target.planningSource.effectivePatternSet.planningHash,
                visualPlanningFactsHash: target.planningSource.visualPlanningFactsHash,
                recipePlanningConstraintsHash: target.planningSource.recipePlanningConstraints.constraintsHash,
            },
            shot: target.shot,
            effectivePatterns: {
                presetSemanticHash: planningRules.preset.semanticHash,
                planningHash: planningRules.patterns.planningHash,
                patterns: planningRules.patterns.patterns,
            },
            characters,
            recipeSnapshot: recipe.snapshot,
            recipeStyle,
            provider: {
                ownerUserId: provider.ownerUserId,
                providerId: provider.providerId,
                credentialRevision: provider.credentialRevision,
            },
            capabilitySnapshot: resolveProviderCapability({kind: "novelai-model", modelId: effectiveModel.data}),
            referenceAssetVerifier: async (contentHashes) => await this.dependencies.verifyReferenceAssets(input.projectPath, contentHashes),
            executionNonce: input.executionNonce,
            variantIndex: input.variantIndex,
            outputIndex: input.outputIndex,
            outputCount: input.outputCount,
            seed: input.seed,
        }, {resolutionValidator});
    }

    /** Preview 只能消费显式持久化 Recipe。 */
    private async requireRecipe(projectPath: string): Promise<TextToImageRecipeDocument & {exists: true}> {
        const recipe = await this.dependencies.readRecipe(projectPath);
        if (!recipe.exists) throw new TextToImageRecipeNotConfiguredError();
        return {...recipe, exists: true};
    }
}

/** 创建只读生产端口；所有文件与数据库读取均绑定当前打开的 Project/owner。 */
function createProductionDependencies(): IllustrationExecutionCompilerDependencies {
    const planningRules = new StoryboardPlanningSnapshotService();
    const characters = new CharacterVisualRegistryService();
    const recipes = new TextToImageRecipeService();
    const providers = new TextToImageProviderService();
    return {
        readTarget: readPublishedTarget,
        readRecipe: async (projectPath) => await recipes.read(projectPath),
        readPlanningRules: async () => await planningRules.read(),
        readCharacters: async (input) => await characters.read(input),
        readProviderSnapshot: async (ownerUserId) => await providers.resolveNovelAiSnapshot(ownerUserId),
        createResolver: createExecutionResolver,
        verifyReferenceAssets: async (projectPath, contentHashes) => await new TextToImageReferenceAssetService().readByContentHashes(projectPath, contentHashes),
        compile: compileIllustration,
    };
}

/** 精确定位唯一 placeholder、同章 Storyboard、可信锚点与未漂移正文。 */
async function readPublishedTarget(input: {projectPath: string; placeholderId: string}): Promise<IllustrationExecutionTargetSnapshot> {
    const projectPath = z.string().trim().min(1).max(1_000).parse(input.projectPath);
    const placeholderId = z.string().trim().min(1).max(200).parse(input.placeholderId);
    assertProjectOpen(textToImageProjectRef(projectPath));
    const root = z.string().min(1).parse(await resolveWorkspaceRootInput({projectPath}));
    const client = await textToImageProjectClient(projectPath);
    const [metadata, nodes] = await Promise.all([
        client.projectMetadata.findUnique({where: {key: "projectId"}}),
        scanWorkspaceTree({root: root as any, targets: ["manuscript"], depth: null, recursive: true}),
    ]);
    if (!metadata) {
        throw new IllustrationExecutionCompilerError("ILLUSTRATION_PROJECT_ID_MISSING", "Project 数据库缺少可移植 projectId");
    }
    const chapterPaths = nodes
        .filter((node) => !node.isDirectory)
        .map((node) => node.path.replaceAll("\\", "/"))
        .filter((filePath) => /^manuscript\/[^/]+\/[^/]+\/index\.md$/u.test(filePath))
        .sort(compareText);
    const matches: Array<{chapterPath: string; markdown: string; payload: NonNullable<ReturnType<typeof findTextToImagePromptMarkdown>>["payload"]}> = [];
    for (const chapterPath of chapterPaths) {
        const markdown = await readWorkspaceTextFile(root as any, chapterPath);
        const found = findTextToImagePromptMarkdown(markdown, placeholderId);
        if (!found) continue;
        if (findTextToImagePromptMarkdown(markdown.replace(found.raw, ""), placeholderId)) {
            throw new IllustrationExecutionCompilerError("ILLUSTRATION_EXECUTION_TARGET_AMBIGUOUS", "同一章节存在重复 placeholderId");
        }
        matches.push({chapterPath, markdown, payload: found.payload});
    }
    if (matches.length === 0) {
        throw new IllustrationExecutionCompilerError("ILLUSTRATION_EXECUTION_TARGET_NOT_FOUND", "正文中不存在该 V2 placeholder");
    }
    if (matches.length !== 1) {
        throw new IllustrationExecutionCompilerError("ILLUSTRATION_EXECUTION_TARGET_AMBIGUOUS", "多个章节存在相同 placeholderId");
    }
    const match = matches[0];
    if (!match) throw new IllustrationExecutionCompilerError("ILLUSTRATION_EXECUTION_TARGET_NOT_FOUND", "正文中不存在该 V2 placeholder");
    const storyboardPath = match.chapterPath.replace(/\/index\.md$/u, "/illustrations.md");
    let storyboardMarkdown: string;
    try {
        storyboardMarkdown = await readWorkspaceTextFile(root as any, storyboardPath);
    } catch (error) {
        if (isMissingFileError(error)) {
            throw new IllustrationExecutionCompilerError("ILLUSTRATION_EXECUTION_TARGET_INVALID", "placeholder 缺少同章 illustrations.md");
        }
        throw error;
    }
    const storyboard = parseChapterStoryboardMarkdown(storyboardMarkdown).storyboard;
    const shot = storyboard.shots.find((candidate) => candidate.placeholderId === placeholderId);
    if (!shot) {
        throw new IllustrationExecutionCompilerError("ILLUSTRATION_EXECUTION_TARGET_INVALID", "illustrations.md 不拥有该 placeholder");
    }
    const planningSource = storyboard.planningSources.find((candidate) => candidate.planningRunId === shot.origin.planningRunId);
    if (!planningSource) {
        throw new IllustrationExecutionCompilerError("ILLUSTRATION_EXECUTION_TARGET_INVALID", "Shot 缺少所属 Planning Source");
    }
    const assets = await client.textToImageAsset.findMany({where: {sourcePath: match.chapterPath}});
    const ownedAssetMarkdown = assets.map((asset) => renderTextToImageAssetMarkdown({
            id: asset.id,
            jobId: asset.jobId,
            relativePath: asset.relativePath,
            fileName: asset.fileName,
            mimeType: asset.mimeType,
            byteLength: asset.byteLength,
            width: asset.width,
            height: asset.height,
            model: asset.model,
            seed: asset.seed,
            prompt: asset.prompt,
            negativePrompt: asset.negativePrompt,
            sourceKind: asset.sourceKind,
            sourcePath: asset.sourcePath,
            sourceAnchorId: asset.sourceAnchorId,
            createdAt: asset.createdAt.toISOString(),
        }));
    const chapter = new IllustrationChapterParser().parse({
        chapterPath: match.chapterPath,
        markdown: stripOwnedAssetMarkdown(match.markdown, ownedAssetMarkdown),
    });
    assertTargetClosure({
        projectId: metadata.value,
        chapterPath: match.chapterPath,
        storyboard,
        chapter,
        payload: match.payload,
        shot,
        planningSource,
    });
    return {
        source: IllustrationExecutionSourceSchema.parse({
            projectId: metadata.value,
            chapterPath: match.chapterPath,
            placeholderId,
            shotId: shot.shotId,
            shotOrigin: shot.origin.kind,
            anchorId: shot.anchorId,
            shotIntentHash: shot.shotIntentHash,
            sourceChapterHash: storyboard.sourceChapterHash,
        }),
        publicationJournalId: shot.publication.journalId,
        shot: ChapterIllustrationShotSchema.parse(shot),
        planningSource,
    };
}

/** 对正文、placeholder payload、Storyboard owner 与锚点做闭包校验。 */
function assertTargetClosure(input: {
    projectId: string;
    chapterPath: string;
    storyboard: ReturnType<typeof parseChapterStoryboardMarkdown>["storyboard"];
    chapter: ReturnType<IllustrationChapterParser["parse"]>;
    payload: NonNullable<ReturnType<typeof findTextToImagePromptMarkdown>>["payload"];
    shot: ChapterIllustrationShot;
    planningSource: ChapterIllustrationPlanningSource;
}): void {
    const anchors = new Set(input.chapter.anchorCandidates.map((anchor) => anchor.anchorId));
    const expectedOrigin = input.planningSource.operation === "plan-chapter" ? "chapter-plan" : "selection";
    if (!input.projectId.trim()
        || input.storyboard.chapterPath !== input.chapterPath
        || input.chapter.sourceChapterHash !== input.storyboard.sourceChapterHash
        || input.planningSource.sourceChapterHashAtPlan !== input.storyboard.sourceChapterHash
        || input.payload.sourceChapterHash !== input.storyboard.sourceChapterHash
        || input.payload.shotId !== input.shot.shotId
        || input.payload.shotIntentHash !== input.shot.shotIntentHash
        || input.payload.anchorId !== input.shot.anchorId
        || input.payload.origin !== input.shot.origin.kind
        || input.shot.origin.kind !== expectedOrigin
        || input.shot.state !== "active"
        || input.planningSource.state !== "active"
        || input.shot.publication.status !== "applied"
        || input.planningSource.publication.status !== "applied"
        || input.shot.publication.journalId !== input.planningSource.publication.journalId
        || input.planningSource.recipePlanningConstraints.key !== DEFAULT_TEXT_TO_IMAGE_RECIPE_PATH
        || !anchors.has(input.shot.anchorId)
        || !anchors.has(input.shot.insertAfterAnchorId)) {
        throw new IllustrationExecutionCompilerError(
            "ILLUSTRATION_EXECUTION_TARGET_INVALID",
            "正文、可信锚点或已发布 Storyboard 事实已漂移，必须重新规划",
        );
    }
}

/** DB 明确拥有的标准生成图片不属于 sourceChapterHash 正文语义。 */
export function stripOwnedAssetMarkdown(markdown: string, ownedMarkdown: string[]): string {
    let result = markdown;
    for (const rendered of ownedMarkdown) result = result.replace(rendered, "");
    return result;
}

/** 为当前 Project/nonce 创建确定性、run-scoped 的执行 Resolver。 */
async function createExecutionResolver(input: {projectPath: string; executionNonce: string}): Promise<TagResolverService> {
    const effective = await loadEffectiveConfigForAgentRuntime({projectPath: input.projectPath});
    let resolutionIndex = 0;
    return new TagResolverService({
        reader: new TagIndexReader({root: new TagIndexStore().root}),
        policyRegistry: new TagPolicyRegistryService(),
        capabilityVersion: TAG_INDEX_CAPABILITY_VERSION,
        resolveProjectPolicy: async () => effective.illustration.tagPolicy,
        idFactory: () => {
            resolutionIndex += 1;
            return `execution-resolution-${hashTextToImageContract({executionNonce: input.executionNonce, resolutionIndex})
                .slice("sha256:".length, "sha256:".length + 32)}`;
        },
    });
}

/** 按共享切分合同，把 Recipe 四个画风通道转为 exact-model terminal snapshots。 */
async function resolveRecipeStyle(input: {
    resolver: IllustrationExecutionResolver;
    projectId: string;
    executionNonce: string;
    modelId: string;
    recipe: TextToImageRecipeSnapshot;
}): Promise<Record<StyleChannel, IllustrationResolvedStyleTag[]>> {
    const modelId = NovelAiProviderModelIdSchema.parse(input.modelId);
    const result: Record<StyleChannel, IllustrationResolvedStyleTag[]> = {
        positivePrefix: [],
        positiveSuffix: [],
        negativePrefix: [],
        negativeSuffix: [],
    };
    for (const channel of StyleChannelSchema.options) {
        let atoms: string[];
        try {
            atoms = splitTextToImageRecipeStyleAtoms(getActiveTextToImageRecipeStyle(input.recipe)[channel]);
        } catch {
            throw new IllustrationExecutionCompilerError("TEXT_TO_IMAGE_RECIPE_STYLE_INVALID", `Recipe ${channel} 包含空 Tag 项`);
        }
        if (atoms.length === 0) continue;
        const runId = `execution-style-${hashTextToImageContract({executionNonce: input.executionNonce, channel})
            .slice("sha256:".length, "sha256:".length + 32)}`;
        const runs = await input.resolver.resolveTags({
            runId,
            contextId: input.projectId,
            tags: atoms,
            modelScope: {kind: "novelai-model", modelId},
        });
        for (const run of runs) {
            const terminal = await terminalizeRecipeStyle(input.resolver, run);
            result[channel].push({resolution: terminal, policyApproval: null});
        }
    }
    return result;
}

/** unknown Recipe atom 走标准 candidate/finalize 路径；review/block 仍由 Resolver fail-closed。 */
async function terminalizeRecipeStyle(resolver: IllustrationExecutionResolver, run: TagResolutionRun) {
    if (run.state === "terminal_canonical") return run.terminal;
    if (run.state !== "pending_unknown") {
        throw new IllustrationExecutionCompilerError("TEXT_TO_IMAGE_RECIPE_STYLE_INVALID", "Recipe style resolution 不是可终态化状态");
    }
    const suggested = await resolver.suggestTagReplacements({
        runId: run.runId,
        contextId: run.contextId,
        resolutionId: run.resolutionId,
        conceptQueries: [],
        limit: 8,
    });
    if (suggested.state !== "candidates_ready") {
        throw new IllustrationExecutionCompilerError("TEXT_TO_IMAGE_RECIPE_STYLE_INVALID", "Recipe style 未生成候选闭集");
    }
    const terminal = await resolver.finalizeTagResolution({
        runId: run.runId,
        contextId: run.contextId,
        resolutionId: run.resolutionId,
        candidateSetHash: suggested.candidateSet.candidateSetHash,
    });
    if (terminal.state !== "terminal_replacement" && terminal.state !== "terminal_passthrough") {
        throw new IllustrationExecutionCompilerError("TEXT_TO_IMAGE_RECIPE_STYLE_INVALID", "Recipe style 未形成 terminal resolution");
    }
    return terminal.terminal;
}

/** locale-independent code point 顺序。 */
function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

/** 只消费 ENOENT，其他文件错误保持原样。 */
function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
