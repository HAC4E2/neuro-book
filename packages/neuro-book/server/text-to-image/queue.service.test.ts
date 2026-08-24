import {describe, expect, it} from "vitest";
import {
    TextToImageQueueService,
    type TextToImageJobRecord,
    type TextToImageJobStore,
} from "nbook/server/text-to-image/queue.service";

describe("TextToImageQueueService", () => {
    it("enqueue 创建 queued Job", async () => {
        const store = new InMemoryJobStore();
        const service = new TextToImageQueueService(store);

        const job = await service.enqueue({
            projectPath: "workspace/demo",
            providerId: 1,
            providerOwnerUserId: 7,
            providerCredentialRevision: 1,
            kind: "body",
            requestJson: JSON.stringify({prompt: "1girl"}),
            providerSnapshotJson: "{}",
            sourcePath: "manuscript/chapter-1.md",
            sourceAnchorId: "p_0001",
        });

        expect(job.status).toBe("queued");
        expect(job.sourceAnchorId).toBe("p_0001");
        expect(store.records).toHaveLength(1);
    });

    it("list 支持按状态过滤", async () => {
        const store = new InMemoryJobStore();
        const service = new TextToImageQueueService(store);
        await service.enqueue({
            projectPath: "workspace/demo",
            providerId: 1,
            providerOwnerUserId: 7,
            providerCredentialRevision: 1,
            kind: "manual",
            requestJson: "{}",
            providerSnapshotJson: "{}",
        });
        await service.enqueue({
            projectPath: "workspace/demo",
            providerId: 1,
            providerOwnerUserId: 7,
            providerCredentialRevision: 1,
            kind: "manual",
            requestJson: "{}",
            providerSnapshotJson: "{}",
        });
        await service.cancel("workspace/demo", store.records[0]!.id);

        expect(await service.list("workspace/demo", "queued")).toHaveLength(1);
        expect(await service.list("workspace/demo", "canceled")).toHaveLength(1);
    });

    it("markRunning/markSucceeded 推进状态并记录时间", async () => {
        const store = new InMemoryJobStore();
        const service = new TextToImageQueueService(store);
        const job = await service.enqueue({
            projectPath: "workspace/demo",
            providerId: 1,
            providerOwnerUserId: 7,
            providerCredentialRevision: 1,
            kind: "manual",
            requestJson: "{}",
            providerSnapshotJson: "{}",
        });

        await service.markRunning("workspace/demo", job.id);
        await service.markSucceeded("workspace/demo", job.id);

        expect(store.records[0]).toMatchObject({status: "succeeded"});
        expect(store.records[0]?.startedAt).toBeTruthy();
        expect(store.records[0]?.finishedAt).toBeTruthy();
    });

    it("同一个 queued Job 只允许被一个消费者领取", async () => {
        const store = new InMemoryJobStore();
        const service = new TextToImageQueueService(store);
        const job = await service.enqueue({
            projectPath: "workspace/demo",
            providerId: 1,
            providerOwnerUserId: 7,
            providerCredentialRevision: 1,
            kind: "manual",
            requestJson: "{}",
            providerSnapshotJson: "{}",
        });

        await expect(service.markRunning("workspace/demo", job.id)).resolves.toBe(true);
        await expect(service.markRunning("workspace/demo", job.id)).resolves.toBe(false);
    });

    it("正文写回后推进 sourceInsertStatus", async () => {
        const store = new InMemoryJobStore();
        const service = new TextToImageQueueService(store);
        const job = await service.enqueue({
            projectPath: "workspace/demo",
            providerId: 1,
            providerOwnerUserId: 7,
            providerCredentialRevision: 1,
            kind: "body",
            requestJson: "{}",
            providerSnapshotJson: "{}",
            sourcePath: "manuscript/chapter-1.md",
            sourceAnchorId: "tti-1",
        });

        await expect(service.markSourceInserted("workspace/demo", job.id)).resolves.toBe(true);
        expect(store.records[0]?.sourceInsertStatus).toBe("inserted");
        await expect(service.markSourceMissing("workspace/demo", job.id)).resolves.toBe(true);
        expect(store.records[0]?.sourceInsertStatus).toBe("missing");
    });

    it("终态 Job 不会被取消或迟到的处理结果改写", async () => {
        const store = new InMemoryJobStore();
        const service = new TextToImageQueueService(store);
        const job = await service.enqueue({
            projectPath: "workspace/demo",
            providerId: 1,
            providerOwnerUserId: 7,
            providerCredentialRevision: 1,
            kind: "manual",
            requestJson: "{}",
            providerSnapshotJson: "{}",
        });

        await expect(service.markRunning("workspace/demo", job.id)).resolves.toBe(true);
        await expect(service.cancel("workspace/demo", job.id)).resolves.toBe(true);
        await expect(service.markSucceeded("workspace/demo", job.id)).resolves.toBe(false);
        await expect(service.markFailed("workspace/demo", job.id, "late failure")).resolves.toBe(false);
        expect(store.records[0]?.status).toBe("canceled");
    });

    it("消费者级故障可以把尚未领取的 queued Job 标记失败", async () => {
        const store = new InMemoryJobStore();
        const service = new TextToImageQueueService(store);
        const job = await service.enqueue({
            projectPath: "workspace/demo",
            providerId: 1,
            providerOwnerUserId: 7,
            providerCredentialRevision: 1,
            kind: "body",
            requestJson: "{}",
            providerSnapshotJson: "{}",
        });

        await expect(service.markFailed("workspace/demo", job.id, "数据库暂不可用")).resolves.toBe(true);
        expect(store.records[0]).toMatchObject({status: "failed", errorMessage: "数据库暂不可用"});
    });
});

class InMemoryJobStore implements TextToImageJobStore {
    records: TextToImageJobRecord[] = [];
    private nextId = 1;

    async create(
        projectPath: string,
        input: Omit<TextToImageJobRecord, "id" | "projectPath" | "createdAt" | "startedAt" | "finishedAt">,
    ): Promise<TextToImageJobRecord> {
        const record: TextToImageJobRecord = {
            ...input,
            projectPath,
            id: `job-${this.nextId++}`,
            createdAt: new Date("2026-08-03T00:00:00.000Z"),
            startedAt: null,
            finishedAt: null,
        };
        this.records.push(record);
        return record;
    }

    async list(projectPath: string, status?: string): Promise<TextToImageJobRecord[]> {
        return this.records.filter((record) => record.projectPath === projectPath && (!status || record.status === status));
    }

    async update(projectPath: string, id: string, patch: Partial<Omit<TextToImageJobRecord, "id" | "projectPath" | "createdAt">>): Promise<TextToImageJobRecord | null> {
        const index = this.records.findIndex((record) => record.projectPath === projectPath && record.id === id);
        if (index < 0) return null;
        this.records[index] = {...this.records[index]!, ...patch};
        return this.records[index]!;
    }

    async updateIfStatus(projectPath: string, id: string, status: string, patch: Partial<Omit<TextToImageJobRecord, "id" | "projectPath" | "createdAt">>): Promise<TextToImageJobRecord | null> {
        const index = this.records.findIndex((record) => record.projectPath === projectPath && record.id === id && record.status === status);
        if (index < 0) return null;
        this.records[index] = {...this.records[index]!, ...patch};
        return this.records[index]!;
    }
}
