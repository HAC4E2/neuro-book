import fs from "node:fs/promises";
import path from "node:path";
import {describe, expect, it} from "vitest";

const ROOT = process.cwd();
const REMOVED_FILES = [
    "shared/text-to-image-project-overlays.ts",
    "server/text-to-image/storyboard-overlay.codec.ts",
    "server/text-to-image/tag-pattern-overlay.codec.ts",
    "server/text-to-image/storyboard-rule-resolver.ts",
    "server/text-to-image/storyboard-rule-resolver.test.ts",
    "server/text-to-image/tag-pattern-resolver.ts",
    "server/text-to-image/tag-pattern-resolver.test.ts",
    "server/text-to-image/project-overlay.service.ts",
    "server/text-to-image/project-overlay.service.test.ts",
    "server/text-to-image/project-overlay-http-error.ts",
    "server/text-to-image/project-overlay.codec.test.ts",
    "server/api/text-to-image/project-overlays/index.get.ts",
    "server/api/text-to-image/project-overlays/index.patch.ts",
    "server/api/text-to-image/project-overlays/project-overlay-api-contract.test.ts",
    "app/components/novel-ide/text-to-image/TextToImageProjectOverlayPanel.vue",
    "server/text-to-image/project-overlay-ui-contract.test.ts",
] as const;

const PRODUCTION_ROOTS = [
    "app",
    "shared",
    "server",
    "assets/workspace/.nbook/agent",
] as const;

const BANNED_TOKENS = [
    "ProjectOverlay",
    "StoryboardOverlay",
    "TagPatternOverlay",
    "ProjectOverlayService",
    "ProjectOverlayError",
    "ProjectOverlayEditorSnapshot",
    "STORYBOARD_OVERLAY_SCHEMA",
    "StoryboardOverlaySchema",
    "TAG_PATTERN_OVERLAY_SCHEMA",
    "TagPatternOverlaySchema",
    "createStoryboardOverlaySemanticHash",
    "resolveStoryboardOverlayReviewState",
    "createTagPatternOverlayHashes",
    "resolveTagPatternOverlayReviewState",
    "throwProjectOverlayHttpError",
    "nbook/server/text-to-image/storyboard-overlay.codec",
    "nbook/server/text-to-image/tag-pattern-overlay.codec",
    "nbook/server/text-to-image/storyboard-rule-resolver",
    "nbook/server/text-to-image/tag-pattern-resolver",
    "nbook/server/text-to-image/project-overlay.service",
    "nbook/server/text-to-image/project-overlay-http-error",
    "nbook/shared/text-to-image-project-overlays",
    "nbook.storyboard-overlay/v1",
    "nbook.tag-pattern-overlay/v1",
    "nbook.project-overlay-editor/v1",
    "storyboard-overlays/",
    "tag-pattern-overlays/",
    "/api/text-to-image/project-overlays",
    "TextToImageProjectOverlayPanel",
] as const;

describe("Project overlay removal", () => {
    it("has no Project overlay owner, protocol, route or UI surface", {timeout: 60_000}, async () => {
        const existingFiles = (await Promise.all(REMOVED_FILES.map(async (relativePath) =>
            await pathExists(relativePath) ? relativePath : null)))
            .filter((relativePath): relativePath is typeof REMOVED_FILES[number] => relativePath !== null);
        expect(existingFiles).toEqual([]);

        const matches: string[] = [];
        for (const file of await collectProductionFiles(PRODUCTION_ROOTS)) {
            const source = await fs.readFile(file, "utf8");
            for (const token of BANNED_TOKENS) {
                if (source.includes(token)) {
                    matches.push(`${path.relative(ROOT, file).replaceAll("\\", "/")}: ${token}`);
                }
            }
        }
        expect(matches).toEqual([]);
    });

    it("preserves global snapshot, default, import and publish owners", async () => {
        const snapshotService = await readSource("server/text-to-image/storyboard-planning-snapshot.service.ts");
        const storyboardPanel = await readSource("app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue");

        expect(snapshotService).toContain("readIllustrationDirectorSelectorSnapshot");
        expect(snapshotService).toContain("ensureDefaultStoryboardPreset");
        expect(storyboardPanel).toContain("TextToImageStoryboardImportPanel");
        expect(storyboardPanel).not.toContain("@global-published");
        expect(await pathExists("server/text-to-image/storyboard-publish.service.ts")).toBe(true);
    });
});

/** 递归收集真正进入构建的源码与 bundled runtime 文本；测试、fixture、staging 与生成物不参与 token 审计。 */
async function collectProductionFiles(relativeEntries: readonly string[]): Promise<string[]> {
    const files: string[] = [];
    for (const entry of relativeEntries) {
        const absolutePath = resolveRepoPath(entry);
        const stat = await fs.stat(absolutePath);
        if (stat.isFile()) {
            if (isProductionSource(absolutePath)) files.push(absolutePath);
            continue;
        }
        const children = await fs.readdir(absolutePath, {withFileTypes: true});
        const nested = children
            .filter((child) => !["fixtures", "__fixtures__", "generated", ".compiled", ".staging"].includes(child.name))
            .map((child) => path.relative(ROOT, path.join(absolutePath, child.name)).replaceAll("\\", "/"));
        files.push(...await collectProductionFiles(nested));
    }
    return files;
}

/** 只扫描会影响运行的源码、Markdown 与文本配置，不扫描测试或二进制文件。 */
function isProductionSource(file: string): boolean {
    return /\.(?:[cm]?[jt]sx?|vue|md|jsonc?|ya?ml|toml)$/u.test(file)
        && !/\.(?:test|spec)\.[^/\\]+$/u.test(file);
}

/** 读取仓库内 UTF-8 源码。 */
async function readSource(relativePath: string): Promise<string> {
    return await fs.readFile(resolveRepoPath(relativePath), "utf8");
}

/** 文件存在性检查只把 ENOENT 视为已删除，其他 I/O 错误必须暴露。 */
async function pathExists(relativePath: string): Promise<boolean> {
    try {
        await fs.access(resolveRepoPath(relativePath));
        return true;
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
        throw error;
    }
}

/** 将 POSIX 风格仓库相对路径转换为当前平台绝对路径。 */
function resolveRepoPath(relativePath: string): string {
    return path.join(ROOT, ...relativePath.split("/"));
}
