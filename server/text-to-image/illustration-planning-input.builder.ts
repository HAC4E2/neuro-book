import {
    ILLUSTRATION_DIRECTOR_MODEL_NOT_CONFIGURED,
    ILLUSTRATION_DIRECTOR_PLAN_OPERATION_VERSION,
    ILLUSTRATION_DIRECTOR_PROFILE_KEY,
} from "nbook/shared/agent/illustration-director";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    CHARACTER_IMAGE_TAG_FIELDS,
    OUTFIT_TAG_FIELDS,
    type CharacterImageTags,
    type OutfitTags,
} from "nbook/shared/text-to-image-character-visual";
import {
    ILLUSTRATION_CHAPTER_PARSER_VERSION,
    ILLUSTRATION_MAX_PLANNING_SUBJECTS,
    ILLUSTRATION_PLAN_VALIDATOR_VERSION,
    createIllustrationRecipePlanningConstraints,
    type IllustrationPlanningTagPolicySnapshot,
    type IllustrationPlanningTagQuerySnapshot,
} from "nbook/shared/text-to-image-illustration-planning";
import {
    IllustrationPlanningInputBundleSchema,
    IllustrationPlanningStartRequestSchema,
    createIllustrationPlanningInputHash,
    createIllustrationPlanningRequestHash,
    type IllustrationContinuityShot,
    type IllustrationPlanningInputBundle,
    type IllustrationPlanningStartRequest,
} from "nbook/shared/text-to-image-illustration-workflow";
import {TAG_PATTERN_RETRIEVAL_POLICY_VERSION} from "nbook/shared/text-to-image-tag-pattern-retrieval";
import {TAG_INDEX_CAPABILITY_VERSION} from "nbook/shared/text-to-image-tag-index";
import {useAgentHarness} from "nbook/server/agent/http";
import {loadEffectiveConfigForAgentRuntime} from "nbook/server/config/config-service";
import {resolveConfiguredModel} from "nbook/server/utils/model-settings";
import {
    IllustrationChapterParser,
    type IllustrationChapterSnapshot,
} from "nbook/server/text-to-image/illustration-chapter-parser";
import {IllustrationWorkflowRepository} from "nbook/server/text-to-image/illustration-workflow.repository";
import {TextToImageChapterService} from "nbook/server/text-to-image/chapter.service";
import {
    CharacterVisualRegistryService,
    type CharacterVisualRegistrySnapshot,
} from "nbook/server/text-to-image/character-visual-registry.service";
import {
    StoryboardPlanningSnapshotService,
    type StoryboardPlanningSnapshot,
} from "nbook/server/text-to-image/storyboard-planning-snapshot.service";
import {
    TextToImageRecipeNotConfiguredError,
    TextToImageRecipeService,
    type TextToImageRecipeDocument,
} from "nbook/server/text-to-image/recipe.service";
import {retrieveTagPatterns} from "nbook/server/text-to-image/tag-pattern-retrieval";
import {TagIndexReader} from "nbook/server/text-to-image/tag-index/tag-index-reader";
import {TagIndexStore} from "nbook/server/text-to-image/tag-index/tag-index-store";
import {TagPolicyRegistryService} from "nbook/server/text-to-image/tag-index/tag-policy-registry";
import {
    TAG_RESOLVER_POLICY_VERSION,
    TAG_RESOLVER_VERSION,
} from "nbook/server/text-to-image/tag-index/tag-resolver.service";
import {textToImageProjectClient} from "nbook/server/text-to-image/project-client";

export const ILLUSTRATION_PLANNING_SYSTEM_POLICY_VERSION = "route-b-p3-system-v1" as const;
const PLAN_POLICY_HASH = hashTextToImageContract({
    schemaVersion: "nbook.illustration-plan-policy/v1",
    maximumChapterShots: 12,
    maximumSelectionShots: 1,
    maximumSubjects: ILLUSTRATION_MAX_PLANNING_SUBJECTS,
    maximumPatternRefs: 3,
    maximumTagDeltaPerDirection: 8,
    providerKind: "novelai",
    modelScope: "generic-novelai",
});

