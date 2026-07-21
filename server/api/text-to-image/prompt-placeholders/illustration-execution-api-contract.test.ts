import {readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";

const singleRoute = "server/api/text-to-image/prompt-placeholders/[placeholderId]/execution-preview.get.ts";
const batchRoute = "server/api/text-to-image/prompt-placeholders/execution-preview-batch.post.ts";
const authorizeRoute = "server/api/text-to-image/prompt-placeholders/[placeholderId]/generate.post.ts";
const batchAuthorizeRoute = "server/api/text-to-image/prompt-placeholders/generate-batch.post.ts";
const statusRoute = "server/api/text-to-image/prompt-placeholders/[placeholderId]/status.get.ts";

describe("Illustration Execution Preview API contract", () => {
    it("binds both preview routes to auth and the current open Project", async () => {
        for (const routePath of [singleRoute, batchRoute, authorizeRoute, batchAuthorizeRoute, statusRoute]) {
            const source = await readFile(routePath, "utf8");
            expect(source, routePath).toContain("requireCurrentUser(event)");
            expect(source, routePath).toContain("withProjectNotOpenHttpError");
            expect(source, routePath).toContain("throwIllustrationExecutionHttpError");
        }
    });

    it("keeps status as a read-only Project/placeholder projection", async () => {
        const status = await readFile(statusRoute, "utf8");
        expect(status).toContain("getIllustrationPlaceholderStatusService().read");
        expect(status).toContain("getRouterParam(event, \"placeholderId\")");
        expect(status).not.toContain("previewToken");
        expect(status).not.toContain("getIllustrationExecutionService");
        expect(status).not.toContain("method: \"POST\"");
    });

    it("authorizes only the signed reference and explicit hard limits", async () => {
        const single = await readFile(authorizeRoute, "utf8");
        const batch = await readFile(batchAuthorizeRoute, "utf8");
        expect(single).toContain("validateBody(event, AuthorizeRequestSchema)");
        expect(batch).toContain("validateBody(event, BatchAuthorizeRequestSchema)");
        for (const source of [single, batch]) {
            expect(source).toContain("previewToken");
            expect(source).toContain("manifestHash");
            expect(source).toContain("IllustrationExecutionAuthorizationSchema");
            expect(source).not.toContain("providerId");
            expect(source).not.toContain("negativePrompt");
            expect(source).not.toContain("sampler");
            expect(source).not.toContain("seed:");
            expect(source).not.toContain("compiledRequests");
        }
    });

    it("accepts only references and never browser-supplied execution configuration", async () => {
        const single = await readFile(singleRoute, "utf8");
        const batch = await readFile(batchRoute, "utf8");
        expect(single).toContain("getRouterParam(event, \"placeholderId\")");
        expect(batch).toContain("validateBody(event, BatchPreviewRequestSchema)");
        for (const source of [single, batch]) {
            expect(source).not.toContain("providerId");
            expect(source).not.toContain("recipeSource");
            expect(source).not.toContain("negativePrompt");
            expect(source).not.toContain("sampler");
            expect(source).not.toContain("seed:");
            expect(source).not.toContain("model:");
        }
    });
});
