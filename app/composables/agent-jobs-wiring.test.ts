import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const dialogPath = fileURLToPath(new URL("../components/novel-ide/jobs/AgentJobsDialog.vue", import.meta.url));
const headerPath = fileURLToPath(new URL("../components/novel-ide/NovelIdeHeader.vue", import.meta.url));
const indexPagePath = fileURLToPath(new URL("../pages/index.vue", import.meta.url));
const packagePath = fileURLToPath(new URL("../../package.json", import.meta.url));
const observerPath = fileURLToPath(new URL("./useAgentJob.ts", import.meta.url));
const workflowBubblePath = fileURLToPath(new URL("../components/novel-ide/agent/AgentWorkflowBubble.vue", import.meta.url));
const workflowPanelPath = fileURLToPath(new URL("../components/workflow-preview/WorkflowRunPanel.vue", import.meta.url));
const workflowPreviewPath = fileURLToPath(new URL("../pages/workflow.preview.vue", import.meta.url));

describe("Jobs feed 页面接线合同", () => {
    it("Project 选择页不持有 feed，工作面 Header 和打开的 Dialog 才是消费者", async () => {
        const [dialog, header, indexPage] = await Promise.all([
            readFile(dialogPath, "utf8"),
            readFile(headerPath, "utf8"),
            readFile(indexPagePath, "utf8"),
        ]);

        expect(indexPage).not.toContain("useAgentJobsFeed");
        expect(header).toContain("const {activeCount: agentJobsActiveCount} = useAgentJobsFeed();");
        expect(header).not.toContain("agentJobsActiveCount?: number");
        expect(indexPage).not.toContain(":agent-jobs-active-count=");
        expect(indexPage).toContain('<AgentJobsDialog v-if="projectSurfaceActive && agentJobsOpen"');
        expect(dialog).toContain("const feed = useAgentJobsFeed();");
    });

    it("工作面失活会关闭任务中心", async () => {
        const indexPage = await readFile(indexPagePath, "utf8");

        expect(indexPage).toContain("watch(projectSurfaceActive, (active) => {");
        expect(indexPage).toContain("if (!active) agentJobsOpen.value = false;");
    });

    it("开发命令固定为单进程 Nuxt", async () => {
        const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
            scripts: {dev: string};
        };
        const matches = packageJson.scripts.dev.match(/nuxt dev --no-fork/gu) ?? [];

        expect(matches).toHaveLength(1);
        expect(packageJson.scripts.dev.endsWith("nuxt dev --no-fork")).toBe(true);
    });

    it("单 Job 观察器不暴露全局刷新，Workflow 动作只重启 Run 轮询", async () => {
        const [observer, workflowBubble, workflowPanel] = await Promise.all([
            readFile(observerPath, "utf8"),
            readFile(workflowBubblePath, "utf8"),
            readFile(workflowPanelPath, "utf8"),
        ]);

        expect(observer).toContain("feed: AgentJobsFeedView");
        expect(observer).not.toContain("refresh(): void");
        expect(observer).not.toContain("refresh: feed.refresh");
        expect(workflowBubble).not.toContain("refreshJob");
        expect(workflowPanel).not.toContain("refreshJob");
    });

    it("Workflow preview 只在正式列表首次加载读取 Jobs，demo 空目标不取得 feed", async () => {
        const [workflowPreview, workflowPanel] = await Promise.all([
            readFile(workflowPreviewPath, "utf8"),
            readFile(workflowPanelPath, "utf8"),
        ]);
        const listReads = workflowPreview.match(/\$fetch<AgentJobListResponseDto>\("\/api\/agent\/jobs"\)/gu) ?? [];

        expect(listReads).toHaveLength(1);
        expect(workflowPanel).toContain("const jobIdRef = computed(() => props.jobId || null);");
        expect(workflowPanel).not.toContain("/api/agent/jobs");
        expect(workflowPreview).toContain('<WorkflowRunPanel :run-id="activeRun.runId" :scenario-key="activeRun.scenarioKey" />');
    });

    it("Workflow preview 首批 Catalog 失败会释放已打开 Project", async () => {
        const workflowPreview = await readFile(workflowPreviewPath, "utf8");

        expect(workflowPreview).toContain("const loaded = await loadFormalCatalog(projectRoot);");
        expect(workflowPreview).toContain("if (revision !== formalProjectRevision || selectedProjectRoot.value !== projectRoot || loaded) return;");
        expect(workflowPreview).toContain("await formalProjectSession.release();");
    });
});
