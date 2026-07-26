import {describe, expect, it} from "vitest";
import {
    StoryboardGlobalPublishPreviewSchema,
    StoryboardGlobalPublishRequestSchema,
    StoryboardPublishTargetSchema,
    createStoryboardGlobalPublishPreviewToken,
} from "nbook/shared/text-to-image-storyboard-publish";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;

function previewInput() {
    return {
        schemaVersion: "nbook.storyboard-global-publish-preview/v1" as const,
        state: "ready" as const,
        importId: "ttpi.import",
        target: {mode: "candidate" as const, confirmReplaceActive: true},
        sourceCandidatePackageHash: HASH_A,
        publishedCandidatePackageHash: HASH_B,
        diagnosticHash: HASH_C,
        published: {
            presetId: "preset.target",
            patternSetId: "preset.target",
            packageId: "package.target",
            resourceKey: "preset.target--abcdef",
            storyboardSemanticHash: HASH_A,
            patternPlanningHash: HASH_B,
            patternRenderHash: HASH_C,
            presetPath: "storyboard-presets/preset.target--abcdef.md",
            patternPath: "tag-patterns/preset.target--abcdef.md",
        },
        previousSelectorKey: "storyboard-presets/default.md",
        active: null,
        expected: {
            activePresetFileHash: null,
            activePatternFileHash: null,
            globalConfigHash: HASH_A,
        },
        conflict: null,
        confirmGlobalRequired: true as const,
    };
}

describe("Storyboard global publish contracts", () => {
    it("只接受显式 candidate replacement 或 save-as presetId", () => {
        expect(StoryboardPublishTargetSchema.parse({mode: "candidate", confirmReplaceActive: true})).toEqual({
            mode: "candidate",
            confirmReplaceActive: true,
        });
        expect(StoryboardPublishTargetSchema.parse({mode: "save_as", presetId: "my.preset"})).toEqual({
            mode: "save_as",
            presetId: "my.preset",
        });
        expect(() => StoryboardPublishTargetSchema.parse({mode: "candidate"})).toThrow();
        expect(() => StoryboardPublishTargetSchema.parse({mode: "save_as", presetId: "../escape"})).toThrow();
        expect(() => StoryboardPublishTargetSchema.parse({
            mode: "candidate",
            confirmReplaceActive: true,
            providerId: "novelai",
        })).toThrow();
    });

    it("preview token 绑定目标、pair hash、active/config expected hash 与冲突状态", () => {
        const input = previewInput();
        const token = createStoryboardGlobalPublishPreviewToken(input);
        const preview = StoryboardGlobalPublishPreviewSchema.parse({...input, publishPreviewToken: token});
        expect(preview.publishPreviewToken).toBe(token);
        expect(() => StoryboardGlobalPublishPreviewSchema.parse({
            ...preview,
            expected: {...preview.expected, globalConfigHash: HASH_B},
        })).toThrow("publishPreviewToken");
    });

    it("publish request 强制 global 确认和全部 expected hashes，拒绝路径/Prompt/NovelAI 标量", () => {
        const preview = StoryboardGlobalPublishPreviewSchema.parse({
            ...previewInput(),
            publishPreviewToken: createStoryboardGlobalPublishPreviewToken(previewInput()),
        });
        const request = {
            projectPath: "workspace/demo",
            importId: preview.importId,
            expectedResolvedPreviewToken: HASH_C,
            publishPreviewToken: preview.publishPreviewToken,
            target: preview.target,
            candidatePackageHash: preview.sourceCandidatePackageHash,
            diagnosticHash: preview.diagnosticHash,
            expectedActivePresetFileHash: preview.expected.activePresetFileHash,
            expectedActivePatternFileHash: preview.expected.activePatternFileHash,
            expectedGlobalConfigHash: preview.expected.globalConfigHash,
            targetScope: "global" as const,
            confirmGlobal: true as const,
        };
        expect(StoryboardGlobalPublishRequestSchema.parse(request)).toEqual(request);
        expect(() => StoryboardGlobalPublishRequestSchema.parse({...request, confirmGlobal: false})).toThrow();
        expect(() => StoryboardGlobalPublishRequestSchema.parse({...request, prompt: "1girl", seed: 1})).toThrow();
    });
});
