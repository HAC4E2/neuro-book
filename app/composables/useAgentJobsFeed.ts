import {computed, getCurrentScope, onScopeDispose, readonly, ref, shallowReadonly, shallowRef, type ComputedRef, type Ref, type ShallowRef} from "vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {AgentJobSnapshot} from "nbook/server/agent/jobs/agent-job-manager";

type AgentJobsFeed = {
    /** 全量任务快照（createdAt 倒序）；F6：整体替换，不做深响应展开 */
    jobs: Readonly<ShallowRef<AgentJobSnapshot[]>>;
    /** running + waiting 数量（Header 徽标） */
    activeCount: ComputedRef<number>;
    /** 首拉是否完成（区分空态与未加载） */
    loaded: Readonly<Ref<boolean>>;
    /** 最近一次轮询失败信息；成功自动清空 */
    error: Readonly<Ref<string>>;
    /** 立即拉一轮 */
    refresh(): void;
    /** 面板开合调速（开=快轮询，关=慢轮询喂徽标） */
    setPanelOpen(open: boolean): void;
    /** 清除已结束任务（POST clear-finished）并刷新；返回清除数量，失败向调用方抛出 */
    clearFinished(): Promise<number>;
};

/**
 * 后台任务共享轮询 feed（Task 111 PLAN-F）。
 *
 * Header 徽标与任务中心面板共用这一份数据，避免两处各自轮询。
 * 模块级单例而非 useState：轮询是纯客户端行为，且 AgentJobSnapshot.ref
 * 含递归 JsonValue，不能进 Nuxt payload 序列化（F6 防线）。
 */
const jobs = shallowRef<AgentJobSnapshot[]>([]);
const loaded = ref(false);
const error = ref("");
const activeCount = computed(() => jobs.value.filter((job) => job.status === "running" || job.status === "waiting").length);

let panelOpen = false;
let timer: ReturnType<typeof setTimeout> | null = null;
/** 递归 setTimeout 的代际号：stop/refresh 后在途请求按代际号丢弃（仿 useAgentJob） */
let revision = 0;
let consumers = 0;
let started = false;

/** 按面板开合与活跃数决定下一轮间隔（变频矩阵见 PLAN-F） */
function nextDelay(): number {
    const active = activeCount.value > 0;
    if (panelOpen) return active ? 1500 : 5000;
    return active ? 5000 : 12000;
}

function clearTimer(): void {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
}

function schedule(delay: number): void {
    if (!started || timer) return;
    const expected = revision;
    timer = setTimeout(() => {
        timer = null;
        void poll(expected);
    }, delay);
}

async function poll(expected: number): Promise<void> {
    if (!started || expected !== revision) return;
    try {
        const response = await $fetch("/api/agent/jobs") as unknown as {jobs: AgentJobSnapshot[]};
        if (!started || expected !== revision) return;
        jobs.value = response.jobs;
        loaded.value = true;
        error.value = "";
    } catch (caught) {
        if (!started || expected !== revision) return;
        error.value = resolveApiErrorMessage(caught, "读取后台任务列表失败");
    } finally {
        if (started && expected === revision) {
            schedule(nextDelay());
        }
    }
}

/** 幂等启动常驻轮询；仅客户端生效 */
function start(): void {
    if (!import.meta.client || started) return;
    started = true;
    revision++;
    schedule(0);
}

function stop(): void {
    started = false;
    revision++;
    clearTimer();
}

function refresh(): void {
    clearTimer();
    schedule(0);
}

function setPanelOpen(open: boolean): void {
    panelOpen = open;
    // 面板打开瞬间立即拉新，之后按快频率跑；关闭不打断，下一轮自然降频
    if (open) refresh();
}

async function clearFinished(): Promise<number> {
    const response = await $fetch("/api/agent/jobs/clear-finished", {method: "POST"}) as unknown as {removed: number};
    refresh();
    return response.removed;
}

const feed: AgentJobsFeed = {
    jobs: shallowReadonly(jobs),
    activeCount,
    loaded: readonly(loaded),
    error: readonly(error),
    refresh,
    setPanelOpen,
    clearFinished,
};

/**
 * 取得后台任务共享 feed。调用即保证轮询在跑（幂等）；
 * 按消费者计数在最后一个 scope 销毁时停止轮询。
 */
export function useAgentJobsFeed(): AgentJobsFeed {
    if (getCurrentScope()) {
        consumers++;
        onScopeDispose(() => {
            consumers--;
            if (consumers <= 0) stop();
        });
    }
    start();
    return feed;
}
