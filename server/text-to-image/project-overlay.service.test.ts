import {describe, expect, it} from "vitest";
import {
    ProjectOverlayConflictError,
    ProjectOverlayService,
    type ProjectOverlayFileStore,
    type ProjectOverlaySelectorStore,
} from "nbook/server/text-to-image/project-overlay.service";
import {parseTagPatternOverlayMarkdown, renderTagPatternOverlayMarkdown} from "nbook/server/text-to-image/tag-pattern-overlay.codec";
import {renderStoryboardPresetMarkdown} from "nbook/server/text-to-image/storyboard-preset.codec";
import {renderTagPatternMarkdown} from "nbook/server/text-to-image/tag-pattern.codec";
import {
    createStoryboardPresetHashes,
    StoryboardPresetSchema,
} from "nbook/shared/text-to-image-storyboard-preset";
import {
    createTagPatternSetHashes,
    TagPatternOverlaySchema,
    TagPatternSetSchema,
} from "nbook/shared/text-to-image-tag-pattern";

describe("ProjectOverlayService", () => {
    it("缺文件时返回绑定 active companion hashes 的 pending 空 overlay，不产生写入", async () => {
        const fixture = createFixture();
        const snapshot = await fixture.service.read({projectPath: "workspace/demo"});

        expect(snapshot.base.presetId).toBe("default");
        expect(snapshot.storyboard.exists).toBe(false);
        expect(snapshot.patterns.exists).toBe(false);
        expect(snapshot.storyboard.reviewState).toBe("pending");
        expect(snapshot.patterns.reviewState).toBe("pending");
        expect(snapshot.storyboard.effectiveStatus).toBe("skipped_stale");
        expect(fixture.projectFiles.size).toBe(0);
    });

    it("向 Planning Input 只暴露解析后的 Effective Preset / Pattern 快照", async () => {
        const fixture = createFixture();
        const snapshot = await fixture.service.readEffective({projectPath: "workspace/demo"});

        expect(snapshot.preset).toMatchObject({presetId: "default", rules: []});
        expect(snapshot.preset.semanticHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
        expect(snapshot.patterns).toMatchObject({patternSetId: "default", patterns: [], provenance: []});
        expect(snapshot.patterns.planningHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
        expect(fixture.projectFiles.size).toBe(0);
    });

    it("apply 由服务端冻结 approved hash；同 expected hash 并发只有一个写入", async () => {
        const fixture = createFixture();
        const initial = await fixture.service.read({projectPath: "workspace/demo"});
        const request = {
            projectPath: "workspace/demo",
            presetId: "default",
            kind: "storyboard" as const,
            markdown: initial.storyboard.markdown,
            expectedFileHash: null,
            mode: "apply" as const,
        };

        const results = await Promise.allSettled([
            fixture.service.save(request),
            fixture.service.save(request),
        ]);

        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
        const completed = results.find((result) => result.status === "fulfilled");
        expect(completed?.value.storyboard.reviewState).toBe("approved");
        expect(completed?.value.storyboard.effectiveStatus).toBe("applied");
        expect(fixture.writes).toHaveLength(1);
        const rejected = results.find((result) => result.status === "rejected");
        expect(rejected?.reason).toBeInstanceOf(ProjectOverlayConflictError);
    });

    it("Pattern operation 冲突整份拒绝且不写盘", async () => {
        const fixture = createFixture();
        const initial = await fixture.service.read({projectPath: "workspace/demo"});
        const parsed = parseTagPatternOverlayMarkdown(initial.patterns.markdown);
        const invalid = TagPatternOverlaySchema.parse({
            ...parsed.overlay,
            operations: [{op: "disable", patternId: "missing.pattern"}],
        });

        await expect(fixture.service.save({
            projectPath: "workspace/demo",
            presetId: "default",
            kind: "patterns",
            markdown: renderTagPatternOverlayMarkdown(invalid, parsed.body),
            expectedFileHash: null,
            mode: "apply",
        })).rejects.toMatchObject({code: "TAG_PATTERN_OVERLAY_CONFLICT"});
        expect(fixture.writes).toHaveLength(0);
    });

    it("base hash 漂移后拒绝旧 draft", async () => {
        const fixture = createFixture();
        const initial = await fixture.service.read({projectPath: "workspace/demo"});
        fixture.globalFiles.set("storyboard-presets/default.md", renderStoryboardPresetMarkdown(createApprovedStoryboard(3)));

        await expect(fixture.service.save({
            projectPath: "workspace/demo",
            presetId: "default",
            kind: "storyboard",
            markdown: initial.storyboard.markdown,
            expectedFileHash: null,
            mode: "draft",
        })).rejects.toMatchObject({code: "STORYBOARD_PRESET_STALE"});
        expect(fixture.writes).toHaveLength(0);
    });

    it("active preset stale 时领域错误码只出现一次", async () => {
        const fixture = createFixture();
        const pending = StoryboardPresetSchema.parse({
            ...createApprovedStoryboard(2),
            review: {status: "pending"},
        });
        fixture.globalFiles.set("storyboard-presets/default.md", renderStoryboardPresetMarkdown(pending));

        await expect(fixture.service.read({projectPath: "workspace/demo"})).rejects.toMatchObject({
            code: "STORYBOARD_PRESET_STALE",
            message: "STORYBOARD_PRESET_STALE: Storyboard Preset 未获批准或已漂移",
        });
    });
});

function createFixture(): {
    service: ProjectOverlayService;
    globalFiles: Map<string, string>;
    projectFiles: Map<string, string>;
    writes: string[];
} {
    const globalFiles = new Map<string, string>([
        ["storyboard-presets/default.md", renderStoryboardPresetMarkdown(createApprovedStoryboard(2))],
        ["tag-patterns/default.md", renderTagPatternMarkdown(createApprovedPatterns())],
    ]);
    const projectFiles = new Map<string, string>();
    const writes: string[] = [];
    const store: ProjectOverlayFileStore = {
        resolveProjectRoot: async (projectPath) => projectPath,
        assertProjectOpen: () => undefined,
        readGlobal: async (filePath) => globalFiles.get(filePath) ?? null,
        readProject: async (_root, filePath) => projectFiles.get(filePath) ?? null,
        writeProject: async ({filePath, content}) => {
            await Promise.resolve();
            projectFiles.set(filePath, content);
            writes.push(filePath);
        },
        invalidate: () => undefined,
    };
    const selector: ProjectOverlaySelectorStore = {
        read: async () => ({storyboardPresetKey: "storyboard-presets/default.md", configHash: `sha256:${"d".repeat(64)}`}),
    };
    return {service: new ProjectOverlayService({store, selector}), globalFiles, projectFiles, writes};
}

function createApprovedStoryboard(minimumParagraphGap: number) {
    const pending = StoryboardPresetSchema.parse({
        schema: "nbook.storyboard-preset/v1",
        presetId: "default",
        patternSetId: "default",
        packageId: "default",
        resourceKey: "default",
        title: "Default",
        enabled: true,
        source: {kind: "builtin", assetVersion: "test/v1"},
        review: {status: "pending"},
        matching: {normalization: "nfkc-casefold"},
        defaults: {preferredShotCount: {min: 1, max: 3}, minimumParagraphGap},
        macros: {bindings: {}, unresolved: []},
        rules: [],
        risks: [],
    });
    const hashes = createStoryboardPresetHashes(pending);
    return StoryboardPresetSchema.parse({
        ...pending,
        review: {
            status: "approved",
            approvedSemanticHash: hashes.semanticHash,
            approvedDiagnosticHash: hashes.diagnosticHash,
            approvedRawSourceHash: null,
            approvedSanitizedSourceHash: null,
        },
    });
}

function createApprovedPatterns() {
    const pending = TagPatternSetSchema.parse({
        schema: "nbook.tag-pattern-set/v1",
        patternSetId: "default",
        presetId: "default",
        packageId: "default",
        resourceKey: "default",
        title: "Default",
        enabled: true,
        source: {kind: "builtin", assetVersion: "test/v1"},
        review: {status: "pending"},
        patterns: [],
        risks: [],
    });
    const hashes = createTagPatternSetHashes(pending);
    return TagPatternSetSchema.parse({
        ...pending,
        review: {
            status: "approved",
            approvedPlanningHash: hashes.planningHash,
            approvedRenderHash: hashes.renderHash,
            approvedRawSourceHash: null,
            approvedSanitizedSourceHash: null,
        },
    });
}
