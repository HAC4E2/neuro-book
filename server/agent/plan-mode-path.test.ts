import {describe, expect, it} from "vitest";
import {createPlanModePlanDirectoryPath} from "nbook/server/agent/plan-mode-path";
import type {AgentVariableScope} from "nbook/server/agent/types";

const SCOPE = {
    studio: {
        workspace: "workspace/silver-dragon-hime",
    },
} as Pick<AgentVariableScope, "studio">;

describe("plan mode path helpers", () => {
    it("creates a thread scoped work directory from active workspace", () => {
        expect(createPlanModePlanDirectoryPath(SCOPE, "thread-1")).toBe(
            "workspace/silver-dragon-hime/.agent/thread-1/",
        );
    });

    it("uses workspace fallback without active workspace", () => {
        expect(createPlanModePlanDirectoryPath(null, "thread-1")).toBe("workspace/.agent/thread-1/");
    });

});
