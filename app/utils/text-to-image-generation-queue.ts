export type TextToImageGenerationQueueStatus = "queued" | "running" | "done" | "error";

export const TEXT_TO_IMAGE_GENERATION_QUEUE_DELAY_MS = 15_000;

type TextToImageGenerationQueueJob<T> = {
    id: string;
    run: () => Promise<T>;
    onStatusChange?: (status: TextToImageGenerationQueueStatus) => void;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
};

const queue: Array<TextToImageGenerationQueueJob<unknown>> = [];
let processing = false;

export function enqueueTextToImageGeneration<T>(job: {
    id: string;
    run: () => Promise<T>;
    onStatusChange?: (status: TextToImageGenerationQueueStatus) => void;
}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const queuedJob: TextToImageGenerationQueueJob<T> = {
            ...job,
            resolve,
            reject,
        };
        job.onStatusChange?.("queued");
        queue.push(queuedJob as TextToImageGenerationQueueJob<unknown>);
        void processTextToImageGenerationQueue();
    });
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
            job.onStatusChange?.("running");
            try {
                const result = await job.run();
                job.onStatusChange?.("done");
                job.resolve(result);
            } catch (error) {
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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}
