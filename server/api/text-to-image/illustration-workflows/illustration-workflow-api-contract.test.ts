import {readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";

const routes = [
    "server/api/text-to-image/illustration-workflows/index.post.ts",
    "server/api/text-to-image/illustration-workflows/index.get.ts",
    "server/api/text-to-image/illustration-workflows/[workflowId].get.ts",
    "server/api/text-to-image/illustration-workflows/[workflowId]/cancel.post.ts",
    "server/api/text-to-image/illustration-workflows/[workflowId]/retry.post.ts",
    "server/api/text-to-image/illustration-workflows/[workflowId]/replan.post.ts",
];

describe("Illustration Workflow API contract", () => {
    it("requires auth/project-open and accepts only the strict browser intent on start", async () => {
        for (const routePath of routes) {
            const source = await readFile(routePath, "utf8");
            expect(source, routePath).toContain("requireCurrentUser(event)");
            expect(source, routePath).toContain("withProjectNotOpenHttpError");
        }
        const start = await readFile(routes[0]!, "utf8");
        expect(start).toContain("validateBody(event, IllustrationPlanningStartRequestSchema)");
        expect(start).not.toContain("providerId");
        expect(start).not.toContain("recipeSource");
        expect(start).not.toContain("modelKey");
    });

    it("keeps cancel, retry, and replan as strict server-intent actions", async () => {
        const cancel = await readFile(routes[3]!, "utf8");
        const retry = await readFile(routes[4]!, "utf8");
        const replan = await readFile(routes[5]!, "utf8");

        expect(cancel).toContain("validateBody(event, IllustrationPlanningWorkflowActionRequestSchema)");
        expect(retry).toContain("validateBody(event, IllustrationPlanningWorkflowActionRequestSchema)");
        expect(replan).toContain("validateBody(event, IllustrationPlanningWorkflowReplanRequestSchema)");
        for (const source of [cancel, retry, replan]) {
            expect(source).not.toContain("providerId");
            expect(source).not.toContain("modelKey");
            expect(source).not.toContain("recipeSource");
            expect(source).not.toContain("planningInputHash");
        }
    });
});
