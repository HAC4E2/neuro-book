import {getQuery} from "h3";
import {useAgentHarness} from "nbook/server/agent/http";
import type {AgentJobStatus} from "nbook/server/agent/jobs/agent-job-manager";

/** 后台任务列表（?ownerSessionId=&status=）；前端任务中心/气泡轮询用 */
export default defineEventHandler((event) => {
    const query = getQuery(event);
    const ownerSessionId = query.ownerSessionId !== undefined ? Number(query.ownerSessionId) : undefined;
    return {
        jobs: useAgentHarness().jobs.list({
            ownerSessionId: Number.isFinite(ownerSessionId) ? ownerSessionId : undefined,
            status: typeof query.status === "string" ? query.status as AgentJobStatus : undefined,
        }),
    };
});
