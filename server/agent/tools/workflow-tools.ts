import {readFile} from "node:fs/promises";
import {Type} from "typebox";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import type {NeuroToolResult, ToolExecutionContext} from "nbook/server/agent/tools/types";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import {loadEffectiveConfigForAgentRuntime} from "nbook/server/config/config-service";
import {assertVisibleModel, resolveAgentVisibleModels} from "nbook/server/agent/harness/agent-visible-models";
import {resolveSessionFileScope} from "nbook/server/agent/workspace/session-file-scope";
import {authorizeFileOperation} from "nbook/server/workspace-files/authorized-file-operation";
import type {JsonValue} from "nbook/server/agent/messages/types";
import type {WorkflowDefinition, WorkspacePort} from "nbook/server/vendor/nb-workflow/index";

const RunWorkflowSchema = Type.Object({
    workflowKey: Type.Optional(Type.String({
        description: "Key of a catalog workflow (see WorkflowCatalog in your context). Exactly one of workflowKey / script is required.",
    })),
    script: Type.Optional(Type.String({
        description: "Inline workflow TypeScript source: `export default {key, title, phases?, run}` with a `run(wf, args)` function. Read reference/agent/workflow/ docs before writing one.",
    })),
    args: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
        description: "Arguments object passed to the workflow run(wf, args). Pass a real object, not a JSON string.",
    })),
    model: Type.Optional(Type.String({
        description: "Default model for agent sessions created by this workflow, as provider/model key. Must be one of the user-approved visible models listed in your context. Omit to use each profile's default.",
    })),
});

/** run_workflow 工具返回契约（details）：workflow 自定义结果 + session/token 元数据（Task 111 拍板） */
type RunWorkflowDetails = {
    runId: string;
    workflowKey: string;
    status: string;
    /** workflow return 值；waiting/failed 时为空 */
    result: JsonValue | null;
    error: string | null;
    /** 等待用户应答的 ask 标题（status=waiting 时非空） */
    pendingAsks: string[];
    sessions: {sessionId: number; profileKey: string; title: string; tokens: {inputTokens: number; outputTokens: number} | null}[];
    usage: {inputTokens: number; outputTokens: number};
    /** 终态状态图（wf.chart 投影；气泡静态兜底） */
    chartMermaid: string | null;
};

/** 按发起 session 的 File Scope 建 workspace 只读端口：wf.workspace.read 与 read 工具同一套路径语义与授权 */
function buildWorkspacePort(context: ToolExecutionContext): WorkspacePort {
    const scope = resolveSessionFileScope(context);
    return {
        read: async (path: string): Promise<string> => {
            const authorized = await authorizeFileOperation(scope, path, "read");
            return await readFile(authorized.address.absolutePath, "utf8");
        },
    };
}

/**
 * run_workflow：运行一个 catalog workflow 或 agent 现写的内联 workflow 脚本（Task 111 面 B）。
 *
 * - approvalRequired：每次运行都要用户审批（脚本可编排多 agent 与真实模型调用）；
 * - model 只能选 agent 可见模型清单内的 key（唯一真相源 resolveAgentVisibleModels）；
 * - 运行期通过 onUpdate 周期推送 runId/状态图 partial，前端 workflow 气泡据此实时渲染；
 * - waiting（wf.ask 挂起）是正常返回而非失败：应答走 workflow run API/气泡，不占用本工具调用。
 */
