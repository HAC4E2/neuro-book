import {describe, expect, it} from "vitest";
import {
    ChapterIllustrationStoryboardSchema,
    createChapterIllustrationPlanHash,
} from "nbook/shared/text-to-image-chapter-storyboard";

function hash(character: string): string {
    return `sha256:${character.repeat(64)}`;
}

function fixture() {
    const storyboard = {
        schema: "nbook.chapter-illustrations/v2" as const,
        chapterPath: "manuscript/001-volume/003-chapter/index.md",
        revisionId: "sb_01",
        sourceChapterHash: hash("1"),
        planHash: hash("0"),
        planningSources: [{
            planningRunId: "workflow_01",
            operation: "plan-chapter" as const,
            state: "active" as const,
            publication: {journalId: "apply_01", status: "applied" as const, appliedAt: "2026-07-21T01:00:00.000Z"},
            chapterFileHashAtPlan: hash("2"),
            planningRequestHash: hash("3"),
            planningInputHash: hash("4"),
            planningEvidenceHash: hash("5"),
            sourceChapterHashAtPlan: hash("1"),
            selection: null,
            effectivePreset: {presetId: "cinematic", semanticHash: hash("6")},
            effectivePatternSet: {patternSetId: "cinematic", planningHash: hash("7"), candidateSetHash: hash("8")},
            recipePlanningConstraints: {
                key: "lorebook/instruction/text-to-image/default/index.md",
                constraintsHash: hash("9"),
                capabilitySummaryHash: hash("a"),
            },
            tagQuerySnapshot: {
                indexVersion: "danbooru-nai-2026-07",
                manifestHash: hash("b"),
                policyVersion: "safe-demo",
                resolverVersion: "resolver-v1",
                resolverPolicyVersion: "resolver-policy-v1",
                capabilityVersion: "nai-cap-v1",
                providerKind: "novelai" as const,
                modelScope: {kind: "generic-novelai" as const},
                resultHash: hash("c"),
            },
            director: {
                profileVersion: "1",
                operationVersion: "1",
                modelConfigFingerprint: hash("d"),
            },
            contentBlockParserVersion: "nbook-illustration-chapter-parser-v1",
            planValidatorVersion: "nbook-illustration-plan-validator-v1",
            systemPolicyVersion: "route-b-v1",
            visualPlanningFactsHash: hash("e"),
            contextSnapshotHash: hash("f"),
            planPolicyHash: hash("1"),
        }],
        shots: [{
            shotId: "shot_01",
            state: "active" as const,
            shotIntentHash: hash("2"),
            placeholderId: "image_prompt_01",
            publication: {journalId: "apply_01", status: "applied" as const, appliedAt: "2026-07-21T01:00:00.000Z"},
            origin: {kind: "chapter-plan" as const, planningRunId: "workflow_01"},
            anchorId: "p_0003_8f31a2c4",
            insertAfterAnchorId: "p_0003_8f31a2c4",
            purpose: "建立港口规模",
            characterIds: ["hero"],
            outfitRefs: ["lorebook/character/hero/outfits/travel.md"],
            action: {hero: "standing-at-railing"},
            composition: {
                shotSize: "wide" as const,
                cameraAngle: "high" as const,
                viewpoint: "third-person" as const,
                canvasIntent: "landscape" as const,
                subjectPlacement: "lower-right",
            },
            continuity: {timeOfDay: "dawn", palette: "silver-blue"},
            tagPatternRefs: ["harbor-dawn"],
            tagResolutions: {},
            tagDelta: {prefer: [], avoid: []},
        }],
    };
    storyboard.planHash = createChapterIllustrationPlanHash(storyboard);
    return storyboard;
}

describe("ChapterIllustrationStoryboard", () => {
    it("accepts a closed V2 aggregate and ignores revision/publication in planHash", () => {
        const parsed = ChapterIllustrationStoryboardSchema.parse(fixture());
        const changedPublication = {
            ...parsed,
            revisionId: "sb_02",
            planningSources: parsed.planningSources.map((source) => ({
                ...source,
                publication: {journalId: "another_journal", status: "pending" as const, appliedAt: null},
            })),
            shots: parsed.shots.map((shot) => ({
                ...shot,
                publication: {journalId: "another_journal", status: "pending" as const, appliedAt: null},
            })),
        };

        expect(createChapterIllustrationPlanHash(changedPublication)).toBe(parsed.planHash);
        expect(createChapterIllustrationPlanHash({
            ...parsed,
            shots: parsed.shots.map((shot) => ({...shot, purpose: "改变镜头语义"})),
        })).not.toBe(parsed.planHash);
    });

    it("rejects an unknown planning run and an origin kind inconsistent with its operation", () => {
        const unknownRun = fixture();
        unknownRun.shots[0]!.origin.planningRunId = "workflow_missing";
        expect(() => ChapterIllustrationStoryboardSchema.parse(unknownRun)).toThrow(/planningRunId|origin/u);

        const wrongKind = fixture();
        expect(() => ChapterIllustrationStoryboardSchema.parse({
            ...wrongKind,
            shots: wrongKind.shots.map((shot) => ({
                ...shot,
                origin: {...shot.origin, kind: "selection"},
            })),
        })).toThrow(/operation|origin/u);
    });

    it("rejects raw prompt/tag fields and unused resolution snapshots", () => {
        const rawPrompt = fixture();
        const shotWithPrompt = {...rawPrompt.shots[0]!, prompt: "masterpiece, fleet"};
        expect(() => ChapterIllustrationStoryboardSchema.parse({...rawPrompt, shots: [shotWithPrompt]})).toThrow();

        const unusedResolution = fixture();
        const shot = unusedResolution.shots[0]!;
        const resolution = {
            schemaVersion: "nbook.semantic-tag-resolution/v1" as const,
            kind: "canonical" as const,
            sourceText: "fleet",
            indexVersion: "danbooru-nai-2026-07",
            policyVersion: "safe-demo",
            resolverVersion: "resolver-v1",
            resolverPolicyVersion: "resolver-policy-v1",
            capabilityVersion: "nai-cap-v1",
            providerKind: "novelai" as const,
            modelScope: {kind: "generic-novelai" as const},
            candidateSetHash: null,
            resolvedAt: "2026-07-21T00:00:00.000Z",
            matchedBy: "exact" as const,
            canonical: {tagId: 2001, canonicalName: "fleet"},
            decisionProvenance: {selectedBy: "exact" as const, conceptQueriesHash: null},
        };
        expect(() => ChapterIllustrationStoryboardSchema.parse({
            ...unusedResolution,
            shots: [{...shot, tagResolutions: {"tr-fleet": resolution}}],
        })).toThrow(/unused|未引用/u);
    });

    it("requires selection identity only for plan-selection sources", () => {
        const chapterPlan = fixture();
        expect(() => ChapterIllustrationStoryboardSchema.parse({
            ...chapterPlan,
            planningSources: chapterPlan.planningSources.map((source) => ({
                ...source,
                operation: "plan-selection" as const,
            })),
            shots: chapterPlan.shots.map((shot) => ({...shot, origin: {...shot.origin, kind: "selection" as const}})),
        })).toThrow(/selection/u);
    });
});
