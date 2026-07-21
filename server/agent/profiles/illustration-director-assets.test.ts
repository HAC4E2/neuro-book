import fs from "node:fs/promises";
import path from "node:path";
import {describe, expect, it} from "vitest";
import {
    ILLUSTRATION_DIRECTOR_CONVERTER_VERSION,
    ILLUSTRATION_DIRECTOR_OPERATION_POLICIES,
} from "nbook/shared/agent/illustration-director";
import illustrationDirectorProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/illustration.director.profile";

const PROFILE_PATH = path.resolve("assets/workspace/.nbook/agent/profiles/builtin/illustration.director.profile.tsx");
const SKILL_PATH = path.resolve("assets/workspace/.nbook/agent/skills/novel-import-chatu8-storyboard-preset/SKILL.md");
const PLANNING_SKILL_PATH = path.resolve("assets/workspace/.nbook/agent/skills/chapter-illustration-direction/SKILL.md");

describe("illustration.director fixed Profile/Skill assets", () => {
    it("冻结 convert-preset 预算与 converter version", () => {
        expect(ILLUSTRATION_DIRECTOR_CONVERTER_VERSION).toBe("route-b-p2.1");
        expect(ILLUSTRATION_DIRECTOR_OPERATION_POLICIES["convert-preset"]).toEqual({
            maxTurns: 32,
            maxToolCalls: 256,
            maxDurationMs: 10 * 60_000,
            maxOutputTokens: 32000,
        });
        expect(ILLUSTRATION_DIRECTOR_OPERATION_POLICIES["propose-character-visual"]).toEqual({
            maxTurns: 6,
            maxToolCalls: 1,
            maxDurationMs: 3 * 60_000,
            maxOutputTokens: 8000,
        });
        expect(ILLUSTRATION_DIRECTOR_OPERATION_POLICIES["plan-chapter"].maxToolCalls).toBe(64);
        expect(ILLUSTRATION_DIRECTOR_OPERATION_POLICIES["plan-selection"].maxToolCalls).toBe(32);
    });

    it("Profile 只绑定窄 import tools + report_result，不含 shell/文件写/网络/Provider/Recipe 工具", async () => {
        const source = await fs.readFile(PROFILE_PATH, "utf8");
        expect(source).toContain('key: "illustration.director"');
        expect(source).toContain('operation: Type.Literal("convert-preset")');
        expect(source).toContain('operation: Type.Literal("propose-character-visual")');
        expect(source).toContain('operation: Type.Literal("plan-chapter")');
        expect(source).toContain('operation: Type.Literal("plan-selection")');
        expect(source).toContain("CharacterVisualDirectorProposalSchema");
        expect(source).toContain("IllustrationPlanningInputBundleSchema");
        expect(source).toContain("IllustrationPlanningProposalSchema");
        expect(source).toContain('ctx.initial.operation === "convert-preset"');
        expect(source).toContain('? ["report_result"]');
        expect(source).toContain('pluginTool("inspect_chatu8_storyboard")');
        expect(source).toContain('pluginTool("submit_chatu8_storyboard_conversion")');
        expect(source).toContain('pluginTool("resolve_tags")');
        expect(source).toContain('pluginTool("search_tag_patterns")');
        expect(source).toContain("builtin.result.main");
        for (const forbidden of [
            "builtin.file.",
            "builtin.web.",
            "builtin.agent.",
            "providerId",
            "recipeId",
            "apiKey",
            "sampler",
            "finalPrompt",
        ]) {
            expect(source).not.toContain(forbidden);
        }
    });

    it("旧 character-image-tag.extractor 已硬切删除，角色 proposal 只归属 illustration.director", async () => {
        await expect(fs.stat(path.resolve("assets/workspace/.nbook/agent/profiles/builtin/character-image-tag.extractor.profile.tsx"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("按 initial operation 在 runtime 注入层收窄工具，而不是只靠提示词约束", async () => {
        const runtime = illustrationDirectorProfile.runtime;
        if (!runtime) throw new Error("illustration.director runtime 缺失");
        const hook = runtime.hooks.find((item) => "run" in item && item.name === "illustration.director.operation-tools");
        if (!hook || !("run" in hook)) throw new Error("illustration.director operation tool hook 缺失");
        const convert = await hook.run({initial: {operation: "convert-preset", sourceRelativePath: "upload/a.json"}} as never);
        const character = await hook.run({
            initial: {
                operation: "propose-character-visual",
                characterPath: "lorebook/character/a/index.md",
                characterMarkdown: "# A",
                sourceCharacterFileHash: `sha256:${"a".repeat(64)}`,
            },
        } as never);
        const chapter = await hook.run({initial: {operation: "plan-chapter"}} as never);
        const selection = await hook.run({initial: {operation: "plan-selection"}} as never);
        expect(convert.turnSnapshotPatch?.toolKeys).toEqual([
            "inspect_chatu8_storyboard", "submit_chatu8_storyboard_conversion", "report_result",
        ]);
        expect(character.turnSnapshotPatch?.toolKeys).toEqual(["report_result"]);
        const planningTools = [
            "resolve_tags",
            "suggest_tag_replacements",
            "finalize_tag_resolution",
            "search_tags",
            "related_tags",
            "validate_tag_resolutions",
            "search_tag_patterns",
            "get_tag_patterns",
            "report_result",
        ];
        expect(chapter.turnSnapshotPatch?.toolKeys).toEqual(planningTools);
        expect(selection.turnSnapshotPatch?.toolKeys).toEqual(planningTools);
    });

    it("Skill 只编排固定 inspect/convert/review 流程，不复制 parser 或扩张权限", async () => {
        const source = await fs.readFile(SKILL_PATH, "utf8");
        expect(source).toContain("novel-import-chatu8-storyboard-preset");
        expect(source).toContain("pending_unresolved");
        expect(source).toContain("illustration.director");
        expect(source).toContain("upload/*.json");
        for (const forbidden of ["tagData", "JSON.parse", "sampler", "API key", "任意文件写", "自动批准"] ) {
            expect(source).not.toContain(forbidden);
        }
    });

    it("plan-only Skill 明确不写 Storyboard/正文，不调用 NovelAI 或配置入口", async () => {
        const source = await fs.readFile(PLANNING_SKILL_PATH, "utf8");
        expect(source).toContain("chapter-illustration-direction");
        expect(source).toContain("plan-chapter");
        expect(source).toContain("plan-selection");
        expect(source).toContain("闭集");
        expect(source).toContain("不写 illustrations.md");
        for (const forbidden of ["providerId", "apiKey", "sampler", "scheduler", "steps", "guidance", "seed", "SMEA"]) {
            expect(source).not.toContain(forbidden);
        }
    });
});