export type IllustrationPlanningDirectorSnapshot = {
    profileVersion: string;
    operationVersion: string;
    modelConfigFingerprint: string;
};

export type IllustrationPlanningInputPorts = {
    readProjectId(projectPath: string): Promise<string>;
    readChapter(projectPath: string, chapterPath: string): Promise<{chapterPath: string; markdown: string}>;
    readPlanningRules(): Promise<StoryboardPlanningSnapshot>;
    readCharacters(projectPath: string): Promise<CharacterVisualRegistrySnapshot>;
    readRecipe(projectPath: string): Promise<TextToImageRecipeDocument>;
    readRuntimeContext(projectPath: string): Promise<{
        director: IllustrationPlanningDirectorSnapshot;
        tagPolicySnapshot: IllustrationPlanningTagPolicySnapshot;
    }>;
    readTagQuerySnapshot(): Promise<IllustrationPlanningTagQuerySnapshot>;
    readContinuityBaseline(input: {
        projectPath: string;
        projectId: string;
        chapterPath: string;
        operation: "plan-chapter" | "plan-selection" | "review-candidates";
        selectionHash: string | null;
    }): Promise<IllustrationContinuityShot[]>;
};

export type IllustrationPlanningRebuildInput = {
    projectPath: string;
    bundle: IllustrationPlanningInputBundle;
    /** 省略时沿用冻结 revision；显式传入时生成新的 replan request identity。 */
    replan?: IllustrationPlanningInputBundle["userRequest"]["replan"];
};

type IllustrationPlanningTruthRequest = {
    projectPath: string;
    chapterPath: string;
    operation: "plan-chapter" | "plan-selection" | "review-candidates";
    userIntent: string;
    replan: IllustrationPlanningInputBundle["userRequest"]["replan"];
};

type IllustrationPlanningSelection = NonNullable<IllustrationPlanningInputBundle["chapter"]["selection"]>;

/** 服务端 Planning Input 的唯一构建器；浏览器不能注入配置、事实、候选或 hash。 */
export class IllustrationPlanningInputBuilder {
    private readonly parser = new IllustrationChapterParser();

    constructor(private readonly ports: IllustrationPlanningInputPorts = createProductionPorts()) {}

    /** 同步读取已保存 Project 真相源，并生成自校验的 immutable Planning Input Bundle。 */
    async build(input: IllustrationPlanningStartRequest): Promise<IllustrationPlanningInputBundle> {
        const request = IllustrationPlanningStartRequestSchema.parse(input);
        if (request.operation === "review-candidates") {
            return this.buildReviewCandidates(request);
        }
        const chapterDocument = await this.ports.readChapter(request.projectPath, request.chapterPath);
        const chapter = this.parser.parse({chapterPath: chapterDocument.chapterPath, markdown: chapterDocument.markdown});
        if (chapter.chapterPath !== request.chapterPath || chapter.anchorCandidates.length === 0) {
            throw new IllustrationPlanningInputError("ILLUSTRATION_CHAPTER_EMPTY", "已保存章节没有可用的顶层正文锚点");
        }
        const selection = request.operation === "plan-selection" ? this.parser.select(chapter, request.selection) : null;
        return this.freeze(request, chapter, selection);
    }

