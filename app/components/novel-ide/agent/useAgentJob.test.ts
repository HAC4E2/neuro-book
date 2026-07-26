import {effectScope, nextTick, ref} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {useAgentJob} from "nbook/app/composables/useAgentJob";
import type {AgentJobSnapshot} from "nbook/server/agent/jobs/agent-job-manager";

describe("useAgentJob", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("切换 Job 后丢弃旧 cancel 响应", async () => {
        let resolveOldCancel: ((value: {job: AgentJobSnapshot}) => void) | undefined;
        const oldCancel = new Promise<{job: AgentJobSnapshot}>((resolve) => {
            resolveOldCancel = resolve;
        });
        vi.stubGlobal("$fetch", vi.fn((url: string, init?: {method?: string}) => {
            if (url === "/api/agent/jobs/job-old/cancel" && init?.method === "POST") {
                return oldCancel;
            }
            if (url === "/api/agent/jobs/job-old") {
                return Promise.resolve({job: snapshot("job-old", "running")});
            }
            if (url === "/api/agent/jobs/job-new") {
                return Promise.resolve({job: snapshot("job-new", "running")});
            }
            throw new Error("未预期的请求：" + url);
        }));

        const jobId = ref("job-old");
        const scope = effectScope();
        const observer = scope.run(() => useAgentJob(jobId))!;
        await vi.advanceTimersByTimeAsync(0);
        expect(observer.job.value?.jobId).toBe("job-old");

        const cancelling = observer.cancel();
        await Promise.resolve();
        expect(observer.cancelling.value).toBe(true);

        jobId.value = "job-new";
        await nextTick();
        await vi.advanceTimersByTimeAsync(0);
        expect(observer.job.value?.jobId).toBe("job-new");
        expect(observer.cancelling.value).toBe(false);

        resolveOldCancel?.({job: snapshot("job-old", "cancelled")});
        await cancelling;

        expect(observer.job.value?.jobId).toBe("job-new");
        expect(observer.job.value?.status).toBe("running");
        expect(observer.cancelRequested.value).toBe(false);
        scope.stop();
    });
});

/** 创建最小可观察 Job 快照。 */
function snapshot(jobId: string, status: AgentJobSnapshot["status"]): AgentJobSnapshot {
    return {
        jobId,
        kind: "workflow",
        title: jobId,
        ownerSessionId: null,
        status,
        createdAt: 1,
        ref: null,
    };
}
