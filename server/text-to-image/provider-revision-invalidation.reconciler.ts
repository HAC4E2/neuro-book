import {z} from "zod";
import type {
    TextToImageProviderRevisionInvalidationRecord,
} from "nbook/server/text-to-image/provider.service";

export interface ProviderRevisionInvalidationStore {
    findPendingRevisionInvalidations(limit: number): Promise<TextToImageProviderRevisionInvalidationRecord[]>;
    completeRevisionInvalidation(id: string): Promise<boolean>;
    failRevisionInvalidation(id: string, message: string): Promise<boolean>;
}

export interface ProviderRevisionInvalidationProjectPort {
    invalidateRevision(target: TextToImageProviderRevisionInvalidationRecord): Promise<unknown>;
}

export type ProviderRevisionInvalidationResult = {
    claimed: number;
    completed: number;
    failed: number;
};

/** 从 App DB saga 恢复 token replacement 的 Project 状态传播。 */
export class ProviderRevisionInvalidationReconciler {
    constructor(private readonly options: {
        store: ProviderRevisionInvalidationStore;
        project: ProviderRevisionInvalidationProjectPort;
    }) {}

    /** 单条失败不阻断其余 owner/project；失败记录保持 pending。 */
    async runOnce(limitInput: number): Promise<ProviderRevisionInvalidationResult> {
        const limit = z.number().int().min(1).max(100).parse(limitInput);
        const records = await this.options.store.findPendingRevisionInvalidations(limit);
        const result: ProviderRevisionInvalidationResult = {claimed: records.length, completed: 0, failed: 0};
        for (const record of records) {
            try {
                await this.options.project.invalidateRevision(record);
                if (await this.options.store.completeRevisionInvalidation(record.id)) result.completed += 1;
                else result.failed += 1;
            } catch (error) {
                const message = error instanceof Error ? error.message : "Project revision invalidation failed";
                await this.options.store.failRevisionInvalidation(record.id, message);
                result.failed += 1;
            }
        }
        return result;
    }
}
