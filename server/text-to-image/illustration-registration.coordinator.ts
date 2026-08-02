import type {
    IllustrationExecutionRegistrationInput,
    PreparedIllustrationRegistration,
} from "nbook/server/text-to-image/execution.repository";
import {prepareIllustrationExecutionRegistration} from "nbook/server/text-to-image/execution.repository";
import {
    DispatchPreparationStampSchema,
    type DispatchPreparationStamp,
} from "nbook/shared/text-to-image-dispatch";
import {
    IllustrationExecutionRegistrationReceiptSchema,
    type IllustrationExecutionRegistrationReceipt,
} from "nbook/shared/text-to-image-execution";
import type {TextToImageReferenceMutationScope} from "nbook/server/text-to-image/reference-asset-lock";

export type PreparedDispatchJob = {
    id: string;
    dispatchKey: string;
};

/** App preparation 只接收调度身份，不接收 CompiledRequest、Recipe 或 secret。 */
export type PreparedDispatchBatch = {
    preparationId: string;
    manifestId: string;
    manifestHash: string;
    approvalId: string;
    approvalHash: string;
    ownerUserId: number;
    providerId: number;
    providerCredentialRevision: number;
    projectId: string;
    projectPath: string;
    jobs: PreparedDispatchJob[];
};

export type PreparedDispatchStamp = DispatchPreparationStamp;

export interface IllustrationRegistrationPreparationPort {
    /** 在 App 单事务内建立或命中整批 inert preparation/items。 */
    prepare(batch: PreparedDispatchBatch): Promise<PreparedDispatchStamp>;
    /** 以 prepare identity/version 和 Project receipt 做 project_committed CAS。 */
    projectCommitted(stamp: PreparedDispatchStamp, receipt: IllustrationExecutionRegistrationReceipt): Promise<boolean>;
    /** 以相同 closure 把整批 items 原子提升为 ready。 */
    ready(stamp: PreparedDispatchStamp, receipt: IllustrationExecutionRegistrationReceipt): Promise<boolean>;
}

export interface IllustrationRegistrationProjectPort {
    /** 在一个有界 Project 事务内写不可变 Manifest/approval/Jobs/outbox；scope 必须处于活跃状态。 */
    register(
        projection: PreparedIllustrationRegistration,
        stamp: PreparedDispatchStamp,
        scope: TextToImageReferenceMutationScope,
    ): Promise<IllustrationExecutionRegistrationReceipt>;
}

type CoordinatorOptions = {
    preparation: IllustrationRegistrationPreparationPort;
    project: IllustrationRegistrationProjectPort;
};

/** 显式编排 App prepare -> Project commit -> App ready；不伪装跨库事务。 */
export class IllustrationRegistrationCoordinator {
    constructor(private readonly options: CoordinatorOptions) {}

    /** Project 一旦提交，后续 App promotion 失败只返回 dispatch_pending，绝不反向删除 Project 真相。 */
    async register(input: IllustrationExecutionRegistrationInput, scope: TextToImageReferenceMutationScope): Promise<IllustrationExecutionRegistrationReceipt> {
        const projection = prepareIllustrationExecutionRegistration(input);
        const batch = toPreparedDispatchBatch(projection);
        const stamp = DispatchPreparationStampSchema.parse(await this.options.preparation.prepare(batch));
        if (stamp.preparationId !== batch.preparationId) {
            throw new Error("TEXT_TO_IMAGE_DISPATCH_PREPARATION_CONFLICT: App preparation identity 与注册投影不一致");
        }
        const projectReceipt = IllustrationExecutionRegistrationReceiptSchema.parse(
            await this.options.project.register(projection, stamp, scope),
        );
        try {
            const committed = await this.options.preparation.projectCommitted(stamp, projectReceipt);
            const ready = committed && await this.options.preparation.ready(stamp, projectReceipt);
            return IllustrationExecutionRegistrationReceiptSchema.parse({
                ...projectReceipt,
                dispatchState: ready ? "ready" : "dispatch_pending",
            });
        } catch {
            return IllustrationExecutionRegistrationReceiptSchema.parse({
                ...projectReceipt,
                dispatchState: "dispatch_pending",
            });
        }
    }
}

/** 从唯一注册投影提取 App 允许持久化的最小调度 closure。 */
export function toPreparedDispatchBatch(projection: PreparedIllustrationRegistration): PreparedDispatchBatch {
    const first = projection.jobs[0]?.request;
    if (!first) throw new Error("TEXT_TO_IMAGE_DISPATCH_PREPARATION_INVALID: 注册投影没有 Job");
    return {
        preparationId: projection.preparationId,
        manifestId: projection.manifestId,
        manifestHash: projection.input.executionManifestHash,
        approvalId: projection.approvalId,
        approvalHash: projection.approvalHash,
        ownerUserId: first.provider.ownerUserId,
        providerId: first.provider.providerId,
        providerCredentialRevision: first.provider.credentialRevision,
        projectId: projection.projectId,
        projectPath: projection.input.projectPath,
        jobs: projection.jobs.map((job) => ({id: job.id, dispatchKey: job.dispatchKey})),
    };
}