    /**
     * 仅从冻结请求语义与当前服务端真相源重建输入；不会接受浏览器 hash 或配置。
     * selection 的语义快照只有在章节原始字节完全一致时才可复用，否则立即 stale。
     */
    async rebuild(input: IllustrationPlanningRebuildInput): Promise<IllustrationPlanningInputBundle> {
        const bundle = IllustrationPlanningInputBundleSchema.parse(input.bundle);
        const chapterDocument = await this.ports.readChapter(input.projectPath, bundle.requestIdentity.chapterPath);
        const chapter = this.parser.parse({chapterPath: chapterDocument.chapterPath, markdown: chapterDocument.markdown});
        if (chapter.chapterPath !== bundle.requestIdentity.chapterPath || chapter.anchorCandidates.length === 0) {
            throw new IllustrationPlanningInputError("ILLUSTRATION_CHAPTER_EMPTY", "已保存章节没有可用的顶层正文锚点");
        }
        let selection: IllustrationPlanningSelection | null = null;
        if (bundle.requestIdentity.operation === "plan-selection") {
            if (chapter.chapterFileHash !== bundle.chapter.chapterFileHash || !bundle.chapter.selection) {
                throw new IllustrationPlanningInputError("ILLUSTRATION_WORKFLOW_STALE", "选区所属章节已变化，不能复用旧选区语义");
            }
            const anchorIds = new Set(chapter.anchorCandidates.map((candidate) => candidate.anchorId));
            const frozen = bundle.chapter.selection;
            if (!anchorIds.has(frozen.startAnchorId) || !anchorIds.has(frozen.endAnchorId) || !anchorIds.has(frozen.insertAfterAnchorId)) {
                throw new IllustrationPlanningInputError("ILLUSTRATION_WORKFLOW_STALE", "选区锚点已不再属于当前 parser 闭集");
            }
            selection = frozen;
        }
        return this.freeze({
            projectPath: input.projectPath,
            chapterPath: bundle.requestIdentity.chapterPath,
            operation: bundle.requestIdentity.operation,
            userIntent: bundle.userRequest.intent,
            replan: input.replan === undefined ? bundle.userRequest.replan : input.replan,
        }, chapter, selection);
    }

