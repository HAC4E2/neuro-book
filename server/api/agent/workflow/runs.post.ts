import {createError, readBody} from "h3";
import {useAgentHarness} from "nbook/server/agent/http";
import {useWorkflowDemoService} from "nbook/server/agent/workflow/workflow-demo-service";
import type {JsonValue} from "nbook/server/vendor/nb-workflow/index";

/**
 * 正式 workflow 面（Task 111）：用户主动触发一次 catalog workflow run。
 * 立即返回 runId，执行在后台；状态轮询走 /api/agent/workflow/runs/:runId。
 */
export default defineEventHandler(async (event) => {
    const body = await readBody<{workflowKey?: string; args?: JsonValue; model?: string}>(event);
    if (!body?.workflowKey || typeof body.workflowKey !== "string") {
        throw createError({statusCode: 400, message: "workflowKey 必填"});
    }
    const item = await useAgentHarness().workflows.get(body.workflowKey);
    if (!item) throw createError({statusCode: 404, message: `workflow ${body.workflowKey} 不存在`});
    try {
        const {runId} = useWorkflowDemoService().startWorkflowRun({
            def: item.def,
            args: body.args ?? null,
            model: typeof body.model === "string" && body.model ? body.model : undefined,
        });
        return {runId};
    } catch (error) {
        throw createError({statusCode: 400, message: error instanceof Error ? error.message : String(error)});
    }
});
