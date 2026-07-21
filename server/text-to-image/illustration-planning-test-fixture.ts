import {
    createIllustrationPlanningInputHash,
    createIllustrationPlanningRequestHash,
    type IllustrationPlanningInputBundle,
} from "nbook/shared/text-to-image-illustration-workflow";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";

const fixtureHash = (digit: string) => `sha256:${digit.repeat(64)}`;

/** P3 repository/scheduler 聚焦测试共用的最小 strict Planning Input。 */
export function createIllustrationPlanningTestBundle(chapterPath = "manuscript/v1/c1/index.md"): IllustrationPlanningInputBundle {
    const tagPolicyConfig = {contentScope: "general" as const, unknownTagPolicy: "provider_passthrough" as const};
    const tagPolicySnapshot = {config: tagPolicyConfig, projectScopeHash: hashTextToImageContract(tagPolicyConfig)};
    const tagQuerySnapshot = {
        indexVersion: "index-v1",
        manifestHash: fixtureHash("6"),
        policyVersion: "policy-v1",
        resolverVersion: "resolver-v1",
        resolverPolicyVersion: "resolver-policy-v1",
        capabilityVersion: "cap-v1",
    };
    const requestIdentity = {
        schemaVersion: "nbook.illustration-planning-request/v1" as const,
        projectId: "project-1",
        chapterPath,
        operation: "plan-chapter" as const,
        sourceChapterHash: fixtureHash("0"),
        selectionHash: null,
        userIntent: "",
        replan: null,
        effectivePresetSemanticHash: fixtureHash("1"),
        effectivePatternPlanningHash: fixtureHash("2"),
        visualPlanningFactsHash: fixtureHash("3"),
        recipePlanningConstraintsHash: fixtureHash("4"),
        continuityBaselineHash: fixtureHash("5"),
        tagIndex: {indexVersion: "index-v1", manifestHash: fixtureHash("6")},
        tagPolicy: {policyVersion: "policy-v1", projectScopeHash: tagPolicySnapshot.projectScopeHash},
        resolverVersion: "resolver-v1",
        resolverPolicyVersion: "resolver-policy-v1",
        patternRetrievalPolicyVersion: "nbook-pattern-retrieval-v1",
        planPolicyHash: fixtureHash("8"),
        contentBlockParserVersion: "parser-v1",
        directorProfileVersion: "1",
        directorOperationVersion: "1",
        modelConfigFingerprint: fixtureHash("9"),
        systemPolicyVersion: "system-v1",
        planValidatorVersion: "validator-v1",
    };
    const patternCandidates = {
        schemaVersion: "nbook.tag-pattern-candidate-set/v1" as const,
        retrievalPolicyVersion: "nbook-pattern-retrieval-v1" as const,
        effectivePlanningHash: fixtureHash("2"),
        requestHash: fixtureHash("a"),
        candidateSetHash: fixtureHash("b"),
        candidates: [],
    };
    const draft = {
        schemaVersion: "nbook.illustration-planning-input/v1" as const,
        requestIdentity,
        planningRequestHash: createIllustrationPlanningRequestHash(requestIdentity),
        chapter: {
            chapterFileHash: fixtureHash("c"),
            sourceChapterHash: fixtureHash("0"),
            blocks: [{anchorId: "p_0001_abcdef12", kind: "paragraph" as const, normalizedText: "正文", textHash: fixtureHash("d")}],
            selection: null,
        },
        characters: [],
        continuityBaseline: [],
        effectivePreset: {presetId: "default", semanticHash: fixtureHash("1"), rules: []},
        patternCandidates,
        recipePlanningConstraints: {constraintsHash: fixtureHash("4"), allowedCanvasIntents: ["landscape" as const], maxSubjects: 3},
        tagQuerySnapshot,
        tagPolicySnapshot,
        userRequest: {intent: "", replan: null},
        toolContext: {
            operation: "plan-chapter" as const,
            runId: "planning-run-1",
            contextId: "project-1",
            modelScope: {kind: "generic-novelai" as const},
            patternCandidates,
            tagQuerySnapshot,
            tagPolicySnapshot,
        },
    };
    return {...draft, planningInputHash: createIllustrationPlanningInputHash(draft)};
}
