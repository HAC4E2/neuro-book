import {computed, onScopeDispose, readonly, ref, shallowReadonly, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef} from "vue";
import {resolveApiErrorMessage, resolveApiErrorStatus} from "nbook/app/utils/api-error";
import type {AgentJobSnapshot} from "nbook/server/agent/jobs/agent-job-manager";

type AgentJobObserver = {
    job: Readonly<ShallowRef<AgentJobSnapshot | null>>;
    error: Readonly<Ref<string>>;
    unavailable: Readonly<Ref<boolean>>;
    cancelling: Readonly<Ref<boolean>>;
    cancelRequested: Readonly<Ref<boolean>>;
    canCancel: ComputedRef<boolean>;
    refresh: () => void;
    cancel: () => Promise<void>;
};

const TERMINAL_JOB_STATUSES = new Set<AgentJobSnapshot["status"]>(["completed", "failed", "cancelled", "interrupted"]);

/**
 * AgentJobManager 一期 HTTP 观察器。
 * Job SSE 尚未公开，因此 running 快轮询、waiting 降频，终态/404/卸载立即清理。
 */
export function useAgentJob(jobId: Readonly<Ref<string>>): AgentJobObserver {
    const job = shallowRef<AgentJobSnapshot | null>(null);
    const error = ref("");
    const unavailable = ref(false);
    const cancelling = ref(false);
    const cancelRequested = ref(false);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let revision = 0;
    let inFlightRevision = -1;
    let disposed = false;

    const canCancel = computed(() => Boolean(jobId.value)
        && (job.value?.status === "running" || job.value?.status === "waiting")
        && !cancelRequested.value);

    /** 清理已安排的下一次轮询。 */
    const clearTimer = (): void => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    /** 当前 job 是否已经无需继续请求。 */
    const pollingDone = (): boolean => {
        return unavailable.value || Boolean(job.value && TERMINAL_JOB_STATUSES.has(job.value.status));
    };

    /** 安排下一次 job 快照请求。 */
    const schedule = (delay: number): void => {
        if (disposed || timer || !jobId.value || pollingDone() || inFlightRevision === revision) {
            return;
        }
        const expectedRevision = revision;
        const expectedJobId = jobId.value;
        timer = setTimeout(() => {
            timer = null;
            void poll(expectedRevision, expectedJobId);
        }, delay);
    };

    /** 拉取一次 job 快照，并按状态决定后续节奏。 */
    const poll = async (expectedRevision: number, expectedJobId: string): Promise<void> => {
        if (disposed || expectedRevision !== revision || expectedJobId !== jobId.value) {
            return;
        }
        inFlightRevision = expectedRevision;
        try {
            const response = await $fetch(`/api/agent/jobs/${expectedJobId}`) as unknown as {job: AgentJobSnapshot};
            if (disposed || expectedRevision !== revision || expectedJobId !== jobId.value) {
                return;
            }
            job.value = response.job;
            error.value = "";
            unavailable.value = false;
            if (TERMINAL_JOB_STATUSES.has(response.job.status)) {
                cancelRequested.value = false;
            }
        } catch (caught) {
            if (disposed || expectedRevision !== revision || expectedJobId !== jobId.value) {
                return;
            }
            if (resolveApiErrorStatus(caught) === 404) {
                job.value = null;
                unavailable.value = true;
                error.value = "该后台任务已不可查询，可能因服务重启而中断";
            } else {
                error.value = resolveApiErrorMessage(caught, "读取后台任务状态失败");
            }
        } finally {
            if (inFlightRevision === expectedRevision) {
                inFlightRevision = -1;
            }
            if (expectedRevision === revision && expectedJobId === jobId.value) {
                schedule(job.value?.status === "waiting" ? 2000 : 500);
            }
        }
    };

    /** 立即刷新当前 job。 */
    const refresh = (): void => {
        clearTimer();
        schedule(0);
    };

    /** 请求取消当前 job；状态在 JobManager 实际收尾后由后续快照确认。 */
    const cancel = async (): Promise<void> => {
        if (!jobId.value || !canCancel.value || cancelling.value) {
            return;
        }
        const expectedRevision = revision;
        const expectedJobId = jobId.value;
        cancelling.value = true;
        error.value = "";
        try {
            const response = await $fetch(`/api/agent/jobs/${expectedJobId}/cancel`, {
                method: "POST",
            }) as unknown as {job: AgentJobSnapshot};
            if (disposed || expectedRevision !== revision || expectedJobId !== jobId.value) {
                return;
            }
            job.value = response.job;
            cancelRequested.value = true;
            refresh();
        } catch (caught) {
            if (disposed || expectedRevision !== revision || expectedJobId !== jobId.value) {
                return;
            }
            error.value = resolveApiErrorMessage(caught, "取消后台任务失败");
        } finally {
            if (expectedRevision === revision && expectedJobId === jobId.value) {
                cancelling.value = false;
            }
        }
    };

    watch(jobId, (nextJobId) => {
        revision++;
        clearTimer();
        job.value = null;
        error.value = "";
        unavailable.value = false;
        cancelling.value = false;
        cancelRequested.value = false;
        if (nextJobId) {
            schedule(0);
        }
    }, {immediate: true});

    onScopeDispose(() => {
        disposed = true;
        revision++;
        clearTimer();
    });

    return {
        // AgentJobSnapshot.ref 含递归 JsonValue，只需整快照替换，不做深 readonly 展开。
        job: shallowReadonly(job),
        error: readonly(error),
        unavailable: readonly(unavailable),
        cancelling: readonly(cancelling),
        cancelRequested: readonly(cancelRequested),
        canCancel,
        refresh,
        cancel,
    };
}