    /** 以已经过服务端定位的章节/选区为闭集，读取其余当前真相源并冻结完整 bundle。 */
    private async freeze(
        request: IllustrationPlanningTruthRequest,
        chapter: IllustrationChapterSnapshot,
        selection: IllustrationPlanningSelection | null,
    ): Promise<IllustrationPlanningInputBundle> {
        const [projectId, planningRules, characters, recipe, runtimeContext, tagQuerySnapshot] = await Promise.all([
            this.ports.readProjectId(request.projectPath),
            this.ports.readPlanningRules(),
            this.ports.readCharacters(request.projectPath),
            this.ports.readRecipe(request.projectPath),
            this.ports.readRuntimeContext(request.projectPath),
            this.ports.readTagQuerySnapshot(),
        ]);
        if (!recipe.exists) throw new TextToImageRecipeNotConfiguredError();
        if (tagQuerySnapshot.capabilityVersion !== TAG_INDEX_CAPABILITY_VERSION) {
            throw new IllustrationPlanningInputError("ILLUSTRATION_TAG_INDEX_STALE", "active Tag index capability 与当前运行时不一致");
        }
        const continuityBaseline = await this.ports.readContinuityBaseline({
            projectPath: request.projectPath,
            projectId,
            chapterPath: request.chapterPath,
            operation: request.operation,
            selectionHash: selection?.selectionHash ?? null,
        });
        const characterCandidates = characters.characters.map((entry) => ({
            characterId: entry.character.characterId,
            names: characterNames(entry.character),
            visualPlanningFactsHash: entry.hashes.visualPlanningFactsHash,
            facts: CHARACTER_IMAGE_TAG_FIELDS.flatMap((field) => {
                const values = entry.character.fields[field].map((key) => entry.character.tagResolutions[key]!.sourceText);
                return values.length > 0 ? [{field, values}] : [];
            }),
            outfits: entry.outfits.map((outfit) => ({
                outfitRef: outfit.path,
                names: outfitNames(outfit.outfit),
                visualPlanningFactsHash: outfit.hashes.visualPlanningFactsHash,
                facts: OUTFIT_TAG_FIELDS.flatMap((field) => {
                    const values = outfit.outfit.fields[field].map((key) => outfit.outfit.tagResolutions[key]!.sourceText);
                    return values.length > 0 ? [{field, values}] : [];
                }),
            })),
        }));
        const recipePlanningConstraints = createIllustrationRecipePlanningConstraints(recipe.snapshot);
        const allowedCanvasIntents = recipePlanningConstraints.allowedCanvasIntents;
        const continuityBaselineHash = hashTextToImageContract({
            schemaVersion: "nbook.illustration-continuity-baseline/v1",
            shots: continuityBaseline,
        });
        const requestIdentity = {
            schemaVersion: "nbook.illustration-planning-request/v1" as const,
            projectId,
            chapterPath: request.chapterPath,
            operation: request.operation,
            sourceChapterHash: chapter.sourceChapterHash,
            selectionHash: selection?.selectionHash ?? null,
            userIntent: request.userIntent,
            replan: request.replan,
            effectivePresetSemanticHash: planningRules.preset.semanticHash,
            effectivePatternPlanningHash: planningRules.patterns.planningHash,
            visualPlanningFactsHash: characters.visualPlanningFactsHash,
            recipePlanningConstraintsHash: recipePlanningConstraints.constraintsHash,
            continuityBaselineHash,
            tagIndex: {indexVersion: tagQuerySnapshot.indexVersion, manifestHash: tagQuerySnapshot.manifestHash},
            tagPolicy: {
                policyVersion: tagQuerySnapshot.policyVersion,
                projectScopeHash: runtimeContext.tagPolicySnapshot.projectScopeHash,
            },
            resolverVersion: tagQuerySnapshot.resolverVersion,
            resolverPolicyVersion: tagQuerySnapshot.resolverPolicyVersion,
            patternRetrievalPolicyVersion: TAG_PATTERN_RETRIEVAL_POLICY_VERSION,
            planPolicyHash: PLAN_POLICY_HASH,
            contentBlockParserVersion: ILLUSTRATION_CHAPTER_PARSER_VERSION,
            directorProfileVersion: runtimeContext.director.profileVersion,
            directorOperationVersion: runtimeContext.director.operationVersion,
            modelConfigFingerprint: runtimeContext.director.modelConfigFingerprint,
            systemPolicyVersion: ILLUSTRATION_PLANNING_SYSTEM_POLICY_VERSION,
            planValidatorVersion: ILLUSTRATION_PLAN_VALIDATOR_VERSION,
        };
        const planningRequestHash = createIllustrationPlanningRequestHash(requestIdentity);
        const planningText = normalizePlanningQuery([
            request.userIntent,
            selection?.selectedText ?? chapter.anchorCandidates.map((block) => block.normalizedText).join(" "),
        ].join(" "));
        const mentionedCharacterCount = characterCandidates.filter((character) => character.names.some((name) => planningText.includes(name.normalize("NFKC")))).length;
        const patternCandidates = retrieveTagPatterns({
            effectivePlanningHash: planningRules.patterns.planningHash,
            patterns: planningRules.patterns.patterns,
            provenance: planningRules.patterns.provenance,
            request: {
                query: planningText,
                applicability: {
                    characterCount: Math.min(mentionedCharacterCount, 32),
                    canvasIntent: allowedCanvasIntents.length === 1 ? allowedCanvasIntents.at(0) ?? null : null,
                    ratingScope: "general",
                    providerKind: "novelai",
                    modelScope: {kind: "generic-novelai"},
                },
                limit: 8,
            },
        });
        const chapterSelection = selection ? {
            selectedText: selection.selectedText,
            selectedTextHash: selection.selectedTextHash,
            selectionHash: selection.selectionHash,
            startAnchorId: selection.startAnchorId,
            endAnchorId: selection.endAnchorId,
            insertAfterAnchorId: selection.insertAfterAnchorId,
            startBlockOffset: selection.startBlockOffset,
            endBlockOffset: selection.endBlockOffset,
            contextBefore: selection.contextBefore.map(toBundleAnchor),
            contextAfter: selection.contextAfter.map(toBundleAnchor),
        } : null;
        const toolContext = {
            operation: request.operation,
            runId: `planning-${planningRequestHash.slice("sha256:".length, "sha256:".length + 32)}`,
            contextId: projectId,
            modelScope: {kind: "generic-novelai" as const},
            patternCandidates,
            tagQuerySnapshot,
            tagPolicySnapshot: runtimeContext.tagPolicySnapshot,
        };
        const draft = {
            schemaVersion: "nbook.illustration-planning-input/v1" as const,
            requestIdentity,
            planningRequestHash,
            chapter: {
                chapterFileHash: chapter.chapterFileHash,
                sourceChapterHash: chapter.sourceChapterHash,
                blocks: chapter.anchorCandidates.map(toBundleAnchor),
                selection: chapterSelection,
            },
            characters: characterCandidates,
            continuityBaseline,
            effectivePreset: {
                presetId: planningRules.preset.presetId,
                semanticHash: planningRules.preset.semanticHash,
                rules: planningRules.preset.rules,
            },
            patternCandidates,
            recipePlanningConstraints,
            tagQuerySnapshot,
            tagPolicySnapshot: runtimeContext.tagPolicySnapshot,
            userRequest: {intent: request.userIntent, replan: request.replan},
            toolContext,
        };
        return IllustrationPlanningInputBundleSchema.parse({
            ...draft,
            planningInputHash: createIllustrationPlanningInputHash(draft),
        });
    }

