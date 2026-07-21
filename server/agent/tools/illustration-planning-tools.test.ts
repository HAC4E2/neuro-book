import {describe, expect, it, vi} from "vitest";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {
    createIllustrationPlanningAgentToolDefinitions,
    type IllustrationPlanningToolRun,
} from "nbook/server/agent/tools/illustration-planning-tools";
import type {IllustrationPlanningToolContext} from "nbook/shared/text-to-image-illustration-planning";
import type {TextToImageModelScope} from "nbook/shared/text-to-image-tag-resolution";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";

const HASH = `sha256:${"a".repeat(64)}`;

function toolContext(): IllustrationPlanningToolContext {
    const tagPolicyConfig = {contentScope: "general" as const, unknownTagPolicy: "provider_passthrough" as const};
    return {
        operation: "plan-chapter",
        runId: "workflow-1",
        contextId: "project-1",
        modelScope: {kind: "generic-novelai"},
        patternCandidates: {
            schemaVersion: "nbook.tag-pattern-candidate-set/v1",
            retrievalPolicyVersion: "nbook-pattern-retrieval-v1",
            effectivePlanningHash: HASH,
            requestHash: HASH,
            candidateSetHash: HASH,
            candidates: [{
                patternId: "harbor-dawn",
                sourceEntryId: null,
                order: 1,
                intent: {scene: "harbor", composition: "wide", lighting: "dawn", action: "observe"},
                applicability: {
                    characterCount: {min: 0, max: 3},
                    canvasIntents: ["landscape"],
                    ratingScopes: ["general"],
                    providerKinds: ["novelai"],
                    modelScopes: [{kind: "generic-novelai"}],
                },
                resolutionRefs: {
                    positive: {scene: [], composition: [], lighting: [], action: []},
                    negative: {global: [], characters: []},
                },
                provenance: {scope: "base", operation: "base", sourceEntryId: null},
                match: {score: 100, reasons: ["trigger_any"]},
            }],
        },
        tagQuerySnapshot: {
            indexVersion: "v1",
            manifestHash: HASH,
            policyVersion: "policy-v1",
            resolverVersion: "resolver-v1",
            resolverPolicyVersion: "resolver-policy-v1",
            capabilityVersion: "cap-v1",
        },
        tagPolicySnapshot: {config: tagPolicyConfig, projectScopeHash: hashTextToImageContract(tagPolicyConfig)},
    };
}

function planningRun(): IllustrationPlanningToolRun {
    return {
        resolver: {
            resolveTags: vi.fn(async (input: {runId: string; contextId: string; tags: string[]; modelScope: TextToImageModelScope}) => input.tags.map((sourceText, index) => ({
                schemaVersion: "nbook.tag-resolution-run/v1" as const,
                state: "pending_unknown" as const,
                runId: input.runId,
                resolutionId: `resolution-${String(index + 1)}`,
                contextId: input.contextId,
                sourceText,
                modelScope: input.modelScope,
                createdAt: "2026-07-20T00:00:00.000Z",
                updatedAt: "2026-07-20T00:00:00.000Z",
            }))),
            suggestTagReplacements: vi.fn(async () => { throw new Error("not used"); }),
            finalizeTagResolution: vi.fn(async () => { throw new Error("not used"); }),
            validateTagResolutions: vi.fn(async () => { throw new Error("not used"); }),
        },
        reader: {
            search: vi.fn(async () => ({candidates: [], evidence: {indexVersion: "v1", manifestHash: HASH, queriedTiers: [], candidateSetHash: HASH}})),
            findRelated: vi.fn(async () => ({relations: [], evidence: {indexVersion: "v1", manifestHash: HASH, queriedTiers: [], candidateSetHash: HASH}})),
        },
    };
}

function executionContext(invocationId = "invocation-1"): ToolExecutionContext {
    return {invocationId, projectPath: "workspace/demo"} as ToolExecutionContext;
}

function parseResult(result: Awaited<ReturnType<NonNullable<ReturnType<typeof createIllustrationPlanningAgentToolDefinitions>[number]["executeWithContext"]>>>) {
    const block = result.content[0];
    if (!block || block.type !== "text") throw new Error("expected text tool result");
    return JSON.parse(block.text) as {items?: Array<{state: string}>; candidates?: Array<{patternId: string}>};
}

describe("illustration planning Agent tools", () => {
    it("binds resolver scope to frozen session context and rejects Agent model overrides", async () => {
        const run = planningRun();
        const definitions = createIllustrationPlanningAgentToolDefinitions({
            readToolContext: async () => toolContext(),
            createRun: async () => run,
        });
        const tool = definitions.find((item) => item.key === "resolve_tags")!.runtime();
        const result = await tool.executeWithContext!(executionContext(), "call-1", {tags: ["fleet"]});

        expect(parseResult(result).items?.[0]?.state).toBe("pending_unknown");
        expect(run.resolver.resolveTags).toHaveBeenCalledWith({
            runId: "workflow-1",
            contextId: "project-1",
            tags: ["fleet"],
            modelScope: {kind: "generic-novelai"},
        });
        await expect(tool.executeWithContext!(executionContext(), "call-2", {
            tags: ["fleet"],
            modelScope: {kind: "model", modelId: "forged"},
        })).rejects.toThrow();
    });

    it("searches and gets only the frozen Pattern candidate closure", async () => {
        const definitions = createIllustrationPlanningAgentToolDefinitions({
            readToolContext: async () => toolContext(),
            createRun: async () => planningRun(),
        });
        const search = definitions.find((item) => item.key === "search_tag_patterns")!.runtime();
        const get = definitions.find((item) => item.key === "get_tag_patterns")!.runtime();

        const result = await search.executeWithContext!(executionContext(), "call-1", {query: "harbor dawn", limit: 8});
        expect(parseResult(result).candidates?.map((item) => item.patternId)).toEqual(["harbor-dawn"]);
        await expect(get.executeWithContext!(executionContext(), "call-2", {patternIds: ["hidden-pattern"]}))
            .rejects.toThrow(/TAG_PATTERN_NOT_EXPOSED/u);
    });

    it("keeps independent resolver state per invocation", async () => {
        const createRun = vi.fn(async () => planningRun());
        const definitions = createIllustrationPlanningAgentToolDefinitions({
            readToolContext: async () => toolContext(),
            createRun,
        });
        const resolve = definitions.find((item) => item.key === "resolve_tags")!.runtime();

        await resolve.executeWithContext!(executionContext("invocation-a"), "call-1", {tags: ["fleet"]});
        await resolve.executeWithContext!(executionContext("invocation-a"), "call-2", {tags: ["harbor"]});
        await resolve.executeWithContext!(executionContext("invocation-b"), "call-3", {tags: ["dawn"]});
        expect(createRun).toHaveBeenCalledTimes(2);
    });

    it("registers the complete read-only narrow tool surface", () => {
        const definitions = createIllustrationPlanningAgentToolDefinitions({
            readToolContext: async () => toolContext(),
            createRun: async () => planningRun(),
        });
        expect(definitions.map((item) => item.key).sort()).toEqual([
            "finalize_tag_resolution",
            "get_tag_patterns",
            "related_tags",
            "resolve_tags",
            "search_tag_patterns",
            "search_tags",
            "suggest_tag_replacements",
            "validate_tag_resolutions",
        ]);
        expect(definitions.every((item) => item.mutatesWorkspace !== true)).toBe(true);
    });
});
