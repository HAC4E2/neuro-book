import {createGlobalProfileHomeFacade, type ProfileHomeFacade} from "nbook/server/agent/profiles/profile-home";
import {
    readIllustrationDirectorSelectorSnapshot,
    type IllustrationDirectorSelectorSnapshot,
} from "nbook/server/config/config-service";
import {assertStoryboardPatternPair} from "nbook/server/text-to-image/storyboard-companion";
import {resolveGlobalProfileNbookRoot} from "nbook/server/text-to-image/compat";
import {ensureDefaultStoryboardPreset} from "nbook/server/text-to-image/storyboard-preset-init";
import {parseStoryboardPresetMarkdown} from "nbook/server/text-to-image/storyboard-preset.codec";
import {parseTagPatternMarkdown} from "nbook/server/text-to-image/tag-pattern.codec";
import {createTagPatternSetHashes, type TagPattern} from "nbook/shared/text-to-image-tag-pattern";
import {createStoryboardPresetHashes, type StoryboardRule} from "nbook/shared/text-to-image-storyboard-preset";

const PROFILE_KEY = "illustration.director";

export type StoryboardPlanningSnapshot = {
    preset: {
        presetId: string;
        semanticHash: string;
        rules: StoryboardRule[];
        provenance: Array<{ruleId: string; scope: "base"; operation: "base"; sourceEntryId: string | null}>;
    };
    patterns: {
        patternSetId: string;
        planningHash: string;
        renderHash: string;
        patterns: TagPattern[];
        provenance: Array<{patternId: string; scope: "base"; operation: "base"; sourceEntryId: string | null}>;
    };
};

/** 读取已批准全局 Storyboard companion 所需的最小基础设施。 */
export type StoryboardPlanningSnapshotPorts = {
    ensureDefault(): Promise<void>;
    readSelector(): Promise<IllustrationDirectorSelectorSnapshot>;
    readGlobal(path: string): Promise<string | null>;
};

/** 为 Planning 与 Compiler 提供同一份只读的全局 Storyboard companion 快照。 */
export class StoryboardPlanningSnapshotService {
    private readonly ports: StoryboardPlanningSnapshotPorts;

    constructor(ports: StoryboardPlanningSnapshotPorts = createProductionPorts()) {
        this.ports = ports;
    }

    /** 初始化默认 companion 后读取、校验并投影全局已批准 pair。 */
    async read(): Promise<StoryboardPlanningSnapshot> {
        await this.ports.ensureDefault();
        const selector = await this.ports.readSelector();
        const presetPath = selector.storyboardPresetKey;
        const patternPath = presetPath.replace(/^storyboard-presets\//u, "tag-patterns/");
        const [presetText, patternText] = await Promise.all([
            this.ports.readGlobal(presetPath),
            this.ports.readGlobal(patternPath),
        ]);
        if (presetText === null) throw new Error("STORYBOARD_PRESET_STALE: active Storyboard Preset 缺失");
        if (patternText === null) throw new Error("TAG_PATTERN_SET_STALE: active Tag Pattern companion 缺失");

        try {
            const preset = parseStoryboardPresetMarkdown(presetText).preset;
            const patternSet = parseTagPatternMarkdown(patternText).patternSet;
            assertStoryboardPatternPair({preset, patternSet});
            const presetHashes = createStoryboardPresetHashes(preset);
            const patternHashes = createTagPatternSetHashes(patternSet);
            return {
                preset: {
                    presetId: preset.presetId,
                    semanticHash: presetHashes.semanticHash,
                    rules: preset.rules,
                    provenance: preset.rules.map((rule) => ({
                        ruleId: rule.ruleId,
                        scope: "base",
                        operation: "base",
                        sourceEntryId: rule.sourceEntryId ?? null,
                    })),
                },
                patterns: {
                    patternSetId: patternSet.patternSetId,
                    planningHash: patternHashes.planningHash,
                    renderHash: patternHashes.renderHash,
                    patterns: patternSet.patterns,
                    provenance: patternSet.patterns.map((pattern) => ({
                        patternId: pattern.patternId,
                        scope: "base",
                        operation: "base",
                        sourceEntryId: pattern.sourceEntryId ?? null,
                    })),
                },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const code = message.includes("TAG_PATTERN") ? "TAG_PATTERN_SET_STALE" : "STORYBOARD_PRESET_STALE";
            throw new Error(`${code}: ${message.replace(/^(STORYBOARD_PRESET_STALE|TAG_PATTERN_SET_STALE): /u, "")}`);
        }
    }
}

/** 创建唯一允许读取全局 profile home 的生产端口。 */
function createProductionPorts(): StoryboardPlanningSnapshotPorts {
    const globalHome = createGlobalProfileHomeFacade(resolveGlobalProfileNbookRoot(), PROFILE_KEY);
    return {
        ensureDefault: ensureDefaultStoryboardPreset,
        readSelector: readIllustrationDirectorSelectorSnapshot,
        readGlobal: (path) => readOptionalGlobalText(globalHome, path),
    };
}

/** 将全局 profile home 的文件缺失投影为 null，其余 I/O 错误继续抛出。 */
async function readOptionalGlobalText(home: ProfileHomeFacade, path: string): Promise<string | null> {
    try {
        return await home.readText(path);
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
        throw error;
    }
}
