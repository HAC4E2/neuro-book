import {randomUUID} from "node:crypto";
import type {Prisma} from "nbook/server/generated/project-prisma/client";
import {withEphemeralTextToImageProjectClient} from "nbook/server/text-to-image/project-client";

export type TextToImageJobKind = "manual" | "body" | "character" | "reroll" | "inpaint";
export type TextToImageJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type TextToImageSourceInsertStatus = "not_applicable" | "pending" | "inserted" | "missing";

export type TextToImageJobRecord = {
    id: string;
    projectPath: string;
    providerId: number;
    providerOwnerUserId: number;
    providerCredentialRevision: number;
    kind: TextToImageJobKind;
    status: TextToImageJobStatus;
    requestJson: string;
    sourcePath: string | null;
    sourceAnchorId: string | null;
    sourceInsertStatus: TextToImageSourceInsertStatus;
    providerSnapshotJson: string;
    errorMessage: string | null;
    attemptCount: number;
    createdAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
};

export type TextToImageJobDto = {
    id: string;
    projectPath: string;
    providerId: number;
    providerOwnerUserId: number;
    providerCredentialRevision: number;
    kind: TextToImageJobKind;
    status: TextToImageJobStatus;
    requestJson: string;
    sourcePath: string | null;
    sourceAnchorId: string | null;
    sourceInsertStatus: TextToImageSourceInsertStatus;
    errorMessage: string | null;
    attemptCount: number;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
};

export type EnqueueTextToImageJobInput = {
    projectPath: string;
    providerId: number;
    providerOwnerUserId: number;
    providerCredentialRevision: number;
    kind: TextToImageJobKind;
    sourcePath?: string | null;
    sourceAnchorId?: string | null;
    requestJson: string;
    providerSnapshotJson: string;
};

/** Job 存储抽象；业务测试用内存实现，生产用 Project SQLite。 */
export interface TextToImageJobStore {
    create(
        projectPath: string,
        input: Omit<TextToImageJobRecord, "projectPath" | "createdAt" | "startedAt" | "finishedAt">,
    ): Promise<TextToImageJobRecord>;
    list(projectPath: string, status?: TextToImageJobStatus): Promise<TextToImageJobRecord[]>;
    update(
        projectPath: string,
        id: string,
        patch: Partial<Omit<TextToImageJobRecord, "id" | "projectPath" | "createdAt">>,
    ): Promise<TextToImageJobRecord | null>;
    updateIfStatus(
        projectPath: string,
        id: string,
        status: TextToImageJobStatus,
        patch: Partial<Omit<TextToImageJobRecord, "id" | "projectPath" | "createdAt">>,
    ): Promise<TextToImageJobRecord | null>;
}

/** 首版简化队列：Job 先落 Project SQLite，状态由服务显式推进。 */
export class TextToImageQueueService {
    constructor(private readonly store: TextToImageJobStore = new PrismaTextToImageJobStore()) {}

    async enqueue(input: EnqueueTextToImageJobInput): Promise<TextToImageJobDto> {
        const record = await this.store.create(input.projectPath, {
            id: randomUUID(),
            providerId: input.providerId,
            providerOwnerUserId: input.providerOwnerUserId,
            providerCredentialRevision: input.providerCredentialRevision,
            kind: input.kind,
            status: "queued",
            sourcePath: input.sourcePath ?? null,
            sourceAnchorId: input.sourceAnchorId ?? null,
            sourceInsertStatus: input.sourceAnchorId ? "pending" : "not_applicable",
            requestJson: input.requestJson,
            providerSnapshotJson: input.providerSnapshotJson,
            errorMessage: null,
            attemptCount: 0,
        });
        return toJobDto(record);
    }

    async list(projectPath: string, status?: TextToImageJobStatus): Promise<TextToImageJobDto[]> {
        const records = await this.store.list(projectPath, status);
        return records.map(toJobDto);
    }

    async cancel(projectPath: string, id: string): Promise<boolean> {
        const patch = {
            status: "canceled",
            finishedAt: new Date(),
        } as const;
        const queued = await this.store.updateIfStatus(projectPath, id, "queued", patch);
        if (queued) return true;
        const running = await this.store.updateIfStatus(projectPath, id, "running", patch);
        return running !== null;
    }

    async markRunning(projectPath: string, id: string): Promise<boolean> {
        const record = await this.store.updateIfStatus(projectPath, id, "queued", {
            status: "running",
            startedAt: new Date(),
        });
        return record !== null;
    }

    async markSucceeded(projectPath: string, id: string): Promise<boolean> {
        const record = await this.store.updateIfStatus(projectPath, id, "running", {
            status: "succeeded",
            finishedAt: new Date(),
        });
        return record !== null;
    }

    async markFailed(projectPath: string, id: string, message: string): Promise<boolean> {
        const patch = {
            status: "failed",
            errorMessage: message,
            finishedAt: new Date(),
        } as const;
        const running = await this.store.updateIfStatus(projectPath, id, "running", patch);
        if (running) return true;
        // 消费者在领取 Job 前发生数据库/依赖故障时，也要让 queued Job 进入
        // 可见终态，避免前端无限轮询；已取消/其它终态仍不会被覆盖。
        const queued = await this.store.updateIfStatus(projectPath, id, "queued", patch);
        return queued !== null;
    }

