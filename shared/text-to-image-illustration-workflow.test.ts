import {describe, expect, it} from "vitest";
import {
    IllustrationPlanningInputBundleSchema,
    IllustrationPlanningRequestIdentitySchema,
    createIllustrationPlanningInputHash,
    createIllustrationPlanningRequestHash,
} from "nbook/shared/text-to-image-illustration-workflow";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";

const hashes = Array.from({length: 16}, (_, index) => `sha256:${index.toString(16).padStart(64, "0")}`);

function identity() {
    const projectScopeHash = hashTextToImageContract({contentScope: "general", unknownTagPolicy: "provider_passthrough"});
    return IllustrationPlanningRequestIdentitySchema.parse({
        schemaVersion: "nbook.illustration-planning-request/v1",
        projectId: "project-1",
        chapterPath: "manuscript/v1/c1/index.md",
        operation: "plan-chapter",
        sourceChapterHash: hashes[0],
        selectionHash: null,
        userIntent: "突出初见舰队的震撼",
        replan: null,
        effectivePresetSemanticHash: hashes[1],
        effectivePatternPlanningHash: hashes[2],
        visualPlanningFactsHash: hashes[3],
        recipePlanningConstraintsHash: hashes[4],
        continuityBaselineHash: hashes[5],
        tagIndex: {indexVersion: "danbooru-test", manifestHash: hashes[6]},
        tagPolicy: {policyVersion: "policy-v1", projectScopeHash},
        resolverVersion: "resolver-v1",
        resolverPolicyVersion: "resolver-policy-v1",
        patternRetrievalPolicyVersion: "nbook-pattern-retrieval-v1",
        planPolicyHash: hashes[8],
        contentBlockParserVersion: "parser-v1",
        directorProfileVersion: "1",
        directorOperationVersion: "1",
        modelConfigFingerprint: hashes[9],
        systemPolicyVersion: "policy-v1",
        planValidatorVersion: "validator-v1",
    });
}

function bundle() {
    const requestIdentity = identity();
    const planningRequestHash = createIllustrationPlanningRequestHash(requestIdentity);
    const tagQuerySnapshot = {
        indexVersion: "danbooru-test",
        manifestHash: hashes[6]!,
        policyVersion: "policy-v1",
        resolverVersion: "resolver-v1",
        resolverPolicyVersion: "resolver-policy-v1",
        capabilityVersion: "cap-v1",
    };
    const tagPolicySnapshot = {
        config: {contentScope: "general" as const, unknownTagPolicy: "provider_passthrough" as const},
        projectScopeHash: requestIdentity.tagPolicy.projectScopeHash,
    };
    const draft = {
        schemaVersion: "nbook.illustration-planning-input/v1" as const,
        requestIdentity,
        planningRequestHash,
        chapter: {
            chapterFileHash: hashes[10]!,
            sourceChapterHash: hashes[0]!,
            blocks: [{anchorId: "p_0001_abcdef12", kind: "paragraph" as const, normalizedText: "她看见舰队。", textHash: hashes[11]!}],
            selection: null,
        },
        characters: [{
            characterId: "hero",
            names: ["主角"],
            visualPlanningFactsHash: hashes[12]!,
            facts: [{field: "profileTraits" as const, values: ["silver_hair"]}],
            outfits: [{
                outfitRef: "lorebook/character/hero/outfits/travel.md",
                names: ["旅行装"],
                visualPlanningFactsHash: hashes[13]!,
                facts: [{field: "upper" as const, values: ["travel_coat"]}],
            }],
        }],
        continuityBaseline: [],
        effectivePreset: {presetId: "default", semanticHash: hashes[1]!, rules: []},
        patternCandidates: {
            schemaVersion: "nbook.tag-pattern-candidate-set/v1" as const,
            retrievalPolicyVersion: "nbook-pattern-retrieval-v1" as const,
            effectivePlanningHash: hashes[2]!,
            requestHash: hashes[14]!,
            candidateSetHash: hashes[15]!,
            candidates: [],
        },
        recipePlanningConstraints: {
            constraintsHash: hashes[4]!,
            allowedCanvasIntents: ["portrait" as const, "landscape" as const, "square" as const],
            maxSubjects: 3,
        },
        tagQuerySnapshot,
        tagPolicySnapshot,
        userRequest: {intent: "突出初见舰队的震撼", replan: null},
        toolContext: {
            operation: "plan-chapter" as const,
            runId: "workflow-1",
            contextId: "project-1",
            modelScope: {kind: "generic-novelai" as const},
            patternCandidates: {
                schemaVersion: "nbook.tag-pattern-candidate-set/v1" as const,
                retrievalPolicyVersion: "nbook-pattern-retrieval-v1" as const,
                effectivePlanningHash: hashes[2]!,
                requestHash: hashes[14]!,
                candidateSetHash: hashes[15]!,
                candidates: [],
            },
            tagQuerySnapshot,
            tagPolicySnapshot,
        },
    };
    return {...draft, planningInputHash: createIllustrationPlanningInputHash(draft)};
}

