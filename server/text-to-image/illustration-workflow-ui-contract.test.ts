import {readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";

const panelPath = "app/components/novel-ide/text-to-image/TextToImageIllustrationWorkflowPanel.vue";

describe("Illustration Workflow panel contract", () => {
    it("exposes explicit cancel, retry, and replan actions through the server-owned workflow API", async () => {
        const source = await readFile(panelPath, "utf8");

        expect(source).toContain("useNotification()");
        expect(source).toContain("useDialog()");
        expect(source).toContain("/${workflowId}/cancel");
        expect(source).toContain("/${workflowId}/retry");
        expect(source).toContain("/${workflowId}/replan");
        expect(source).toContain("重新规划原因");
        expect(source).not.toContain("localStorage");
        expect(source).not.toContain("providerId");
        expect(source).not.toContain("modelKey");
        expect(source).not.toContain("recipeSource");
    });
});
