import {describe, expect, it, vi} from "vitest";
import {createTagPatternSetHashes, TagPatternSetSchema} from "nbook/shared/text-to-image-tag-pattern";
import {createStoryboardPresetHashes, StoryboardPresetSchema} from "nbook/shared/text-to-image-storyboard-preset";
import {renderStoryboardPresetMarkdown} from "nbook/server/text-to-image/storyboard-preset.codec";
import {renderTagPatternMarkdown} from "nbook/server/text-to-image/tag-pattern.codec";
import {
    StoryboardPlanningSnapshotService,
    type StoryboardPlanningSnapshotPorts,
} from "nbook/server/text-to-image/storyboard-planning-snapshot.service";

function createPreset() {
    const pending = StoryboardPresetSchema.parse({
        schema: "nbook.storyboard-preset/v1",
        presetId: "default",
        patternSetId: "default",
        packageId: "default",
        resourceKey: "default",
        title: "Preset",
        enabled: true,
        source: {kind: "manual"},
        review: {status: "pending"},
        matching: {normalization: "nfkc-casefold"},
        defaults: {preferredShotCount: {min: 2, max: 4}, minimumParagraphGap: 1},
        macros: {bindings: {}, unresolved: []},
        rules: [{
            ruleId: "base.rule",
            sourceEntryId: "entry.base.rule",
            kind: "shot-selection",
            order: 0,
            enabled: true,
            when: {mode: "always", any: [], andAny: []},
            effect: {operation: "prefer", beatTypes: ["action"], distribution: "balanced", scoreDelta: 0},
        }],
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

function createPatternSet() {
    const pending = TagPatternSetSchema.parse({
        schema: "nbook.tag-pattern-set/v1",
        patternSetId: "default",
        presetId: "default",
        packageId: "default",
        resourceKey: "default",
        title: "Patterns",
        enabled: true,
        source: {kind: "manual"},
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

function createPorts(input: {
    preset?: ReturnType<typeof createPreset> | null;
    patterns?: ReturnType<typeof createPatternSet> | null;
    events?: string[];
} = {}): StoryboardPlanningSnapshotPorts & {readGlobal: ReturnType<typeof vi.fn>} {
    const preset = input.preset === undefined ? createPreset() : input.preset;
    const patterns = input.patterns === undefined ? createPatternSet() : input.patterns;
    const events = input.events ?? [];
    const readGlobal = vi.fn(async (path: string) => {
        events.push(`read:${path}`);
        if (path === "storyboard-presets/default.md") return preset === null ? null : renderStoryboardPresetMarkdown(preset, "# Preset");
        if (path === "tag-patterns/default.md") return patterns === null ? null : renderTagPatternMarkdown(patterns, "# Patterns");
        return null;
    });
    return {
        ensureDefault: vi.fn(async () => {
            events.push("ensure");
        }),
        readSelector: vi.fn(async () => {
            events.push("selector");
            return {storyboardPresetKey: "storyboard-presets/default.md", configHash: "sha256:selector"};
        }),
        readGlobal,
    };
}

describe("StoryboardPlanningSnapshotService", () => {
    it("reads the approved global pair with base-only provenance", async () => {
        const preset = createPreset();
        const patternSet = createPatternSet();
        const ports = createPorts({preset, patterns: patternSet});
        const service = new StoryboardPlanningSnapshotService(ports);

        const snapshot = await service.read();

        expect(snapshot.preset).toMatchObject({
            presetId: "default",
            semanticHash: createStoryboardPresetHashes(preset).semanticHash,
        });
        expect(snapshot.preset.provenance).toEqual(preset.rules.map((rule) => ({
            ruleId: rule.ruleId,
            scope: "base",
            operation: "base",
            sourceEntryId: rule.sourceEntryId ?? null,
        })));
        expect(snapshot.patterns).toMatchObject({
            patternSetId: "default",
            planningHash: createTagPatternSetHashes(patternSet).planningHash,
            renderHash: createTagPatternSetHashes(patternSet).renderHash,
        });
        expect(ports.readGlobal).toHaveBeenCalledWith("storyboard-presets/default.md");
        expect(ports.readGlobal).toHaveBeenCalledWith("tag-patterns/default.md");
        expect(ports.readGlobal.mock.calls).toEqual([
            ["storyboard-presets/default.md"],
            ["tag-patterns/default.md"],
        ]);
    });

    it("initializes before it reads the selector or global files", async () => {
        const events: string[] = [];
        const ports = createPorts({events});

        await new StoryboardPlanningSnapshotService(ports).read();

        expect(events).toEqual([
            "ensure",
            "selector",
            "read:storyboard-presets/default.md",
            "read:tag-patterns/default.md",
        ]);
    });

    it.each([
        ["preset", "STORYBOARD_PRESET_STALE"],
        ["patterns", "TAG_PATTERN_SET_STALE"],
    ] as const)("rejects a missing global %s with %s", async (missing, code) => {
        const ports = createPorts(missing === "preset" ? {preset: null} : {patterns: null});

        await expect(new StoryboardPlanningSnapshotService(ports).read()).rejects.toThrow(code);
    });

    it("rejects pending or drifted global content", async () => {
        const pending = createPatternSet();
        const drifted = TagPatternSetSchema.parse({
            ...pending,
            review: {
                ...pending.review,
                approvedPlanningHash: `sha256:${"0".repeat(64)}`,
            },
        });

        await expect(new StoryboardPlanningSnapshotService(createPorts({
            patterns: TagPatternSetSchema.parse({...pending, review: {status: "pending"}}),
        })).read()).rejects.toThrow("TAG_PATTERN_SET_STALE");
        await expect(new StoryboardPlanningSnapshotService(createPorts({patterns: drifted})).read()).rejects.toThrow("TAG_PATTERN_SET_STALE");
    });
});
