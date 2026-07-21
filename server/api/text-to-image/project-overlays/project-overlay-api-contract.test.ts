import {readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";

const routes = [
    "server/api/text-to-image/project-overlays/index.get.ts",
    "server/api/text-to-image/project-overlays/index.patch.ts",
];

describe("Project overlay API contract", () => {
    it("所有入口要求当前用户与 Project-open，写入口复用 strict shared body", async () => {
        for (const routePath of routes) {
            const source = await readFile(routePath, "utf8");
            expect(source, routePath).toContain("requireCurrentUser(event)");
            expect(source, routePath).toContain("withProjectNotOpenHttpError");
            expect(source, routePath).not.toContain("requireAdminAccess(event)");
        }
        const patchRoute = await readFile(routes[1]!, "utf8");
        expect(patchRoute).toContain("validateBody(event, ProjectOverlaySaveRequestSchema)");
    });
});
