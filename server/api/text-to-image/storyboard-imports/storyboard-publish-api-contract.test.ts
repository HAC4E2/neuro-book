import {readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";

const publishRoutes = [
    "server/api/text-to-image/storyboard-imports/publish-preview.post.ts",
    "server/api/text-to-image/storyboard-imports/publish.post.ts",
    "server/api/text-to-image/storyboard-imports/publish-selector-retry.post.ts",
];

describe("Storyboard global publish API contract", () => {
    it("所有全局发布入口都固定登录、管理员与 Project-open 守卫", async () => {
        for (const routePath of publishRoutes) {
            const source = await readFile(routePath, "utf-8");
            expect(source, routePath).toContain("requireCurrentUser(event)");
            expect(source, routePath).toContain("requireAdminAccess(event)");
            expect(source, routePath).toContain("withProjectNotOpenHttpError");
            expect(source, routePath).toContain("validateBody(event, StoryboardGlobal");
        }
    });
});
