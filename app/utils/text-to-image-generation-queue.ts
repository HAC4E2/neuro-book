export type TextToImageGenerationQueueStatus = "queued" | "running" | "done" | "error";

export const TEXT_TO_IMAGE_GENERATION_QUEUE_DELAY_MS = 15_000;
const TEXT_TO_IMAGE_GENERATION_COMPLETED_SNAPSHOT_LIMIT = 8;

export type TextToImageGenerationQueueSnapshotJob = {
    id: string;
    label: string;
    status: TextToImageGenerationQueueStatus;
    position: number;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    errorMessage: string | null;
};

export type TextToImageGenerationQueueSnapshot = {
    jobs: TextToImageGenerationQueueSnapshotJob[];
    activeCount: number;
    queuedCount: number;
    runningCount: number;
    completedCount: number;
};

type TextToImageGenerationQueueJob<T> = {
    id: string;
    label: string;
    snapshot: TextToImageGenerationQueueSnapshotJob;
    run: () => Promise<T>;
    onStatusChange?: (status: TextToImageGenerationQueueStatus) => void;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
};

const queue: Array<TextToImageGenerationQueueJob<unknown>> = [];
const activeJobs: Array<TextToImageGenerationQueueJob<unknown>> = [];
const completedJobs: TextToImageGenerationQueueSnapshotJob[] = [];
const subscribers = new Set<(snapshot: TextToImageGenerationQueueSnapshot) => void>();
let processing = false;

export function enqueueTextToImageGeneration<T>(job: {
    id: string;
    label?: string;
    run: () => Promise<T>;
    onStatusChange?: (status: TextToImageGenerationQueueStatus) => void;
}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const snapshot = createSnapshotJob({
            id: job.id,
            label: job.label ?? job.id,
            status: "queued",
        });
        const queuedJob: TextToImageGenerationQueueJob<T> = {
            ...job,
            label: snapshot.label,
            snapshot,
            resolve,
            reject,
        };
        activeJobs.push(queuedJob as TextToImageGenerationQueueJob<unknown>);
        job.onStatusChange?.("queued");
        queue.push(queuedJob as TextToImageGenerationQueueJob<unknown>);
        notifyTextToImageGenerationQueueSubscribers();
        void processTextToImageGenerationQueue();
    });
}

export function getTextToImageGenerationQueueSnapshot(): TextToImageGenerationQueueSnapshot {
    const activeSnapshotJobs = activeJobs.map((job, index) => ({
        ...job.snapshot,
        position: index + 1,
    }));
    const completedSnapshotJobs = completedJobs.map((job) => ({
        ...job,
        position: 0,
    }));
    return {
        jobs: [...activeSnapshotJobs, ...completedSnapshotJobs],
        activeCount: activeSnapshotJobs.length,
        queuedCount: activeSnapshotJobs.filter((job) => job.status === "queued").length,
        runningCount: activeSnapshotJobs.filter((job) => job.status === "running").length,
        completedCount: completedSnapshotJobs.length,
    };
}

export function subscribeTextToImageGenerationQueue(
    subscriber: (snapshot: TextToImageGenerationQueueSnapshot) => void,
): () => void {
    subscribers.add(subscriber);
    subscriber(getTextToImageGenerationQueueSnapshot());
    return () => {
        subscribers.delete(subscriber);
    };
}

async function processTextToImageGenerationQueue(): Promise<void> {
    if (processing) {
        return;
    }
    processing = true;
    try {
        while (queue.length > 0) {
            const job = queue.shift();
            if (!job) {
                continue;
            }
            job.snapshot.status = "running";
            job.snapshot.startedAt = new Date().toISOString();
            job.onStatusChange?.("running");
            notifyTextToImageGenerationQueueSubscribers();
            try {
                const result = await job.run();
                completeTextToImageGenerationQueueJob(job, "done", null);
                job.onStatusChange?.("done");
                job.resolve(result);
            } catch (error) {
                completeTextToImageGenerationQueueJob(job, "error", error);
                job.onStatusChange?.("error");
                job.reject(error);
            }
            if (queue.length > 0) {
                await sleep(TEXT_TO_IMAGE_GENERATION_QUEUE_DELAY_MS);
            }
        }
    } finally {
        processing = false;
        if (queue.length > 0) {
            void processTextToImageGenerationQueue();
        }
    }
}

function completeTextToImageGenerationQueueJob(
    job: TextToImageGenerationQueueJob<unknown>,
    status: Extract<TextToImageGenerationQueueStatus, "done" | "error">,
    error: unknown,
): void {
    activeJobs.splice(activeJobs.indexOf(job), 1);
    const snapshot: TextToImageGenerationQueueSnapshotJob = {
        ...job.snapshot,
        status,
        finishedAt: new Date().toISOString(),
        errorMessage: error == null ? null : error instanceof Error ? error.message : String(error),
    };
    completedJobs.unshift(snapshot);
    completedJobs.splice(TEXT_TO_IMAGE_GENERATION_COMPLETED_SNAPSHOT_LIMIT);
    notifyTextToImageGenerationQueueSubscribers();
}

function createSnapshotJob(input: {
    id: string;
    label: string;
    status: TextToImageGenerationQueueStatus;
}): TextToImageGenerationQueueSnapshotJob {
    return {
        id: input.id,
        label: input.label,
        status: input.status,
        position: 0,
        createdAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
        errorMessage: null,
    };
}

function notifyTextToImageGenerationQueueSubscribers(): void {
    const snapshot = getTextToImageGenerationQueueSnapshot();
    for (const subscriber of subscribers) {
        subscriber(snapshot);
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        globalThis.setTimeout(resolve, ms);
    });
}