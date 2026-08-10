export type NovelAiRequestSchedulerInput<T> = {
    requestIntervalMs: number;
    signal?: AbortSignal;
    run: () => Promise<T>;
};

export type NovelAiRequestSchedulerDependencies = {
    now?: () => number;
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};

type ScheduledTask<T> = NovelAiRequestSchedulerInput<T> & {
    canceled: boolean;
    started: boolean;
    reject: (reason?: unknown) => void;
    resolve: (value: T | PromiseLike<T>) => void;
};

const MIN_REQUEST_INTERVAL_MS = 15_000;

/**
 * 进程级 NovelAI 生图调度器：所有入口共享同一条 FIFO 队列。
 * 间隔从上一项的 Promise settle 时刻开始计算；已开始的请求即使以错误或取消结束，也会释放冷却。
 */
export class NovelAiRequestScheduler {
    private readonly now: () => number;
    private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
    private readonly pending: Array<ScheduledTask<unknown>> = [];
    private running = false;
    private lastCompletedAt: number | null = null;
    private lastIntervalMs = MIN_REQUEST_INTERVAL_MS;

    constructor(dependencies: NovelAiRequestSchedulerDependencies = {}) {
        this.now = dependencies.now ?? (() => Date.now());
        this.sleep = dependencies.sleep ?? sleep;
    }

    schedule<T>(input: NovelAiRequestSchedulerInput<T>): Promise<T> {
        if (input.signal?.aborted) {
            return Promise.reject(createAbortError());
        }

        return new Promise<T>((resolve, reject) => {
            const task: ScheduledTask<T> = {
                ...input,
                requestIntervalMs: normalizeRequestInterval(input.requestIntervalMs),
                canceled: false,
                started: false,
                resolve,
                reject,
            };
            input.signal?.addEventListener("abort", () => {
                if (!task.started && !task.canceled) {
                    task.canceled = true;
                    task.reject(createAbortError());
                }
            }, {once: true});
            this.pending.push(task as ScheduledTask<unknown>);
            void this.pump();
        });
    }

    private async pump(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            while (this.pending.length > 0) {
                const task = this.pending.shift();
                if (!task || task.canceled) continue;

                const waitMs = this.lastCompletedAt === null
                    ? 0
                    : Math.max(0, this.lastCompletedAt + this.lastIntervalMs - this.now());
                if (waitMs > 0) {
                    try {
                        await this.sleep(waitMs, task.signal);
                    } catch (error) {
                        task.canceled = true;
                        task.reject(normalizeAbortError(error));
                        continue;
                    }
                }
                if (task.canceled || task.signal?.aborted) {
                    task.canceled = true;
                    task.reject(createAbortError());
                    continue;
                }

                task.started = true;
                try {
                    const result = await task.run();
                    task.resolve(result);
                } catch (error) {
                    task.reject(error);
                } finally {
                    this.lastCompletedAt = this.now();
                    this.lastIntervalMs = task.requestIntervalMs;
                }
            }
        } finally {
            this.running = false;
            if (this.pending.some((task) => !task.canceled)) {
                void this.pump();
            }
        }
    }
}

let defaultScheduler: NovelAiRequestScheduler | undefined;

export function getNovelAiRequestScheduler(): NovelAiRequestScheduler {
    defaultScheduler ??= new NovelAiRequestScheduler();
    return defaultScheduler;
}

export function normalizeRequestInterval(value: number): number {
    if (!Number.isFinite(value)) return MIN_REQUEST_INTERVAL_MS;
    return Math.max(MIN_REQUEST_INTERVAL_MS, Math.trunc(value));
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(createAbortError());
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, milliseconds);
        const onAbort = (): void => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            reject(createAbortError());
        };
        signal?.addEventListener("abort", onAbort, {once: true});
    });
}

function createAbortError(): DOMException {
    return new DOMException("The operation was aborted", "AbortError");
}

function normalizeAbortError(error: unknown): unknown {
    return error instanceof DOMException && error.name === "AbortError"
        ? error
        : createAbortError();
}
