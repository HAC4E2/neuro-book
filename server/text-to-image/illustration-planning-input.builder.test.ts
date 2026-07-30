import {describe, expect, it} from "vitest";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {createDefaultTextToImageRecipeSource} from "nbook/shared/text-to-image-recipe";
import type {TagPattern} from "nbook/shared/text-to-image-tag-pattern";
import {TAG_INDEX_CAPABILITY_VERSION} from "nbook/shared/text-to-image-tag-index";
import {IllustrationChapterParser} from "nbook/server/text-to-image/illustration-chapter-parser";
import {
    IllustrationPlanningInputBuilder,
    type IllustrationPlanningInputPorts,
} from "nbook/server/text-to-image/illustration-planning-input.builder";
import {createTextToImageRecipeSnapshot} from "nbook/server/text-to-image/recipe.codec";

const H = (digit: string) => `sha256:${digit.repeat(64)}`;
const chapterPath = "manuscript/v1/c1/index.md";
const markdown = "# 海港\n\n她在黎明看见舰队。\n";

describe("IllustrationPlanningInputBuilder", () => {
    it("freezes every planning truth source and remains deterministic for duplicate starts", async () => {
        const builder = new IllustrationPlanningInputBuilder(ports());
        const request = {
            projectPath: "workspace/demo",
            chapterPath,
            operation: "plan-chapter" as const,
            userIntent: "突出黎明舰队",
            replan: null,
        };

        const first = await builder.build(request);
        const second = await builder.build(request);

        expect(second.planningRequestHash).toBe(first.planningRequestHash);
        expect(second.planningInputHash).toBe(first.planningInputHash);
        expect(first.requestIdentity).toMatchObject({
            projectId: "project-portable-id",
            chapterPath,
            operation: "plan-chapter",
            visualPlanningFactsHash: H("3"),
            modelConfigFingerprint: H("9"),
        });
        expect(first.chapter.blocks.map((block) => block.kind)).toEqual(["heading", "paragraph"]);
        expect(first.patternCandidates.candidates.map((candidate) => candidate.patternId)).toEqual(["harbor-dawn"]);
        expect(first.toolContext.tagPolicySnapshot).toEqual(first.tagPolicySnapshot);
        expect(first.toolContext.tagQuerySnapshot).toEqual(first.tagQuerySnapshot);
        expect(JSON.stringify(first)).not.toContain("apiKey");
        expect(JSON.stringify(first)).not.toContain("positivePrefix");
    });

    it("derives a trusted selection anchor from the saved chapter instead of accepting one from the client", async () => {
        const chapter = new IllustrationChapterParser().parse({chapterPath, markdown});
        const builder = new IllustrationPlanningInputBuilder(ports());
        const result = await builder.build({
            projectPath: "workspace/demo",
            chapterPath,
            operation: "plan-selection",
            userIntent: "",
            replan: null,
            selection: {
                selectedText: "她在黎明看见舰队。",
                lineRange: {startLine: 3, endLine: 3},
                chapterFileHash: chapter.chapterFileHash,
            },
        });

        expect(result.requestIdentity.selectionHash).toBe(result.chapter.selection?.selectionHash);
        expect(result.chapter.selection?.insertAfterAnchorId).toBe(chapter.anchorCandidates[1]?.anchorId);
        expect(result.toolContext.operation).toBe("plan-selection");
    });

    it("rebuilds frozen truth from the server and changes identity when a planning dependency drifts", async () => {
        const mutablePorts = ports();
        const builder = new IllustrationPlanningInputBuilder(mutablePorts);
        const original = await builder.build({
            projectPath: "workspace/demo",
            chapterPath,
            operation: "plan-chapter",
            userIntent: "",
            replan: null,
        });

        const unchanged = await builder.rebuild({projectPath: "workspace/demo", bundle: original});
        expect(unchanged.planningRequestHash).toBe(original.planningRequestHash);
        expect(unchanged.planningInputHash).toBe(original.planningInputHash);

        const readRuntimeContext = mutablePorts.readRuntimeContext;
        mutablePorts.readRuntimeContext = async (projectPath) => {
            const snapshot = await readRuntimeContext(projectPath);
            return {director: {...snapshot.director, modelConfigFingerprint: H("8")}, tagPolicySnapshot: snapshot.tagPolicySnapshot};
        };
        const drifted = await builder.rebuild({projectPath: "workspace/demo", bundle: original});
        expect(drifted.planningRequestHash).not.toBe(original.planningRequestHash);
        expect(drifted.planningInputHash).not.toBe(original.planningInputHash);
    });

    it("fails closed when rebuilding a selection after the saved chapter bytes changed", async () => {
        let currentMarkdown = markdown;
        const mutablePorts = ports();
        mutablePorts.readChapter = async () => ({chapterPath, markdown: currentMarkdown});
        const builder = new IllustrationPlanningInputBuilder(mutablePorts);
        const chapter = new IllustrationChapterParser().parse({chapterPath, markdown});
        const original = await builder.build({
            projectPath: "workspace/demo",
            chapterPath,
            operation: "plan-selection",
            userIntent: "",
            replan: null,
            selection: {
                selectedText: chapter.anchorCandidates[1]!.normalizedText,
                lineRange: {startLine: 3, endLine: 3},
                chapterFileHash: chapter.chapterFileHash,
            },
        });
        currentMarkdown += "\n新增正文。\n";

        await expect(builder.rebuild({projectPath: "workspace/demo", bundle: original}))
            .rejects.toThrow(/ILLUSTRATION_WORKFLOW_STALE/u);
    });
});

