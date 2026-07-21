import type {IllustrationPlanningApplyJournal as StoredPlanningApplyJournal, PrismaClient} from "nbook/server/generated/project-prisma/client";
import {
    assertPlanningApplyTransition,
    createPlanningApplyPayloadHash,
    IllustrationPlanningApplyJournalSchema,
    IllustrationPlanningApplyPayloadSchema,
    IllustrationPlanningApplyStateSchema,
    PlanningApplyContractError,
    type IllustrationPlanningApplyJournal,
    type IllustrationPlanningApplyPayload,
    type IllustrationPlanningApplyState,
} from "nbook/shared/text-to-image-planning-apply";

const RECOVERABLE_STATES: IllustrationPlanningApplyState[] = [
    "prepared",
    "storyboard_written",
    "chapter_written",
    "storyboard_applied",
];

/** Project SQLite 中 Planning Apply Journal 的唯一持久化入口。 */
export class PlanningApplyRepository {
    constructor(private readonly client: PrismaClient) {}

    /**
     * 按 workflowId create-only 准备 journal。
     * 相同 payload 是幂等 replay，任何字段漂移都稳定报冲突。
     */
    async prepare(input: IllustrationPlanningApplyPayload): Promise<IllustrationPlanningApplyJournal> {
        const payload = IllustrationPlanningApplyPayloadSchema.parse(input);
        const payloadJson = JSON.stringify(payload);
        const row = await this.client.illustrationPlanningApplyJournal.upsert({
            where: {workflowId: payload.workflowId},
            update: {},
            create: {
                id: payload.journalId,
                workflowId: payload.workflowId,
                projectId: payload.projectId,
                chapterPath: payload.chapterPath,
                state: "prepared",
                expectedChapterHash: payload.expectedChapterHash,
                expectedStoryboardHash: payload.expectedStoryboardHash,
                stagedStoryboardHash: payload.stagedStoryboardHash,
                appliedStoryboardHash: payload.appliedStoryboardHash,
                chapterAfterHash: payload.chapterAfterHash,
                payloadJson,
            },
        });
        const storedPayload = parsePayload(row.payloadJson);
        if (createPlanningApplyPayloadHash(storedPayload) !== createPlanningApplyPayloadHash(payload)) {
            throw new PlanningApplyContractError(
                "PLANNING_APPLY_CONFLICT",
                `workflow ${payload.workflowId} 已绑定另一份 apply payload`,
            );
        }
        return mapJournal(row);
    }

    /** 读取单个 workflow 的 journal。 */
    async read(workflowId: string): Promise<IllustrationPlanningApplyJournal> {
        const row = await this.client.illustrationPlanningApplyJournal.findUnique({where: {workflowId}});
        if (!row) {
            throw new PlanningApplyContractError("PLANNING_APPLY_NOT_FOUND", `未找到 workflow ${workflowId} 的 apply journal`);
        }
        return mapJournal(row);
    }

    /** 列出进程重启后必须继续或显式退出的非终态 journal。 */
    async readRecoverable(input: {projectId: string}): Promise<IllustrationPlanningApplyJournal[]> {
        const rows = await this.client.illustrationPlanningApplyJournal.findMany({
            where: {projectId: input.projectId, state: {in: RECOVERABLE_STATES}},
            orderBy: [{createdAt: "asc"}, {id: "asc"}],
        });
        return rows.map(mapJournal);
    }

    /** 以 expected state CAS 推进一个且仅一个持久化阶段。 */
    async advance(input: {
        workflowId: string;
        from: IllustrationPlanningApplyState;
        to: IllustrationPlanningApplyState;
        errorCode?: string;
        errorMessage?: string;
    }): Promise<IllustrationPlanningApplyJournal> {
        const from = IllustrationPlanningApplyStateSchema.parse(input.from);
        const to = assertPlanningApplyTransition(from, input.to);
        const result = await this.client.illustrationPlanningApplyJournal.updateMany({
            where: {workflowId: input.workflowId, state: from},
            data: {
                state: to,
                ...(input.errorCode ? {errorCode: input.errorCode} : {}),
                ...(input.errorMessage ? {errorMessage: input.errorMessage} : {}),
            },
        });
        const journal = await this.read(input.workflowId);
        if (result.count === 1 || journal.state === to) return journal;
        throw new PlanningApplyContractError(
            "PLANNING_APPLY_STATE_CONFLICT",
            `workflow ${input.workflowId} 当前为 ${journal.state}，预期 ${from}`,
        );
    }

    /**
     * 在同一 Project 事务中把不可继续的 apply 与其 workflow 一起标为 stale。
     * 只有仍处于 expected journal 阶段的 writer 能成功执行。
     */
    async markWorkflowStale(input: {
        workflowId: string;
        expectedState: Exclude<IllustrationPlanningApplyState, "completed" | "rolled_back" | "apply_conflict">;
        errorCode: string;
        errorMessage: string;
    }): Promise<IllustrationPlanningApplyJournal> {
        assertPlanningApplyTransition(input.expectedState, "apply_conflict");
        const updated = await this.client.$transaction(async (transaction) => {
            const journal = await transaction.illustrationPlanningApplyJournal.updateMany({
                where: {workflowId: input.workflowId, state: input.expectedState},
                data: {state: "apply_conflict", errorCode: input.errorCode, errorMessage: input.errorMessage},
            });
            if (journal.count !== 1) return false;
            await transaction.illustrationPlanningWorkflow.updateMany({
                where: {id: input.workflowId, status: {in: ["validating", "applying"]}},
                data: {
                    status: "stale",
                    retryable: false,
                    staleReason: input.errorMessage,
                    errorCode: input.errorCode,
                    errorMessage: input.errorMessage,
                    activeAttemptId: null,
                },
            });
            return true;
        });
        const journal = await this.read(input.workflowId);
        if (updated || journal.state === "apply_conflict") return journal;
        throw new PlanningApplyContractError(
            "PLANNING_APPLY_STATE_CONFLICT",
            `workflow ${input.workflowId} 无法从 ${input.expectedState} 进入 apply_conflict`,
        );
    }
}

/** 将 Prisma 行严格解析为共享 journal。 */
function mapJournal(row: StoredPlanningApplyJournal): IllustrationPlanningApplyJournal {
    return IllustrationPlanningApplyJournalSchema.parse({
        id: row.id,
        workflowId: row.workflowId,
        projectId: row.projectId,
        chapterPath: row.chapterPath,
        state: row.state,
        expectedChapterHash: row.expectedChapterHash,
        expectedStoryboardHash: row.expectedStoryboardHash,
        stagedStoryboardHash: row.stagedStoryboardHash,
        appliedStoryboardHash: row.appliedStoryboardHash,
        chapterAfterHash: row.chapterAfterHash,
        payload: parsePayload(row.payloadJson),
        errorCode: row.errorCode,
        errorMessage: row.errorMessage,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    });
}

/** SQLite JSON 是外部持久化边界，必须立即交给 strict schema 收窄。 */
function parsePayload(payloadJson: string): IllustrationPlanningApplyPayload {
    const value: unknown = JSON.parse(payloadJson);
    return IllustrationPlanningApplyPayloadSchema.parse(value);
}
