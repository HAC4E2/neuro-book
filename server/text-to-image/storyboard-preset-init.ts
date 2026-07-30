import path from "node:path";
import fs from "node:fs/promises";
import {resolveGlobalProfileNbookRoot} from "nbook/server/text-to-image/compat";
import {appLogger} from "nbook/server/app-logs/logger";
import {
    StoryboardPresetSchema,
    createStoryboardPresetHashes,
} from "nbook/shared/text-to-image-storyboard-preset";
import {
    TagPatternSetSchema,
    createTagPatternSetHashes,
} from "nbook/shared/text-to-image-tag-pattern";
import {parseStoryboardPresetMarkdown, renderStoryboardPresetMarkdown} from "nbook/server/text-to-image/storyboard-preset.codec";
import {parseTagPatternMarkdown, renderTagPatternMarkdown} from "nbook/server/text-to-image/tag-pattern.codec";
import {assertStoryboardPatternPair} from "nbook/server/text-to-image/storyboard-companion";

const PROFILE_KEY = "illustration.director";
const DEFAULT_PRESET_ID = "default";

/** 服务启动时确保系统默认 storyboard preset 与 tag pattern 成对存在并已审批。 */
export async function ensureDefaultStoryboardPreset(workspaceRoot?: string): Promise<void> {
    const nbookRoot = resolveGlobalProfileNbookRoot(workspaceRoot);
    const presetDir = path.join(nbookRoot, "agents", PROFILE_KEY, "storyboard-presets");
    const patternDir = path.join(nbookRoot, "agents", PROFILE_KEY, "tag-patterns");
    const presetPath = path.join(presetDir, `${DEFAULT_PRESET_ID}.md`);
    const patternPath = path.join(patternDir, `${DEFAULT_PRESET_ID}.md`);

    const defaultCompanion = createDefaultCompanionMarkdown();
    const [presetText, patternText] = await Promise.all([
        readOptional(presetPath),
        readOptional(patternPath),
    ]);

    if (presetText !== null && patternText !== null) {
        try {
            const preset = parseStoryboardPresetMarkdown(presetText);
            const patterns = parseTagPatternMarkdown(patternText);
            assertStoryboardPatternPair({preset: preset.preset, patternSet: patterns.patternSet});
            return;
        } catch {
            // 未知用户内容保持原样并继续由 strict resolver 报错。
        }
    }

    const missingBoth = presetText === null && patternText === null;
    const canonicalPartial = presetText?.replaceAll("\r\n", "\n") === defaultCompanion.presetMarkdown.replaceAll("\r\n", "\n")
        || patternText?.replaceAll("\r\n", "\n") === defaultCompanion.patternMarkdown.replaceAll("\r\n", "\n");
    if (missingBoth || canonicalPartial) {
        try {
            await fs.mkdir(presetDir, {recursive: true});
            await fs.mkdir(patternDir, {recursive: true});
            await Promise.all([
                fs.writeFile(presetPath, defaultCompanion.presetMarkdown, "utf-8"),
                fs.writeFile(patternPath, defaultCompanion.patternMarkdown, "utf-8"),
            ]);
            await appLogger.info(
                "storyboard-preset-init.created",
                undefined,
                `默认 Storyboard companion 已创建或纠正: ${presetPath}`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await appLogger.error(
                "storyboard-preset-init.failed",
                undefined,
                `默认 Storyboard companion 初始化失败: ${message}`,
            );
        }
        return;
    }

    await appLogger.error(
        "storyboard-preset-init.invalid-existing",
        undefined,
        `默认 Storyboard companion 已存在但不符合系统默认合同，已保留原文件: ${presetPath}`,
    );
}

/** 创建经过 hash 冻结的系统默认 companion Markdown。 */
function createDefaultCompanionMarkdown(): {presetMarkdown: string; patternMarkdown: string} {
    try {
        const presetInput = {
            schema: "nbook.storyboard-preset/v1" as const,
            presetId: DEFAULT_PRESET_ID,
            patternSetId: DEFAULT_PRESET_ID,
            packageId: DEFAULT_PRESET_ID,
            resourceKey: DEFAULT_PRESET_ID,
            title: "\u9ED8\u8BA4\u5206\u955C\u9884\u8BBE",
            enabled: true,
            source: {kind: "builtin" as const, assetVersion: "1.0.0"},
            review: {status: "pending" as const},
            matching: {normalization: "nfkc-casefold" as const},
            defaults: {preferredShotCount: {min: 3, max: 8}, minimumParagraphGap: 3},
            macros: {bindings: {}, unresolved: []},
            rules: [
                {
                    ruleId: "default-shot-selection",
                    kind: "shot-selection" as const,
                    order: 0,
                    enabled: true,
                    when: {mode: "always" as const, any: [], andAny: []},
                    effect: {
                        operation: "prefer" as const,
                        beatTypes: ["action", "reveal", "establishing"] as const,
                        distribution: "balanced" as const,
                        scoreDelta: 0,
                    },
                },
                {
                    ruleId: "default-composition",
                    kind: "composition" as const,
                    order: 1,
                    enabled: true,
                    when: {mode: "always" as const, any: [], andAny: []},
                    effect: {
                        shotSize: "medium" as const,
                        cameraAngle: "eye-level" as const,
                        viewpoint: "objective" as const,
                    },
                },
                {
                    ruleId: "default-canvas",
                    kind: "canvas-intent" as const,
                    order: 2,
                    enabled: true,
                    when: {mode: "always" as const, any: [], andAny: []},
                    effect: {canvasIntent: "portrait" as const},
                },
            ],
            risks: [],
        };

        const patternInput = {
            schema: "nbook.tag-pattern-set/v1" as const,
            patternSetId: DEFAULT_PRESET_ID,
            presetId: DEFAULT_PRESET_ID,
            packageId: DEFAULT_PRESET_ID,
            resourceKey: DEFAULT_PRESET_ID,
            title: "\u9ED8\u8BA4\u753B\u98CE\u4E32",
            enabled: true,
            source: {kind: "builtin" as const, assetVersion: "1.0.0"},
            review: {status: "pending" as const},
            patterns: [],
            risks: [],
        };

        const validPreset = StoryboardPresetSchema.parse(presetInput);
        const validPattern = TagPatternSetSchema.parse(patternInput);

        const presetHashes = createStoryboardPresetHashes(validPreset);
        const patternHashes = createTagPatternSetHashes(validPattern);

        const approvedPreset = {
            ...validPreset,
            review: {
                status: "approved" as const,
                approvedSemanticHash: presetHashes.semanticHash,
                approvedDiagnosticHash: presetHashes.diagnosticHash,
                approvedRawSourceHash: null,
                approvedSanitizedSourceHash: null,
            },
        };

        const approvedPattern = {
            ...validPattern,
            review: {
                status: "approved" as const,
                approvedPlanningHash: patternHashes.planningHash,
                approvedRenderHash: patternHashes.renderHash,
                approvedRawSourceHash: null,
                approvedSanitizedSourceHash: null,
            },
        };

        const presetMarkdown = renderStoryboardPresetMarkdown(
            approvedPreset,
            "# \u9ED8\u8BA4\u5206\u955C\u9884\u8BBE\n\n\u7CFB\u7EDF\u5185\u7F6E\u7684\u9ED8\u8BA4\u5206\u955C\u9884\u8BBE\uFF0C\u63D0\u4F9B\u57FA\u7840\u7684\u753B\u9762\u9009\u62E9\u548C\u6784\u56FE\u89C4\u5219\u3002",
        );
        const patternMarkdown = renderTagPatternMarkdown(
            approvedPattern,
            "# \u9ED8\u8BA4\u753B\u98CE\u4E32\n\n\u7CFB\u7EDF\u5185\u7F6E\u7684\u9ED8\u8BA4\u753B\u98CE\u4E32\u3002",
        );

        return {presetMarkdown, patternMarkdown};
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`系统默认 Storyboard companion 构造失败: ${message}`);
    }
}

/** 文件不存在时返回 null，其余读取错误继续抛出。 */
async function readOptional(filePath: string): Promise<string | null> {
    try {
        return await fs.readFile(filePath, "utf-8");
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}