function ports(): IllustrationPlanningInputPorts {
    const tagPolicyConfig = {contentScope: "general" as const, unknownTagPolicy: "provider_passthrough" as const};
    const pattern: TagPattern = {
        patternId: "harbor-dawn",
        order: 1,
        enabled: true,
        retrieval: {
            mode: "trigger",
            any: ["黎明"],
            andAny: [],
            characterCount: {min: 0, max: 4},
            canvasIntents: [],
            ratingScopes: ["general"],
            providerKinds: ["novelai"],
            modelScopes: [{kind: "generic-novelai"}],
        },
        intent: {scene: "harbor", composition: "wide", lighting: "dawn", action: "observe"},
        tagResolutions: {},
        policyApprovals: {},
        positive: {scene: [], composition: [], lighting: [], action: []},
        negative: {global: [], characters: []},
        providerSyntaxRefs: [],
        providerSyntaxNodes: {},
        confidence: 1,
    };
    const recipeSource = {...createDefaultTextToImageRecipeSource(), dimensions: {
        ...createDefaultTextToImageRecipeSource().dimensions,
        mode: "byIntent" as const,
    }};
    return {
        readProjectId: async () => "project-portable-id",
        readChapter: async () => ({chapterPath, markdown}),
        readPlanningRules: async () => ({
            preset: {presetId: "default", semanticHash: H("1"), rules: [], provenance: []},
            patterns: {patternSetId: "default", planningHash: H("2"), renderHash: H("4"), patterns: [pattern], provenance: [{
                patternId: pattern.patternId,
                scope: "base",
                operation: "base",
                sourceEntryId: null,
            }]},
        }),
        readCharacters: async () => ({characters: [], visualPlanningFactsHash: H("3"), renderTagFactsHash: H("5")}),
        readRecipe: async () => ({exists: true, source: recipeSource, snapshot: createTextToImageRecipeSnapshot(recipeSource)}),
        readRuntimeContext: async () => ({
            director: {profileVersion: "1", operationVersion: "route-b-p3.1", modelConfigFingerprint: H("9")},
            tagPolicySnapshot: {config: tagPolicyConfig, projectScopeHash: hashTextToImageContract(tagPolicyConfig)},
        }),
        readTagQuerySnapshot: async () => ({
            indexVersion: "index-v1",
            manifestHash: H("6"),
            policyVersion: "policy-v1",
            resolverVersion: "resolver-v1",
            resolverPolicyVersion: "resolver-policy-v1",
            capabilityVersion: TAG_INDEX_CAPABILITY_VERSION,
        }),
        readContinuityBaseline: async () => [],
    };
}
