import {Type, type Static} from "typebox";
import {Value} from "typebox/value";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    ILLUSTRATION_DIRECTOR_OPERATION_POLICIES,
} from "nbook/shared/agent/illustration-director";
import {
    IllustrationPlanningToolContextSchema,
    type IllustrationPlanningToolContext,
} from "nbook/shared/text-to-image-illustration-planning";
import {
    TagResolutionRunSchema,
    type TagResolutionRun,
} from "nbook/shared/text-to-image-tag-resolver";
import {getTagPatternCandidates} from "nbook/server/text-to-image/tag-pattern-retrieval";
import {TagIndexReader} from "nbook/server/text-to-image/tag-index/tag-index-reader";
import {TagIndexStore} from "nbook/server/text-to-image/tag-index/tag-index-store";
import {TagPolicyRegistryService} from "nbook/server/text-to-image/tag-index/tag-policy-registry";
import {
    TAG_RESOLVER_POLICY_VERSION,
    TAG_RESOLVER_VERSION,
    TagResolverService,
} from "nbook/server/text-to-image/tag-index/tag-resolver.service";
import {TAG_INDEX_CAPABILITY_VERSION} from "nbook/shared/text-to-image-tag-index";
import {SemanticTagResolutionSchema, type SemanticTagResolution} from "nbook/shared/text-to-image-tag-resolution";
import {defineAgentTool, type AgentToolDefinition, type ToolExecutionContext} from "nbook/server/agent/tools/types";

type ResolverPort = Pick<TagResolverService,
    "resolveTags" | "suggestTagReplacements" | "finalizeTagResolution" | "validateTagResolutions">;
type ReaderPort = Pick<TagIndexReader, "search" | "findRelated">;

export type IllustrationPlanningToolRun = {
    resolver: ResolverPort;
    reader: ReaderPort;
};

type ToolFactoryOptions = {
    readToolContext?: (context: ToolExecutionContext) => Promise<IllustrationPlanningToolContext>;
    createRun?: (input: {projectPath: string; toolContext: IllustrationPlanningToolContext}) => Promise<IllustrationPlanningToolRun>;
};

const ResolveTagsSchema = Type.Object({
    tags: Type.Array(Type.String({minLength: 1, maxLength: 500}), {minItems: 1, maxItems: 64}),
}, {additionalProperties: false});
const SuggestReplacementsSchema = Type.Object({
    resolutionId: Type.String({minLength: 1, maxLength: 160}),
    conceptQueries: Type.Array(Type.String({minLength: 1, maxLength: 120}), {minItems: 1, maxItems: 8}),
    limit: Type.Integer({minimum: 1, maximum: 8}),
}, {additionalProperties: false});
const FinalizeResolutionSchema = Type.Object({
    resolutionId: Type.String({minLength: 1, maxLength: 160}),
    candidateSetHash: Type.String({pattern: "^sha256:[a-f0-9]{64}$"}),
}, {additionalProperties: false});
const SearchTagsSchema = Type.Object({
    query: Type.String({minLength: 1, maxLength: 240}),
    category: Type.Optional(Type.Union([
        Type.Literal("general"), Type.Literal("artist"), Type.Literal("copyright"), Type.Literal("character"), Type.Literal("meta"),
    ])),
    limit: Type.Integer({minimum: 1, maximum: 8}),
}, {additionalProperties: false});
const RelatedTagsSchema = Type.Object({
    canonicalName: Type.String({minLength: 1, maxLength: 170}),
    limit: Type.Integer({minimum: 1, maximum: 8}),
}, {additionalProperties: false});
const ValidateResolutionsSchema = Type.Object({
    resolutionIds: Type.Array(Type.String({minLength: 1, maxLength: 160}), {minItems: 1, maxItems: 16}),
}, {additionalProperties: false});
const PatternIntentFilterSchema = Type.Partial(Type.Object({
    scene: Type.String({minLength: 1, maxLength: 160}),
    composition: Type.String({minLength: 1, maxLength: 160}),
    lighting: Type.String({minLength: 1, maxLength: 160}),
    action: Type.String({minLength: 1, maxLength: 160}),
}, {additionalProperties: false}));
const SearchPatternsSchema = Type.Object({
    query: Type.String({minLength: 1, maxLength: 500}),
    intent: Type.Optional(PatternIntentFilterSchema),
    applicability: Type.Optional(Type.Object({
        characterCount: Type.Optional(Type.Integer({minimum: 0, maximum: 32})),
        canvasIntent: Type.Optional(Type.Union([Type.Literal("portrait"), Type.Literal("landscape"), Type.Literal("square"), Type.Literal("character-showcase")])),
        ratingScope: Type.Optional(Type.Union([Type.Literal("general"), Type.Literal("sensitive"), Type.Literal("questionable"), Type.Literal("explicit")])),
    }, {additionalProperties: false})),
    limit: Type.Integer({minimum: 1, maximum: 8}),
}, {additionalProperties: false});
const GetPatternsSchema = Type.Object({
    patternIds: Type.Array(Type.String({minLength: 1, maxLength: 160}), {minItems: 1, maxItems: 5}),
}, {additionalProperties: false});

