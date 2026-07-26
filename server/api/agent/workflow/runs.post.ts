import {createError} from "h3";
import {z} from "zod";
import {useAgentHarness} from "nbook/server/agent/http";
import {assertVisibleModel} from "nbook/server/agent/harness/agent-visible-models";
import {useWorkflowDemoService} from "nbook/server/agent/workflow/workflow-demo-service";
import {spawnWorkflowJob} from "nbook/server/agent/workflow/workflow-job";
import {createProjectWorkflowWorkspace} from "nbook/server/agent/workflow/workflow-workspace-port";
import {loadEffectiveConfigFromTarget} from "nbook/server/config/config-service";
import type {RuntimeConfigTarget} from "nbook/server/config/types";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";
import {
    isProjectNotOpenError,
    requireReadyProjectPath,
    runReadyProjectOperation,
} from "nbook/server/workspace-files/project-session";

const WorkflowRunBodySchema = z.object({
    projectPath: z.string().trim().min(1, "projectPath 必填"),
    workflowKey: z.string().trim().min(1, "workflowKey 必填"),
    args: z.json().optional(),
    model: z.string().trim().min(1, "model 不能为空").optional(),
});

/**
 * 正式 workflow 面（Task 111）：用户主动触发一次 catalog workflow run。
 * 立即返回 jobId + runId；Job 管生命周期与取消，Run 提供状态图和交互细节。
 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    const body = await validateBody(event, WorkflowRunBodySchema);
    const runtimePaths = runtimePathsFromEnv();
    const ready = requireReadyProjectPath(body.projectPath);
    return runReadyProjectOperation(ready, async () => {
        const configTarget: RuntimeConfigTarget = {
            scope: "project",
            workspaceRoot: runtimePaths.workspaceRoot,
            project: ready,
        };
        const workspace = createProjectWorkflowWorkspace(ready.workspace);
        const config = await loadEffectiveConfigFromTarget(configTarget);
        if (body.model) {
            try {
                assertVisibleModel(config, body.model);
            } catch (error) {
                throw createError({statusCode: 400, message: error instanceof Error ? error.message : String(error)});
            }
        }

        const harness = useAgentHarness();
        const item = await harness.workflows.get(body.workflowKey, ready.workspace);
        if (!item) throw createError({statusCode: 404, message: `workflow ${body.workflowKey} 不存在`});
        try {
            const {job, runId} = spawnWorkflowJob({
                jobs: harness.jobs,
                service: useWorkflowDemoService(),
                def: item.def,
                args: body.args ?? null,
                model: body.model,
                workspace,
                config,
                project: ready,
                workspaceKey: body.projectPath,
                deliver: "none",
            });
            return {jobId: job.jobId, runId};
        } catch (error) {
            if (isProjectNotOpenError(error)) {
                throw error;
            }
            throw createError({statusCode: 400, message: error instanceof Error ? error.message : String(error)});
        }
    });
}));