export function createWorkflowTools() {
    const runWorkflow = defineAgentTool({
        key: "run_workflow",
        description: "Run a multi-agent workflow: either a catalog workflow by workflowKey, or an inline workflow script you wrote. Orchestrates multiple agent sessions with durable replay, human ask checkpoints and a live state chart. Authoring guide: reference/agent/workflow/. Requires user approval.",
        parameters: RunWorkflowSchema,
        approvalRequired: true,
        async executeWithContext(context, _toolCallId, params, _userInput, _signal, onUpdate): Promise<NeuroToolResult> {
            const input = params as {workflowKey?: string; script?: string; args?: Record<string, unknown>; model?: string};
            if (Boolean(input.workflowKey) === Boolean(input.script)) {
                throw new Error("workflowKey 与 script 必须二选一");
            }

            // 解析 workflow 定义：catalog 目录名寻址 / 内联脚本即时编译
            let def: WorkflowDefinition;
            if (input.workflowKey) {
                const item = await context.harness.workflows.get(input.workflowKey);
                if (!item) {
                    const known = (await context.harness.workflows.list()).map((w) => w.key).join("、") || "（空）";
                    throw new Error(`workflow ${input.workflowKey} 不存在。当前可用：${known}`);
                }
                def = item.def;
            } else {
                def = context.harness.workflows.compileInline(input.script!);
            }

            // 模型校验：只能从用户配置的 agent 可见模型清单里选
            const config = await loadEffectiveConfigForAgentRuntime({projectPath: context.projectPath});
            if (input.model) assertVisibleModel(config, input.model);

            // 循环依赖规避：tools/index 由 harness 引入，service 又引入 http(useAgentHarness)，执行期动态加载
            const {useWorkflowDemoService} = await import("nbook/server/agent/workflow/workflow-demo-service");
            const service = useWorkflowDemoService();
            const {runId, done} = service.startWorkflowRun({
                def,
                args: (input.args ?? null) as JsonValue,
                callerSessionId: context.sessionId,
                model: input.model,
                workspace: buildWorkspacePort(context),
            });

            // 运行期心跳：把 runId 与最新状态图推给前端气泡（partial details，不进最终 truth）
            const heartbeat = onUpdate ? setInterval(() => {
                void (async () => {
                    try {
                        const state = await service.runState(runId, 0);
                        onUpdate({
                            content: [{type: "text", text: `workflow ${def.key} 运行中…`}],
                            details: normalizeToolResultDetails({runId, workflowKey: def.key, status: "running", chartMermaid: state.machineMermaid}),
                        });
                    } catch {
                        // 心跳失败不影响 run 本身
                    }
                })();
            }, 1200) : null;

            let view;
            try {
                view = await done;
            } finally {
                if (heartbeat) clearInterval(heartbeat);
            }

            const summary = await service.runSummary(runId);
            const state = await service.runState(runId, 0);
            const details: RunWorkflowDetails = {
                runId,
                workflowKey: def.key,
                status: view.status,
                result: view.result ?? null,
                error: view.error ?? null,
                pendingAsks: view.pendingAsks.map((ask) => ask.spec.title),
                sessions: summary.sessions,
                usage: summary.usage,
                chartMermaid: state.machineMermaid,
            };

            const usageText = summary.usage.inputTokens + summary.usage.outputTokens > 0
                ? `token 用量 in ${summary.usage.inputTokens} / out ${summary.usage.outputTokens}`
                : "无 token 用量记录";
            const lines: string[] = [];
            if (view.status === "completed") {
                lines.push(`workflow ${def.key} 已完成（run ${runId}）。`);
                lines.push(`结果：${JSON.stringify(view.result ?? null)}`);
            } else if (view.status === "waiting") {
                lines.push(`workflow ${def.key} 挂起等待用户应答（run ${runId}）：${details.pendingAsks.join("；")}`);
                lines.push("用户在 workflow 面板应答后 run 会继续；你无需重复调用本工具。");
            } else {
                lines.push(`workflow ${def.key} 失败（run ${runId}）：${view.error ?? "未知错误"}`);
            }
            lines.push(`触达 session：${summary.sessions.map((s) => `#${s.sessionId} ${s.title || s.profileKey}`).join("、") || "无"}；${usageText}。`);
            return {
                content: [{type: "text", text: lines.join("\n")}],
                details: normalizeToolResultDetails(details as unknown as JsonValue),
            };
        },
    });

    const listWorkflows = defineAgentTool({
        key: "list_workflows",
        description: "List available workflows (key, title, whenToUse) and the user-approved visible models you may pass to run_workflow.",
        parameters: Type.Object({}),
        async executeWithContext(context): Promise<NeuroToolResult> {
            const items = await context.harness.workflows.list();
            const config = await loadEffectiveConfigForAgentRuntime({projectPath: context.projectPath});
            const models = resolveAgentVisibleModels(config);
            const lines = [
                "可用 workflow：",
                ...items.map((w) => `- ${w.key}：${w.title}${w.whenToUse ? `（适用：${w.whenToUse}）` : ""}`),
                "",
                "可指定模型：",
                ...models.map((m) => `- ${m.modelKey}${m.note ? ` —— ${m.note}` : ""}`),
            ];
            return {
                content: [{type: "text", text: lines.join("\n")}],
                details: normalizeToolResultDetails({
                    workflows: items.map((w) => ({key: w.key, title: w.title, description: w.description, whenToUse: w.whenToUse ?? null, source: w.source})),
                    models: models.map((m) => ({modelKey: m.modelKey, note: m.note})),
                } as JsonValue),
            };
        },
    });

    return {runWorkflow, listWorkflows};
}