    async markSourceInserted(projectPath: string, id: string): Promise<boolean> {
        const record = await this.store.update(projectPath, id, {
            sourceInsertStatus: "inserted",
        });
        return record !== null;
    }

    async markSourceMissing(projectPath: string, id: string): Promise<boolean> {
        const record = await this.store.update(projectPath, id, {
            sourceInsertStatus: "missing",
        });
        return record !== null;
    }
}

function toJobDto(record: TextToImageJobRecord): TextToImageJobDto {
    return {
        id: record.id,
        projectPath: record.projectPath,
        providerId: record.providerId,
        providerOwnerUserId: record.providerOwnerUserId,
        providerCredentialRevision: record.providerCredentialRevision,
        kind: record.kind,
        status: record.status,
        requestJson: record.requestJson,
        sourcePath: record.sourcePath,
        sourceAnchorId: record.sourceAnchorId,
        sourceInsertStatus: record.sourceInsertStatus,
        errorMessage: record.errorMessage,
        attemptCount: record.attemptCount,
        createdAt: record.createdAt.toISOString(),
        startedAt: record.startedAt?.toISOString() ?? null,
        finishedAt: record.finishedAt?.toISOString() ?? null,
    };
}

class PrismaTextToImageJobStore implements TextToImageJobStore {
    async create(
        projectPath: string,
        input: Omit<TextToImageJobRecord, "projectPath" | "createdAt" | "startedAt" | "finishedAt">,
    ): Promise<TextToImageJobRecord> {
        return await withEphemeralTextToImageProjectClient(projectPath, async (client) => {
            const created = await client.textToImageJob.create({
                data: {
                    id: input.id,
                    providerId: input.providerId,
                    providerOwnerUserId: input.providerOwnerUserId,
                    providerCredentialRevision: input.providerCredentialRevision,
                    kind: input.kind,
                    status: input.status,
                    sourcePath: input.sourcePath,
                    sourceAnchorId: input.sourceAnchorId,
                    sourceInsertStatus: input.sourceInsertStatus,
                    requestJson: input.requestJson,
                    providerSnapshotJson: input.providerSnapshotJson,
                    errorMessage: input.errorMessage,
                    attemptCount: input.attemptCount,
                },
            });
            return {
                ...created,
                projectPath,
                startedAt: created.startedAt ?? null,
                finishedAt: created.finishedAt ?? null,
            } as unknown as TextToImageJobRecord;
        });
    }

    async list(projectPath: string, status?: TextToImageJobStatus): Promise<TextToImageJobRecord[]> {
        return await withEphemeralTextToImageProjectClient(projectPath, async (client) => {
            const records = await client.textToImageJob.findMany({
                where: status ? {status} : undefined,
                orderBy: {createdAt: "desc"},
            });
            return records.map((record) => ({
                ...record,
                projectPath,
                startedAt: record.startedAt ?? null,
                finishedAt: record.finishedAt ?? null,
            })) as unknown as TextToImageJobRecord[];
        });
    }

    async update(
        projectPath: string,
        id: string,
        patch: Partial<Omit<TextToImageJobRecord, "id" | "projectPath" | "createdAt">>,
    ): Promise<TextToImageJobRecord | null> {
        return await withEphemeralTextToImageProjectClient(projectPath, async (client) => {
            const existing = await client.textToImageJob.findUnique({where: {id}});
            if (!existing) return null;
            const updated = await client.textToImageJob.update({
                where: {id},
                data: {
                    status: patch.status,
                    sourcePath: patch.sourcePath,
                    sourceAnchorId: patch.sourceAnchorId,
                    sourceInsertStatus: patch.sourceInsertStatus,
                    requestJson: patch.requestJson,
                    providerSnapshotJson: patch.providerSnapshotJson,
                    errorMessage: patch.errorMessage,
                    attemptCount: patch.attemptCount,
                    startedAt: patch.startedAt,
                    finishedAt: patch.finishedAt,
                } satisfies Prisma.TextToImageJobUpdateInput,
            });
            return {
                ...updated,
                projectPath,
                startedAt: updated.startedAt ?? null,
                finishedAt: updated.finishedAt ?? null,
            } as unknown as TextToImageJobRecord;
        });
    }

    async updateIfStatus(
        projectPath: string,
        id: string,
        status: TextToImageJobStatus,
        patch: Partial<Omit<TextToImageJobRecord, "id" | "projectPath" | "createdAt">>,
    ): Promise<TextToImageJobRecord | null> {
        return await withEphemeralTextToImageProjectClient(projectPath, async (client) => {
            const result = await client.textToImageJob.updateMany({
                where: {id, status},
                data: patch,
            });
            if (result.count === 0) return null;
            return await client.textToImageJob.findUnique({where: {id}}) as unknown as TextToImageJobRecord | null;
        });
    }
}
