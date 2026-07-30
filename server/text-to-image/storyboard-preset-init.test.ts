import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ensureDefaultStoryboardPreset} from "nbook/server/text-to-image/storyboard-preset-init";
import {parseStoryboardPresetMarkdown} from "nbook/server/text-to-image/storyboard-preset.codec";
import {parseTagPatternMarkdown} from "nbook/server/text-to-image/tag-pattern.codec";
import {assertStoryboardPatternPair} from "nbook/server/text-to-image/storyboard-companion";

vi.mock("nbook/server/app-logs/logger", () => ({
    appLogger: {
        info: vi.fn(async () => undefined),
        error: vi.fn(async () => undefined),
        flush: vi.fn(async () => undefined),
    },
}));

describe("ensureDefaultStoryboardPreset", () => {
    let workspaceRoot = "";

    beforeEach(async () => {
        workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-storyboard-default-"));
    });

    afterEach(async () => {
        await fs.rm(workspaceRoot, {recursive: true, force: true});
    });

    it("全新 Workspace Root 会创建 approved 且 identity 一致的默认 pair", async () => {
        await ensureDefaultStoryboardPreset(workspaceRoot);

        const companion = await readDefaultCompanion(workspaceRoot);

        expect(companion.preset.reviewState).toBe("approved");
        expect(companion.patterns.reviewState).toBe("approved");
        expect(() => assertStoryboardPatternPair({
            preset: companion.preset.preset,
            patternSet: companion.patterns.patternSet,
        })).not.toThrow();
    });

    it("系统默认 pair 缺少 companion 时会成对恢复", async () => {
        await ensureDefaultStoryboardPreset(workspaceRoot);
        await fs.rm(defaultPaths(workspaceRoot).patternPath);

        await ensureDefaultStoryboardPreset(workspaceRoot);

        const companion = await readDefaultCompanion(workspaceRoot);
        expect(() => assertStoryboardPatternPair({
            preset: companion.preset.preset,
            patternSet: companion.patterns.patternSet,
        })).not.toThrow();
    });

    it("不会覆盖无法识别的用户 default 文件", async () => {
        const paths = defaultPaths(workspaceRoot);
        await fs.mkdir(path.dirname(paths.presetPath), {recursive: true});
        await fs.mkdir(path.dirname(paths.patternPath), {recursive: true});
        await fs.writeFile(paths.presetPath, "user storyboard", "utf-8");
        await fs.writeFile(paths.patternPath, "user patterns", "utf-8");

        await ensureDefaultStoryboardPreset(workspaceRoot);

        await expect(fs.readFile(paths.presetPath, "utf-8")).resolves.toBe("user storyboard");
        await expect(fs.readFile(paths.patternPath, "utf-8")).resolves.toBe("user patterns");
    });
});

/** 读取并按正式 codec 解析默认 companion。 */
async function readDefaultCompanion(workspaceRoot: string) {
    const paths = defaultPaths(workspaceRoot);
    const [presetText, patternText] = await Promise.all([
        fs.readFile(paths.presetPath, "utf-8"),
        fs.readFile(paths.patternPath, "utf-8"),
    ]);
    return {
        preset: parseStoryboardPresetMarkdown(presetText),
        patterns: parseTagPatternMarkdown(patternText),
    };
}

/** 返回测试 Workspace Root 下的默认 pair 路径。 */
function defaultPaths(workspaceRoot: string): {presetPath: string; patternPath: string} {
    const home = path.join(workspaceRoot, ".nbook", "agents", "illustration.director");
    return {
        presetPath: path.join(home, "storyboard-presets", "default.md"),
        patternPath: path.join(home, "tag-patterns", "default.md"),
    };
}
