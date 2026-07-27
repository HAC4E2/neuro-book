import fs from "node:fs/promises";
import path from "node:path";
import {describe, expect, it} from "vitest";

const ROOT = process.cwd();
const OLD_RUNTIME_FILES = [
    "app/components/novel-ide/text-to-image/TextToImageLlmWorkspace.vue",
    "app/components/novel-ide/text-to-image/TextToImageProviderSection.vue",
    "app/utils/text-to-image-llm.ts",
    "app/utils/text-to-image-character-design.ts",
    "server/api/text-to-image/llm-completion.post.ts",
    "server/api/text-to-image/llm-models.post.ts",
    "server/api/text-to-image/body-character-tags.post.ts",
    "server/api/text-to-image/body-prompt-placements.post.ts",
    "server/api/text-to-image/providers/[id]/models.get.ts",
    "server/api/text-to-image/providers/index.get.ts",
    "server/api/text-to-image/providers/index.post.ts",
    "server/api/text-to-image/providers/[id].patch.ts",
    "server/api/text-to-image/providers/[id].delete.ts",
    "server/text-to-image/llm-provider.ts",
    "server/text-to-image/body-image-character-tags.ts",
    "server/text-to-image/body-image-prompt-placement.ts",
    "server/text-to-image/prompt-compiler.ts",
    "assets/workspace/.nbook/agent/profiles/builtin/body-image.character-detector.profile.tsx",
    "assets/workspace/.nbook/agent/profiles/builtin/body-image.prompt-placer.profile.tsx",
    "assets/workspace/.nbook/agent/skills/body-image-character-detection/SKILL.md",
    "assets/workspace/.nbook/agent/skills/body-image-prompt-placement/SKILL.md",
    "assets/workspace/.nbook/agent/skills/character-image-tag-generation/SKILL.md",
] as const;

const OLD_RUNTIME_TOKENS = [
    ["body-image", ".character-detector"].join(""),
    ["body-image", ".prompt-placer"].join(""),
    ["llm", "-completion"].join(""),
    ["llm", "-models"].join(""),
    ["body", "-character-tags"].join(""),
    ["body", "-prompt-placements"].join(""),
    ["TextToImageLlm", "Workspace"].join(""),
    ["TextToImageLlm", "ContextPreset"].join(""),
    ["resolveLlm", "TaskBinding"].join(""),
    ["requestTextToImageLlm", "Completion"].join(""),
    ["bodyImage", "Generating"].join(""),
    ["canGenerate", "BodyImage"].join(""),
    ["generate-body", "-image"].join(""),
    ["replaceBody", "Prompt"].join(""),
    ["openai", "_compatible"].join(""),
] as const;

describe("Route B old body-image chain removal", () => {
    // 全仓运行时源码扫描；上游合并后文件量增大，默认 5s 超时不够。
    it("has no old runtime artifact, endpoint, Profile, Skill, store or Provider kind", {timeout: 60_000}, async () => {
        const existingFiles = (await Promise.all(OLD_RUNTIME_FILES.map(async (relativePath) =>
            await exists(path.join(ROOT, ...relativePath.split("/"))) ? relativePath : null)))
            .filter((relativePath): relativePath is string => relativePath !== null);
        expect(existingFiles).toEqual([]);

        const runtimeFiles = await collectRuntimeFiles([
            "app",
            "server/api/text-to-image",
            "server/text-to-image",
            "server/agent/profiles/builtin-contracts.ts",
            "shared",
            "prisma/schema.prisma",
            "prisma/schema.sqlite.prisma",
            "assets/workspace/.nbook/agent/profiles",
            "assets/workspace/.nbook/agent/skills",
        ]);
        const matches: string[] = [];
        for (const file of runtimeFiles) {
            const source = await fs.readFile(file, "utf8");
            for (const token of OLD_RUNTIME_TOKENS) {
                if (source.includes(token)) matches.push(`${path.relative(ROOT, file).replaceAll("\\", "/")}: ${token}`);
            }
        }
        expect(matches).toEqual([]);
    });
});

/** 递归收集真正进入运行时/构建的源码；测试与生成物不参与硬切审计。 */
async function collectRuntimeFiles(relativeEntries: readonly string[]): Promise<string[]> {
    const files: string[] = [];
    for (const entry of relativeEntries) {
        const absolutePath = path.join(ROOT, ...entry.split("/"));
        const stat = await fs.stat(absolutePath);
        if (stat.isFile()) {
            files.push(absolutePath);
            continue;
        }
        const children = await fs.readdir(absolutePath, {withFileTypes: true});
        const nested = children
            .filter((child) => !child.name.includes(".test.") && child.name !== "generated")
            .map((child) => path.relative(ROOT, path.join(absolutePath, child.name)).replaceAll("\\", "/"));
        files.push(...await collectRuntimeFiles(nested));
    }
    return files;
}

/** 文件存在性检查只把 ENOENT 视为已删除，其他 I/O 错误必须暴露。 */
async function exists(file: string): Promise<boolean> {
    try {
        await fs.access(file);
        return true;
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
        throw error;
    }
}