type ResolveTagsInput = Static<typeof ResolveTagsSchema>;
type SuggestReplacementsInput = Static<typeof SuggestReplacementsSchema>;
type FinalizeResolutionInput = Static<typeof FinalizeResolutionSchema>;
type SearchTagsInput = Static<typeof SearchTagsSchema>;
type RelatedTagsInput = Static<typeof RelatedTagsSchema>;
type ValidateResolutionsInput = Static<typeof ValidateResolutionsSchema>;
type SearchPatternsInput = Static<typeof SearchPatternsSchema>;
type GetPatternsInput = Static<typeof GetPatternsSchema>;

type ActiveToolRun = {
    toolContext: IllustrationPlanningToolContext;
    contextHash: string;
    run: IllustrationPlanningToolRun;
    resolutions: Map<string, TagResolutionRun>;
    calls: Array<{toolKey: string; argsJson: string; argsHash: string; resultJson: string; resultHash: string}>;
    callCount: number;
};

const activePlanningToolRuns = new Map<string, Promise<ActiveToolRun>>();

/** scheduler 在 Agent 完成后读取当前 invocation 的 terminal refs；pending/candidate 永不返回。 */
export async function readIllustrationPlanningToolEvidence(invocationId: string): Promise<{
    calls: Array<{toolKey: string; argsJson: string; argsHash: string; resultJson: string; resultHash: string}>;
    terminalResolutions: Array<{resolutionId: string; resolution: SemanticTagResolution}>;
}> {
    const pending = activePlanningToolRuns.get(invocationId);
    if (!pending) return {calls: [], terminalResolutions: []};
    const active = await pending;
    return {
        calls: active.calls.map((call) => ({...call})),
        terminalResolutions: [...active.resolutions.values()].flatMap((item) => "terminal" in item ? [{
            resolutionId: item.resolutionId,
            resolution: SemanticTagResolutionSchema.parse(item.terminal),
        }] : []),
    };
}

/** attempt 结束后释放 in-memory run-scoped Resolver，不允许跨 attempt 复用。 */
export function releaseIllustrationPlanningToolEvidence(invocationId: string): void {
    activePlanningToolRuns.delete(invocationId);
}

