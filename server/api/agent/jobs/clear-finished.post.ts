import {useAgentHarness} from "nbook/server/agent/http";

/** 清除内存中的已结束后台任务（jobs.jsonl 登记表为 append-only 审计面，不受影响） */
export default defineEventHandler(() => {
    return {removed: useAgentHarness().jobs.clearFinished()};
});
