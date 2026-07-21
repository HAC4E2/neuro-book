import {describe, expect, it, vi} from "vitest";
import {
    ChapterIllustrationPlanningSourceSchema,
    ChapterIllustrationShotSchema,
} from "nbook/shared/text-to-image-chapter-storyboard";
import {
    createIllustrationExecutionSourceIdentityHash,
    IllustrationExecutionSourceSchema,
} from "nbook/shared/text-to-image-execution";
import {createDefaultTextToImageRecipeSource} from "nbook/shared/text-to-image-recipe";
import {createTextToImageRecipeSnapshot} from "nbook/server/text-to-image/recipe.codec";
import {
    IllustrationExecutionCompilerError,
    ProductionIllustrationExecutionCompiler,
    type IllustrationExecutionCompilerDependencies,
    type IllustrationExecutionTargetSnapshot,
} from "nbook/server/text-to-image/illustration-execution.compiler";

const H = (digit: string): string => `sha256:${digit.repeat(64)}`;

describe("Production Illustration Execution Compiler", () => {
    it("returns only source identity and persisted Recipe seed policy", async () => {
        const fixture = createFixture();
        const compiler = new ProductionIllustrationExecutionCompiler(fixture.dependencies);

        await expect(compiler.readTarget({
            projectPath: "workspace/demo",
            ownerUserId: 7,
            placeholderId: "placeholder-1",
        })).resolves.toEqual({
            sourceIdentityHash: createIllustrationExecutionSourceIdentityHash(fixture.target.source),
            seedPolicy: {kind: "fixed", seed: 123},
        });
        expect(fixture.dependencies.readProviderSnapshot).not.toHaveBeenCalled();
        expect(fixture.dependencies.compile).not.toHaveBeenCalled();
    });

    it("rejects source identity drift before reading mutable execution facts", async () => {
        const fixture = createFixture();
        const compiler = new ProductionIllustrationExecutionCompiler(fixture.dependencies);

        await expect(compiler.compile({
            projectPath: "workspace/demo",
            ownerUserId: 7,
            placeholderId: "placeholder-1",
            expectedSourceIdentityHash: H("f"),
            executionNonce: "nonce-1",
            variantIndex: 0,
            outputIndex: 0,
            outputCount: 1,
            seed: 123,
        })).rejects.toMatchObject<Partial<IllustrationExecutionCompilerError>>({
            code: "ILLUSTRATION_EXECUTION_TARGET_INVALID",
        });
        expect(fixture.dependencies.readOverlays).not.toHaveBeenCalled();
        expect(fixture.dependencies.readCharacters).not.toHaveBeenCalled();
        expect(fixture.dependencies.readProviderSnapshot).not.toHaveBeenCalled();
    });
});

/** 构造不触发真实文件、Provider 或 Tag index 的 strict target/Recipe seam。 */
function createFixture(): {
    target: IllustrationExecutionTargetSnapshot;
    dependencies: IllustrationExecutionCompilerDependencies;
} {
    const source = IllustrationExecutionSourceSchema.parse({
        projectId: "project-1",
        chapterPath: "manuscript/v1/c1/index.md",
        placeholderId: "placeholder-1",
        shotId: "shot-1",
        shotOrigin: "chapter-plan",
        anchorId: "p_0001_abcdef12",
        shotIntentHash: H("1"),
        sourceChapterHash: H("0"),
    });
    const publication = {journalId: "journal-1", status: "applied" as const, appliedAt: "2026-07-21T00:00:00.000Z"};
    const planningSource = ChapterIllustrationPlanningSourceSchema.parse({
        planningRunId: "planning-run-1",
        operation: "plan-chapter",
        state: "active",
        publication,
        chapterFileHashAtPlan: H("a"),
        planningRequestHash: H("b"),
        planningInputHash: H("c"),
        planningEvidenceHash: H("d"),
        sourceChapterHashAtPlan: H("0"),
        selection: null,
        effectivePreset: {presetId: "default", semanticHash: H("2")},
        effectivePatternSet: {patternSetId: "default", planningHash: H("3"), candidateSetHash: H("4")},
        recipePlanningConstraints: {
            key: "lorebook/instruction/text-to-image/default/index.md",
            constraintsHash: H("5"),
            capabilitySummaryHash: H("6"),
        },
        tagQuerySnapshot: {
            indexVersion: "index-v1",
            manifestHash: H("7"),
            policyVersion: "policy-v1",
            resolverVersion: "resolver-v1",
            resolverPolicyVersion: "resolver-policy-v1",
            capabilityVersion: "capability-v1",
            providerKind: "novelai",
            modelScope: {kind: "generic-novelai"},
            resultHash: H("8"),
        },
        director: {profileVersion: "1", operationVersion: "1", modelConfigFingerprint: H("9")},
        contentBlockParserVersion: "parser-v1",
        planValidatorVersion: "validator-v1",
        systemPolicyVersion: "system-v1",
        visualPlanningFactsHash: H("a"),
        contextSnapshotHash: H("b"),
        planPolicyHash: H("c"),
    });
    const shot = ChapterIllustrationShotSchema.parse({
        shotId: source.shotId,
        state: "active",
        shotIntentHash: source.shotIntentHash,
        placeholderId: source.placeholderId,
        publication,
        origin: {kind: "chapter-plan", planningRunId: planningSource.planningRunId},
        anchorId: "p_0001_abcdef12",
        insertAfterAnchorId: "p_0001_abcdef12",
        purpose: "测试镜头",
        characterIds: [],
        outfitRefs: [],
        action: {},
        composition: {
            shotSize: "wide",
            cameraAngle: "eye-level",
            viewpoint: "third-person",
            canvasIntent: "landscape",
            subjectPlacement: "center",
        },
        continuity: {timeOfDay: "day", palette: "warm"},
        tagPatternRefs: [],
        tagResolutions: {},
        tagDelta: {prefer: [], avoid: []},
    });
    const target = {source, publicationJournalId: publication.journalId, shot, planningSource};
    const recipeSource = {...createDefaultTextToImageRecipeSource(), seed: {policy: "fixed" as const, fixed: 123}};
    const recipe = {exists: true, source: recipeSource, snapshot: createTextToImageRecipeSnapshot(recipeSource)};
    const fail = async (): Promise<never> => {
        throw new Error("unexpected dependency call");
    };
    const dependencies = {
        readTarget: vi.fn(async () => target),
        readRecipe: vi.fn(async () => recipe),
        readOverlays: vi.fn(fail),
        readCharacters: vi.fn(fail),
        readProviderSnapshot: vi.fn(fail),
        createResolver: vi.fn(fail),
        verifyReferenceAssets: vi.fn(fail),
        compile: vi.fn(fail),
    } satisfies IllustrationExecutionCompilerDependencies;
    return {target, dependencies};
}