/** 构造 illustration.director plan operation 的八项只读窄工具。 */
export function createIllustrationPlanningAgentToolDefinitions(options: ToolFactoryOptions = {}): AgentToolDefinition[] {
    const readToolContext = options.readToolContext ?? readPlanningToolContext;
    const createRun = options.createRun ?? createProductionRun;
    const activeRuns = new Map<string, Promise<ActiveToolRun>>();

    const useRun = async (context: ToolExecutionContext): Promise<ActiveToolRun> => {
        const invocationKey = context.invocationId ?? `session-${String(context.sessionId)}`;
        const toolContext = IllustrationPlanningToolContextSchema.parse(await readToolContext(context));
        const contextHash = hashTextToImageContract(toolContext);
        const existing = activeRuns.get(invocationKey);
        if (existing) {
            const run = await existing;
            if (run.contextHash !== contextHash) throw new Error("ILLUSTRATION_PLANNING_CONTEXT_STALE");
            consumeBudget(run);
            return run;
        }
        if (!context.projectPath) throw new Error("ILLUSTRATION_PLANNING_PROJECT_REQUIRED");
        const pending = createRun({projectPath: context.projectPath, toolContext}).then((run): ActiveToolRun => ({
            toolContext,
            contextHash,
            run,
            resolutions: new Map(),
            calls: [],
            callCount: 1,
        }));
        activeRuns.set(invocationKey, pending);
        activePlanningToolRuns.set(invocationKey, pending);
        if (activeRuns.size > 1024) activeRuns.delete(activeRuns.keys().next().value ?? "");
        return pending;
    };

    return [
        defineAgentTool({
            key: "resolve_tags",
            name: "resolve_tags",
            label: "Resolve Tags",
            description: "Resolve 1-64 semantic Tag atoms against the active official index. Exact/alias returns terminal refs; unknown atoms remain pending and expose no candidate until suggest_tag_replacements.",
            parameters: ResolveTagsSchema,
            validationSchema: ResolveTagsSchema,
            executionMode: "sequential",
            async executeWithContext(context, _toolCallId, params, _userInput?, _signal?, _onUpdate?) {
                const input = Value.Parse(ResolveTagsSchema, params) as ResolveTagsInput;
                const active = await useRun(context);
                const items = await active.run.resolver.resolveTags({
                    runId: active.toolContext.runId,
                    contextId: active.toolContext.contextId,
                    tags: input.tags,
                    modelScope: active.toolContext.modelScope,
                });
                items.forEach((item) => active.resolutions.set(item.resolutionId, TagResolutionRunSchema.parse(item)));
                recordToolCall(active, "resolve_tags", input, {items});
                return toolJson({items}, {count: items.length});
            },
        }),
        defineAgentTool({
            key: "suggest_tag_replacements",
            name: "suggest_tag_replacements",
            label: "Suggest Tag Replacements",
            description: "Request at most eight deterministic official candidates for one pending resolution. Candidate IDs are not terminal DTO refs.",
            parameters: SuggestReplacementsSchema,
            validationSchema: SuggestReplacementsSchema,
            executionMode: "sequential",
            async executeWithContext(context, _toolCallId, params, _userInput?, _signal?, _onUpdate?) {
                const input = Value.Parse(SuggestReplacementsSchema, params) as SuggestReplacementsInput;
                const active = await useRun(context);
                const item = TagResolutionRunSchema.parse(await active.run.resolver.suggestTagReplacements({
                    runId: active.toolContext.runId,
                    contextId: active.toolContext.contextId,
                    resolutionId: input.resolutionId,
                    conceptQueries: input.conceptQueries,
                    limit: input.limit,
                }));
                active.resolutions.set(item.resolutionId, item);
                recordToolCall(active, "suggest_tag_replacements", input, {item});
                return toolJson({item}, {resolutionId: item.resolutionId, state: item.state});
            },
        }),
        defineAgentTool({
            key: "finalize_tag_resolution",
            name: "finalize_tag_resolution",
            label: "Finalize Tag Resolution",
            description: "Finalize one frozen candidate set. The server chooses reliable replacement or controlled passthrough; the Agent cannot select a candidateTagId.",
            parameters: FinalizeResolutionSchema,
            validationSchema: FinalizeResolutionSchema,
            executionMode: "sequential",
            async executeWithContext(context, _toolCallId, params, _userInput?, _signal?, _onUpdate?) {
                const input = Value.Parse(FinalizeResolutionSchema, params) as FinalizeResolutionInput;
                const active = await useRun(context);
                const item = TagResolutionRunSchema.parse(await active.run.resolver.finalizeTagResolution({
                    runId: active.toolContext.runId,
                    contextId: active.toolContext.contextId,
                    resolutionId: input.resolutionId,
                    candidateSetHash: input.candidateSetHash,
                }));
                active.resolutions.set(item.resolutionId, item);
                recordToolCall(active, "finalize_tag_resolution", input, {item});
                return toolJson({item}, {resolutionId: item.resolutionId, state: item.state});
            },
        }),
        defineAgentTool({
            key: "search_tags",
            name: "search_tags",
            label: "Search Tags",
            description: "Search the active official Tag index with exact quality before usage-tier tie-breaks. Results are read-only facts, not terminal resolution refs.",
            parameters: SearchTagsSchema,
            validationSchema: SearchTagsSchema,
            executionMode: "parallel",
            async executeWithContext(context, _toolCallId, params, _userInput?, _signal?, _onUpdate?) {
                const input = Value.Parse(SearchTagsSchema, params) as SearchTagsInput;
                const active = await useRun(context);
                const result = await active.run.reader.search(input);
                recordToolCall(active, "search_tags", input, result);
                return toolJson(result, {query: input.query});
            },
        }),
        defineAgentTool({
            key: "related_tags",
            name: "related_tags",
            label: "Related Tags",
            description: "Read bounded official implication facts for one canonical Tag. Auxiliary endpoints never become selectable main candidates.",
            parameters: RelatedTagsSchema,
            validationSchema: RelatedTagsSchema,
            executionMode: "parallel",
            async executeWithContext(context, _toolCallId, params, _userInput?, _signal?, _onUpdate?) {
                const input = Value.Parse(RelatedTagsSchema, params) as RelatedTagsInput;
                const active = await useRun(context);
                const result = await active.run.reader.findRelated(input.canonicalName, input.limit);
                recordToolCall(active, "related_tags", input, result);
                return toolJson(result, {canonicalName: input.canonicalName});
            },
        }),
        defineAgentTool({
            key: "validate_tag_resolutions",
            name: "validate_tag_resolutions",
            label: "Validate Tag Resolutions",
            description: "Validate only terminal resolution IDs created in this planning run. Pending and candidate IDs are rejected.",
            parameters: ValidateResolutionsSchema,
            validationSchema: ValidateResolutionsSchema,
            executionMode: "sequential",
            async executeWithContext(context, _toolCallId, params, _userInput?, _signal?, _onUpdate?) {
                const input = Value.Parse(ValidateResolutionsSchema, params) as ValidateResolutionsInput;
                if (new Set(input.resolutionIds).size !== input.resolutionIds.length) throw new Error("TAG_RESOLUTION_INVALID: resolutionId 不能重复");
                const active = await useRun(context);
                const runs = input.resolutionIds.map((resolutionId) => {
                    const item = active.resolutions.get(resolutionId);
                    if (!item || !("terminal" in item)) throw new Error(`TAG_RESOLUTION_INVALID: ${resolutionId} 不是当前 run 的 terminal ref`);
                    return item;
                });
                const first = runs[0]!.terminal;
                const validated = await active.run.resolver.validateTagResolutions({
                    contextId: active.toolContext.contextId,
                    targetScope: active.toolContext.modelScope,
                    resolutions: runs.map((item) => item.terminal),
                    policyApprovals: runs.map(() => null),
                    indexVersion: first.indexVersion,
                    policyVersion: first.policyVersion,
                    resolverPolicyVersion: first.resolverPolicyVersion,
                    capabilityVersion: first.capabilityVersion,
                });
                const result = {
                    validationHash: validated.validationHash,
                    items: runs.map((item) => ({resolutionId: item.resolutionId, state: item.state, terminal: item.terminal})),
                };
                recordToolCall(active, "validate_tag_resolutions", input, result);
                return toolJson(result, {count: runs.length, validationHash: validated.validationHash});
            },
        }),
        defineAgentTool({
            key: "search_tag_patterns",
            name: "search_tag_patterns",
            label: "Search Tag Patterns",
            description: "Search only the 3-8 Pattern candidates frozen in the Planning Input Bundle. It cannot expand the candidate closure.",
            parameters: SearchPatternsSchema,
            validationSchema: SearchPatternsSchema,
            executionMode: "parallel",
            async executeWithContext(context, _toolCallId, params, _userInput?, _signal?, _onUpdate?) {
                const input = Value.Parse(SearchPatternsSchema, params) as SearchPatternsInput;
                const active = await useRun(context);
                const terms = normalizeSearch(input.query).split(" ").filter(Boolean);
                const candidates = active.toolContext.patternCandidates.candidates.filter((candidate) => {
                    const haystack = normalizeSearch([candidate.patternId, ...Object.values(candidate.intent)].join(" "));
                    if (!terms.every((term) => haystack.includes(term))) return false;
                    if (input.intent && Object.entries(input.intent).some(([key, value]) => candidate.intent[key as keyof typeof candidate.intent] !== value)) return false;
                    const applicability = input.applicability;
                    if (applicability?.characterCount !== undefined
                        && (applicability.characterCount < candidate.applicability.characterCount.min || applicability.characterCount > candidate.applicability.characterCount.max)) return false;
                    if (applicability?.canvasIntent && candidate.applicability.canvasIntents.length > 0
                        && !candidate.applicability.canvasIntents.includes(applicability.canvasIntent)) return false;
                    if (applicability?.ratingScope && !candidate.applicability.ratingScopes.includes(applicability.ratingScope)) return false;
                    return true;
                }).slice(0, input.limit);
                const result = {
                    candidateSetHash: active.toolContext.patternCandidates.candidateSetHash,
                    candidates,
                };
                recordToolCall(active, "search_tag_patterns", input, result);
                return toolJson(result, {count: candidates.length});
            },
        }),
        defineAgentTool({
            key: "get_tag_patterns",
            name: "get_tag_patterns",
            label: "Get Tag Patterns",
            description: "Read at most five typed Pattern summaries by ID from the already frozen candidate closure.",
            parameters: GetPatternsSchema,
            validationSchema: GetPatternsSchema,
            executionMode: "parallel",
            async executeWithContext(context, _toolCallId, params, _userInput?, _signal?, _onUpdate?) {
                const input = Value.Parse(GetPatternsSchema, params) as GetPatternsInput;
                const active = await useRun(context);
                const candidates = getTagPatternCandidates({candidateSet: active.toolContext.patternCandidates, patternIds: input.patternIds});
                const result = {candidateSetHash: active.toolContext.patternCandidates.candidateSetHash, candidates};
                recordToolCall(active, "get_tag_patterns", input, result);
                return toolJson(result, {count: candidates.length});
            },
        }),
    ];
}

