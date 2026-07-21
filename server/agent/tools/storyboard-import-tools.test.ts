import {Value} from "typebox/value";
import {describe, expect, it} from "vitest";
import {
    createStoryboardImportAgentTools,
    StoryboardImportInspectToolSchema,
    StoryboardImportSubmitToolSchema,
} from "nbook/server/agent/tools/storyboard-import-tools";

describe("illustration.director import tools", () => {
    const importId = `c8i.${"a".repeat(32)}`;

    it("只暴露 inspect/submit 两个窄工具，且都不能从参数注入 project/global path", () => {
        const tools = createStoryboardImportAgentTools();
        expect(tools.map((tool) => tool.key)).toEqual([
            "inspect_chatu8_storyboard",
            "submit_chatu8_storyboard_conversion",
        ]);
        expect(tools.every((tool) => tool.mutatesWorkspace)).toBe(true);
        expect(Value.Check(StoryboardImportInspectToolSchema, {
            sourceRelativePath: "upload/storyboard.json",
            workspaceRoot: "C:/escape",
        })).toBe(false);
        expect(Value.Check(StoryboardImportSubmitToolSchema, {
            sourceRelativePath: "upload/storyboard.json",
            expectedImportId: importId,
            projectPath: "workspace/other",
            conversion: emptyConversion(),
        })).toBe(false);
    });

    it("submit 参数复用 strict conversion schema，拒绝 Agent 自带最终 ID/Prompt/Recipe/生成参数", () => {
        expect(Value.Check(StoryboardImportSubmitToolSchema, {
            sourceRelativePath: "upload/storyboard.json",
            expectedImportId: importId,
            conversion: emptyConversion(),
        })).toBe(true);
        for (const conversion of [
            {...emptyConversion(), sampler: "k_euler"},
            {...emptyConversion(), recipeId: "default"},
            {...emptyConversion(), finalPrompt: "masterpiece"},
            {...emptyConversion(), rules: [{ruleId: "agent-owned"}]},
        ]) {
            expect(Value.Check(StoryboardImportSubmitToolSchema, {
                sourceRelativePath: "upload/storyboard.json",
                expectedImportId: importId,
                conversion,
            })).toBe(false);
        }
    });
});

function emptyConversion() {
    return {
        schemaVersion: "nbook.storyboard-conversion-output/v1",
        rules: [],
        patterns: [],
        recipeProposals: [],
        diagnostics: [],
    };
}
