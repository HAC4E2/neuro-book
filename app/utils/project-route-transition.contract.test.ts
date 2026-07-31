import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const indexPagePath = fileURLToPath(new URL("../pages/index.vue", import.meta.url));

describe("Project route transition contract", () => {
    it("所有入口只提交 route intent，并由单一串行队列消费", async () => {
        const page = await readFile(indexPagePath, "utf8");

        expect(page).toContain("const requestWorkspaceRouteSync = (): void =>");
        expect(page).toContain("while (processedProjectRouteRevision < projectRouteIntentRevision)");
        expect(page).toContain("watch(() => [route.query.project, route.query.openPath] as const, requestWorkspaceRouteSync)");
        expect(page).toContain("const openProjectPicker = async (): Promise<void> => {");
        expect(page).toContain('await router.push("/");');
    });

    it("异步确认、release、open 与 workspace 初始化后都校验最新 route intent", async () => {
        const page = await readFile(indexPagePath, "utf8");

        expect(page).toContain("const ownsProjectRouteIntent = (revision: number): boolean");
        expect(page).toContain("await initializeWorkspaceFromRoute(target, revision)");
        expect(page).toContain("if (!ownsProjectRouteIntent(revision)) return;");
        expect(page).toContain("await projectSession.open(target.projectRoot);");
    });

    it("重连进入 terminal failed 后释放 Project surface 并回到 Picker", async () => {
        const page = await readFile(indexPagePath, "utf8");

        expect(page).toContain("const handleTerminalProjectSessionFailure = (): void =>");
        expect(page).toContain('if (projectSwitching.value || terminalProjectFailurePromise) return;');
        expect(page).toContain("stopWorkspaceEvents();");
        expect(page).toContain("await releaseProjectSurface();");
        expect(page).toContain('await router.replace("/");');
        expect(page).toContain('if (next.status === "failed") {');
        expect(page).toContain("handleTerminalProjectSessionFailure();");
    });
});