/** 全局 registry 使用的生产 runtime 构造入口。 */
export function createIllustrationPlanningAgentTools() {
    return createIllustrationPlanningAgentToolDefinitions().map((definition) => definition.runtime());
}

async function readPlanningToolContext(context: ToolExecutionContext): Promise<IllustrationPlanningToolContext> {
    const snapshot = await context.harness.repo.readSession(context.sessionId, context.workspaceKey);
    const initial = snapshot.metadata.initial;
    if (!initial || typeof initial !== "object" || Array.isArray(initial) || !("planningInput" in initial)) {
        throw new Error("ILLUSTRATION_PLANNING_CONTEXT_MISSING");
    }
    const planningInput = initial.planningInput;
    if (!planningInput || typeof planningInput !== "object" || Array.isArray(planningInput) || !("toolContext" in planningInput)) {
        throw new Error("ILLUSTRATION_PLANNING_CONTEXT_MISSING");
    }
    return IllustrationPlanningToolContextSchema.parse(planningInput.toolContext);
}

async function createProductionRun(input: {projectPath: string; toolContext: IllustrationPlanningToolContext}): Promise<IllustrationPlanningToolRun> {
    const policyRegistry = new TagPolicyRegistryService();
    const snapshot = input.toolContext.tagQuerySnapshot;
    if (snapshot.policyVersion !== policyRegistry.registry.policyVersion
        || snapshot.resolverVersion !== TAG_RESOLVER_VERSION
        || snapshot.resolverPolicyVersion !== TAG_RESOLVER_POLICY_VERSION
        || snapshot.capabilityVersion !== TAG_INDEX_CAPABILITY_VERSION) {
        throw new Error("ILLUSTRATION_PLANNING_CONTEXT_STALE: Tag/Resolver contract 已变化");
    }
    const reader = new TagIndexReader({
        root: new TagIndexStore().root,
        expected: {indexVersion: snapshot.indexVersion, manifestHash: snapshot.manifestHash},
    });
    return {
        reader,
        resolver: new TagResolverService({
            reader,
            policyRegistry,
            capabilityVersion: TAG_INDEX_CAPABILITY_VERSION,
            resolveProjectPolicy: async () => input.toolContext.tagPolicySnapshot.config,
        }),
    };
}

function consumeBudget(active: ActiveToolRun): void {
    active.callCount += 1;
    const maximum = ILLUSTRATION_DIRECTOR_OPERATION_POLICIES[active.toolContext.operation].maxToolCalls;
    if (active.callCount > maximum) throw new Error("ILLUSTRATION_PLANNING_TOOL_BUDGET_EXCEEDED");
}

function normalizeSearch(value: string): string {
    return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}._:-]+/gu, " ");
}

/** 工具 evidence 只持有 canonical JSON 的 hash，避免把候选全文复制进 Workflow row。 */
function recordToolCall(active: ActiveToolRun, toolKey: string, args: object, result: object): void {
    const argsJson = JSON.stringify(args);
    const resultJson = JSON.stringify(result);
    active.calls.push({
        toolKey,
        argsJson,
        argsHash: hashTextToImageContract({json: argsJson}),
        resultJson,
        resultHash: hashTextToImageContract({json: resultJson}),
    });
}

function toolJson(value: Record<string, unknown>, details: Record<string, unknown>) {
    return {content: [{type: "text" as const, text: JSON.stringify(value, null, 2)}], details: details as never};
}