    /** P6：构建 review-candidates 的极简 Input Bundle——只要章节 Markdown 与基本 identity，不要 tag/character/pattern。 */
    private async buildReviewCandidates(
        request: IllustrationPlanningStartRequest & {operation: "review-candidates"},
    ): Promise<IllustrationPlanningInputBundle> {
        const chapterDocument = await this.ports.readChapter(request.projectPath, request.chapterPath);
        const partial = new IllustrationChapterParser().parse({
            chapterPath: chapterDocument.chapterPath,
            markdown: chapterDocument.markdown,
        });
        const projectId = await this.ports.readProjectId(request.projectPath);
        const runtimeContext = await this.ports.readRuntimeContext(request.projectPath);
        const tagQuerySnapshot = await this.ports.readTagQuerySnapshot();
        const requestIdentity = {
            schemaVersion: "nbook.illustration-planning-request/v1" as const,
            projectId,
            chapterPath: request.chapterPath,
            operation: "review-candidates" as const,
            sourceChapterHash: partial.sourceChapterHash,
            selectionHash: null,
            userIntent: request.userIntent,
            replan: request.replan,
            effectivePresetSemanticHash: hashTextToImageContract({stub: true}),
            effectivePatternPlanningHash: hashTextToImageContract({stub: true}),
            visualPlanningFactsHash: hashTextToImageContract({stub: true}),
            recipePlanningConstraintsHash: hashTextToImageContract({stub: true}),
            continuityBaselineHash: hashTextToImageContract({stub: true}),
            tagIndex: {indexVersion: tagQuerySnapshot.indexVersion, manifestHash: tagQuerySnapshot.manifestHash},
            tagPolicy: {policyVersion: tagQuerySnapshot.policyVersion, projectScopeHash: runtimeContext.tagPolicySnapshot.projectScopeHash},
            resolverVersion: tagQuerySnapshot.resolverVersion,
            resolverPolicyVersion: tagQuerySnapshot.resolverPolicyVersion,
            patternRetrievalPolicyVersion: TAG_PATTERN_RETRIEVAL_POLICY_VERSION,
            planPolicyHash: PLAN_POLICY_HASH,
            contentBlockParserVersion: ILLUSTRATION_CHAPTER_PARSER_VERSION,
            directorProfileVersion: runtimeContext.director.profileVersion,
            directorOperationVersion: runtimeContext.director.operationVersion,
            modelConfigFingerprint: runtimeContext.director.modelConfigFingerprint,
            systemPolicyVersion: ILLUSTRATION_PLANNING_SYSTEM_POLICY_VERSION,
            planValidatorVersion: ILLUSTRATION_PLAN_VALIDATOR_VERSION,
        };
        const planningRequestHash = createIllustrationPlanningRequestHash(requestIdentity);
        const stubPatternCandidates = {
            schemaVersion: "nbook.tag-pattern-candidate-set/v1" as const,
            retrievalPolicyVersion: TAG_PATTERN_RETRIEVAL_POLICY_VERSION,
            effectivePlanningHash: hashTextToImageContract({stub: true}),
            requestHash: hashTextToImageContract({stub: true}),
            candidateSetHash: hashTextToImageContract({stub: true}),
            candidates: [] as Array<never>,
        };
        const toolContext = {
            operation: "review-candidates" as const,
            runId: `review-${planningRequestHash.slice("sha256:".length, "sha256:".length + 32)}`,
            contextId: request.chapterPath,
            modelScope: {kind: "generic-novelai" as const},
            patternCandidates: stubPatternCandidates,
            tagQuerySnapshot,
            tagPolicySnapshot: runtimeContext.tagPolicySnapshot,
        };
        const draft: Omit<IllustrationPlanningInputBundle, "planningInputHash"> & {planningInputHash?: string} = {
            schemaVersion: "nbook.illustration-planning-input/v1" as const,
            requestIdentity,
            planningRequestHash,
            chapter: {
                chapterFileHash: partial.chapterFileHash,
                sourceChapterHash: partial.sourceChapterHash,
                blocks: partial.anchorCandidates.map(toBundleAnchor),
                selection: null,
            },
            characters: [],
            continuityBaseline: [],
            effectivePreset: {presetId: "review-candidates-stub", semanticHash: hashTextToImageContract({stub: true}), rules: []},
            patternCandidates: stubPatternCandidates,
            recipePlanningConstraints: {constraintsHash: hashTextToImageContract({stub: true}), allowedCanvasIntents: ["portrait", "landscape", "square"], maxSubjects: ILLUSTRATION_MAX_PLANNING_SUBJECTS},
            tagQuerySnapshot,
            tagPolicySnapshot: runtimeContext.tagPolicySnapshot,
            userRequest: {intent: request.userIntent, replan: request.replan},
            toolContext,
        };
        return IllustrationPlanningInputBundleSchema.parse({
            ...draft,
            planningInputHash: createIllustrationPlanningInputHash(draft),
        });
    }
}