describe("illustration planning workflow contracts", () => {
    it("separates stable request identity from execution/session state", () => {
        const current = identity();
        expect(createIllustrationPlanningRequestHash(current)).toMatch(/^sha256:[a-f0-9]{64}$/u);
        expect(() => IllustrationPlanningRequestIdentitySchema.parse({...current, sessionId: 12})).toThrow();
        expect(() => IllustrationPlanningRequestIdentitySchema.parse({...current, apiKey: "secret"})).toThrow();
    });

    it("requires selectionHash only for plan-selection", () => {
        expect(() => IllustrationPlanningRequestIdentitySchema.parse({...identity(), operation: "plan-selection"})).toThrow();
        expect(() => IllustrationPlanningRequestIdentitySchema.parse({...identity(), selectionHash: hashes[10]})).toThrow();
    });

    it("accepts only browser intent and rejects duplicated configuration fields", async () => {
        const {IllustrationPlanningStartRequestSchema} = await import("nbook/shared/text-to-image-illustration-workflow");
        const request = {
            projectPath: "workspace/demo",
            chapterPath: "manuscript/v1/c1/index.md",
            operation: "plan-chapter" as const,
        };
        expect(IllustrationPlanningStartRequestSchema.parse(request)).toMatchObject({userIntent: "", replan: null});
        expect(() => IllustrationPlanningStartRequestSchema.parse({...request, recipe: {model: "forged"}})).toThrow();
        expect(() => IllustrationPlanningStartRequestSchema.parse({...request, providerId: "forged"})).toThrow();
    });

    it("self-validates planningRequestHash/planningInputHash and duplicated closed context", () => {
        const parsed = IllustrationPlanningInputBundleSchema.parse(bundle());
        expect(parsed.toolContext.patternCandidates.candidateSetHash).toBe(parsed.patternCandidates.candidateSetHash);
        expect(() => IllustrationPlanningInputBundleSchema.parse({...parsed, planningInputHash: hashes[0]})).toThrow();
        expect(() => IllustrationPlanningInputBundleSchema.parse({
            ...parsed,
            toolContext: {...parsed.toolContext, contextId: "other-project"},
        })).toThrow();
    });

    it("changes input evidence without changing request identity", () => {
        const first = bundle();
        const changedDraft = {
            ...first,
            chapter: {...first.chapter, blocks: [{...first.chapter.blocks[0]!, normalizedText: "她第一次看见舰队。"}]},
        };
        const second = {...changedDraft, planningInputHash: createIllustrationPlanningInputHash(changedDraft)};

        expect(second.planningRequestHash).toBe(first.planningRequestHash);
        expect(second.planningInputHash).not.toBe(first.planningInputHash);
    });
});
