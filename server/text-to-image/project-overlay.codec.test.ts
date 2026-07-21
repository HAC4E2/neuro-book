import {describe, expect, it} from "vitest";
import {
    parseStoryboardOverlayMarkdown,
    renderStoryboardOverlayMarkdown,
} from "nbook/server/text-to-image/storyboard-overlay.codec";
import {
    parseTagPatternOverlayMarkdown,
    renderTagPatternOverlayMarkdown,
} from "nbook/server/text-to-image/tag-pattern-overlay.codec";
import {
    ProjectOverlaySaveRequestSchema,
} from "nbook/shared/text-to-image-project-overlays";
import {
    createStoryboardOverlaySemanticHash,
    StoryboardOverlaySchema,
} from "nbook/shared/text-to-image-storyboard-preset";
import {
    createTagPatternOverlayHashes,
    TagPatternOverlaySchema,
} from "nbook/shared/text-to-image-tag-pattern";

const BASE_STORYBOARD_HASH = `sha256:${"a".repeat(64)}`;
const BASE_PATTERN_PLANNING_HASH = `sha256:${"b".repeat(64)}`;
const BASE_PATTERN_RENDER_HASH = `sha256:${"c".repeat(64)}`;

describe("Project overlay Markdown codecs", () => {
    it("canonical round-trip 两类 pending overlay，正文只改变 file hash", () => {
        const storyboard = StoryboardOverlaySchema.parse({
            schema: "nbook.storyboard-overlay/v1",
            overlayId: "project.demo.storyboard",
            presetId: "demo",
            enabled: true,
            baseSemanticHash: BASE_STORYBOARD_HASH,
            review: {status: "pending"},
            macroBindings: {},
            operations: [],
        });
        const patterns = TagPatternOverlaySchema.parse({
            schema: "nbook.tag-pattern-overlay/v1",
            overlayId: "project.demo.patterns",
            patternSetId: "demo",
            enabled: true,
            basePlanningHash: BASE_PATTERN_PLANNING_HASH,
            baseRenderHash: BASE_PATTERN_RENDER_HASH,
            review: {status: "pending"},
            operations: [],
        });

        const storyboardMarkdown = renderStoryboardOverlayMarkdown(storyboard, "# Project rules\n");
        const parsedStoryboard = parseStoryboardOverlayMarkdown(storyboardMarkdown);
        const changedStoryboardBody = parseStoryboardOverlayMarkdown(renderStoryboardOverlayMarkdown(storyboard, "# Changed\n"));
        expect(parsedStoryboard.overlay).toEqual(storyboard);
        expect(parsedStoryboard.semanticHash).toBe(createStoryboardOverlaySemanticHash(storyboard));
        expect(changedStoryboardBody.semanticHash).toBe(parsedStoryboard.semanticHash);
        expect(changedStoryboardBody.fileHash).not.toBe(parsedStoryboard.fileHash);

        const patternMarkdown = renderTagPatternOverlayMarkdown(patterns, "# Project patterns\n");
        const parsedPatterns = parseTagPatternOverlayMarkdown(patternMarkdown);
        const changedPatternBody = parseTagPatternOverlayMarkdown(renderTagPatternOverlayMarkdown(patterns, "# Changed\n"));
        expect(parsedPatterns.overlay).toEqual(patterns);
        expect(parsedPatterns.hashes).toEqual(createTagPatternOverlayHashes(patterns));
        expect(changedPatternBody.hashes).toEqual(parsedPatterns.hashes);
        expect(changedPatternBody.fileHash).not.toBe(parsedPatterns.fileHash);
    });

    it("save DTO 只接受 Project identity、Markdown、expected hash 与 draft/apply 模式", () => {
        expect(ProjectOverlaySaveRequestSchema.parse({
            projectPath: "workspace/demo",
            presetId: "demo",
            kind: "storyboard",
            markdown: "---\nexample: true\n---\n",
            expectedFileHash: null,
            mode: "draft",
        }).mode).toBe("draft");
        expect(() => ProjectOverlaySaveRequestSchema.parse({
            projectPath: "workspace/demo",
            presetId: "demo",
            kind: "patterns",
            markdown: "---\nexample: true\n---\n",
            expectedFileHash: null,
            mode: "apply",
            sampler: "k_euler",
        })).toThrow();
        expect(() => ProjectOverlaySaveRequestSchema.parse({
            projectPath: "workspace/demo",
            presetId: "demo",
            kind: "storyboard",
            markdown: "x",
            expectedFileHash: null,
            mode: "draft",
            targetPath: "storyboard-overrides/demo.md",
        })).toThrow();
        expect(() => ProjectOverlaySaveRequestSchema.parse({
            projectPath: "workspace/demo",
            presetId: "windows:invalid",
            kind: "storyboard",
            markdown: "x",
            expectedFileHash: null,
            mode: "draft",
        })).toThrow();
    });
});