export class IllustrationPlanningInputError extends Error {
    constructor(readonly code: "ILLUSTRATION_CHAPTER_EMPTY" | "ILLUSTRATION_PROJECT_ID_MISSING" | "ILLUSTRATION_TAG_INDEX_STALE" | "ILLUSTRATION_DIRECTOR_MODEL_NOT_CONFIGURED" | "ILLUSTRATION_WORKFLOW_STALE", message: string) {
        super(`${code}: ${message}`);
        this.name = "IllustrationPlanningInputError";
    }
}

/** 生产端口只读取既有真相源；唯一数据库写入是独立 Workflow repository 的 start/upsert。 */
function createProductionPorts(): IllustrationPlanningInputPorts {
    const chapters = new TextToImageChapterService();
    const planningRules = new StoryboardPlanningSnapshotService();
    const characters = new CharacterVisualRegistryService();
    const recipes = new TextToImageRecipeService();
    const tagReader = new TagIndexReader({root: new TagIndexStore().root});
    return {
        async readProjectId(projectPath) {
            const client = await textToImageProjectClient(projectPath);
            const metadata = await client.projectMetadata.findUnique({where: {key: "projectId"}});
            if (!metadata) throw new IllustrationPlanningInputError("ILLUSTRATION_PROJECT_ID_MISSING", "Project 数据库缺少可移植 projectId，请重新打开 Project 完成迁移");
            return metadata.value;
        },
        async readChapter(projectPath, chapterPath) {
            const snapshot = await chapters.snapshot(projectPath, chapterPath);
            return {chapterPath: snapshot.chapterPath, markdown: snapshot.markdown};
        },
        readPlanningRules: async () => planningRules.read(),
        readCharacters: async (projectPath) => characters.read({projectPath}),
        readRecipe: async (projectPath) => recipes.read(projectPath),
        async readRuntimeContext(projectPath) {
            const effective = await loadEffectiveConfigForAgentRuntime({projectPath});
            const profileConfig = effective.agent.profiles[ILLUSTRATION_DIRECTOR_PROFILE_KEY];
            const modelKey = profileConfig?.model.modelKey ?? null;
            const resolved = resolveConfiguredModel(effective.models, modelKey);
            if (!profileConfig || !resolved) {
                throw new IllustrationPlanningInputError(
                    ILLUSTRATION_DIRECTOR_MODEL_NOT_CONFIGURED,
                    "请先在设置 → 模型配置中配置 illustration.director",
                );
            }
            const profile = await useAgentHarness().profiles.get(ILLUSTRATION_DIRECTOR_PROFILE_KEY);
            const tagPolicyConfig = effective.illustration.tagPolicy;
            return {
                director: {
                    profileVersion: String(profile.manifest.version ?? 1),
                    operationVersion: ILLUSTRATION_DIRECTOR_PLAN_OPERATION_VERSION,
                    modelConfigFingerprint: hashTextToImageContract({
                        bindingId: ILLUSTRATION_DIRECTOR_PROFILE_KEY,
                        modelKey,
                        providerId: resolved.providerId,
                        provider: {name: resolved.provider.name, modelApi: resolved.provider.modelApi, enabled: resolved.provider.enabled},
                        endpoint: resolved.provider.options.baseURL,
                        model: {
                            id: resolved.model.id,
                            name: resolved.model.name,
                            api: resolved.model.api,
                            // provider 字段已从 ConfiguredModelConfig 移除
                            reasoning: resolved.model.reasoning,
                            input: resolved.model.input,
                            maxTokens: resolved.model.maxTokens,
                            contextWindowTokens: resolved.model.contextWindowTokens,
                        },
                        profileModel: profileConfig.model,
                    }),
                },
                tagPolicySnapshot: {
                    config: tagPolicyConfig,
                    projectScopeHash: hashTextToImageContract(tagPolicyConfig),
                },
            };
        },
        async readTagQuerySnapshot() {
            const context = await tagReader.readActiveContext();
            const policy = new TagPolicyRegistryService();
            return {
                indexVersion: context.manifest.indexVersion,
                manifestHash: context.manifestHash,
                policyVersion: policy.registry.policyVersion,
                resolverVersion: TAG_RESOLVER_VERSION,
                resolverPolicyVersion: TAG_RESOLVER_POLICY_VERSION,
                capabilityVersion: context.manifest.capabilityVersion,
            };
        },
        async readContinuityBaseline(input) {
            const client = await textToImageProjectClient(input.projectPath);
            return new IllustrationWorkflowRepository(client).readContinuityBaseline(input);
        },
    };
}

function characterNames(character: CharacterImageTags): string[] {
    return uniqueText([character.names.cn, ...character.names.aliasesCn, character.names.en]);
}

function outfitNames(outfit: OutfitTags): string[] {
    return uniqueText([outfit.names.cn, outfit.names.en]);
}

function uniqueText(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizePlanningQuery(value: string): string {
    const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
    return Array.from(normalized).slice(0, 500).join("");
}

function toBundleAnchor(anchor: {anchorId: string; kind: "paragraph" | "heading" | "list" | "blockquote"; normalizedText: string; textHash: string}) {
    return {anchorId: anchor.anchorId, kind: anchor.kind, normalizedText: anchor.normalizedText, textHash: anchor.textHash};
}
