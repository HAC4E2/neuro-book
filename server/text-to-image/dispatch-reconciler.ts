import {z} from "zod";
import type {DispatchPreparationSnapshot} from "nbook/shared/text-to-image-dispatch";
import type {IllustrationExecutionRegistrationReceipt} from "nbook/shared/text-to-image-execution";
import type {ProjectDispatchInspection} from "nbook/server/text-to-image/project-dispatch.repository";

export interface DispatchReconcilerPreparationPort {
    /** 只领取 prepare lease 已过期且仍为 prepared 的有限批次。 */
    claimExpired(limit: number): Promise<DispatchPreparationSnapshot[]>;
    /** 精确 projectId 重定位后，以 App CAS 更新 preparation 与全部 lane item 路径。 */
    relocate(snapshot: DispatchPreparationSnapshot, projectPath: string): Promise<DispatchPreparationSnapshot>;
    /** 用 Project exact closure 把 preparation/items 提升为 ready。 */
    promote(snapshot: DispatchPreparationSnapshot, receipt: IllustrationExecutionRegistrationReceipt): Promise<boolean>;
    /** 仅在可达 Project 明确没有任何 closure 时标记 abandoned。 */
    abandon(snapshot: DispatchPreparationSnapshot): Promise<boolean>;
    /** 不可达、歧义或损坏必须保存稳定隔离证据。 */
    quarantine(snapshot: DispatchPreparationSnapshot, code: string, message: string): Promise<boolean>;
}

export interface DispatchReconcilerProjectPort {
    inspect(snapshot: DispatchPreparationSnapshot): Promise<ProjectDispatchInspection>;
    rebind(snapshot: DispatchPreparationSnapshot, projectPath: string): Promise<ProjectDispatchInspection>;
}

export type DispatchReconcileResult = {
    claimed: number;
    ready: number;
    abandoned: number;
    quarantined: number;
    failed: number;
};

type ReconcilerOptions = {
    preparation: DispatchReconcilerPreparationPort;
    project: DispatchReconcilerProjectPort;
};

/** 从 App preparation 根扫描恢复；它只判断/提升状态，永不发送远端请求。 */
export class DispatchReconciler {
    constructor(private readonly options: ReconcilerOptions) {}

    /** 有界恢复一批 preparation；单项异常与其他 Project 隔离。 */
    async runOnce(limitInput: number): Promise<DispatchReconcileResult> {
        const limit = z.number().int().min(1).max(100).parse(limitInput);
        const snapshots = await this.options.preparation.claimExpired(limit);
        const result: DispatchReconcileResult = {
            claimed: snapshots.length,
            ready: 0,
            abandoned: 0,
            quarantined: 0,
            failed: 0,
        };
        for (const snapshot of snapshots) {
            try {
                const inspection = await this.options.project.inspect(snapshot);
                await this.reconcileOne(snapshot, inspection, result);
            } catch {
                result.failed += 1;
            }
        }
        return result;
    }

    private async reconcileOne(
        snapshot: DispatchPreparationSnapshot,
        inspection: ProjectDispatchInspection,
        result: DispatchReconcileResult,
    ): Promise<void> {
        let current = snapshot;
        if (["committed", "stale_version", "absent"].includes(inspection.kind)
            && inspection.projectPath !== snapshot.projectPath) {
            current = await this.options.preparation.relocate(snapshot, inspection.projectPath);
        }
        if (inspection.kind === "committed") {
            if (await this.options.preparation.promote(current, inspection.receipt)) result.ready += 1;
            else result.failed += 1;
            return;
        }
        if (inspection.kind === "stale_version") {
            const rebound = await this.options.project.rebind(current, inspection.projectPath);
            if (rebound.kind === "committed" && await this.options.preparation.promote(current, rebound.receipt)) {
                result.ready += 1;
                return;
            }
            if (rebound.kind === "unavailable" || rebound.kind === "ambiguous" || rebound.kind === "corrupt") {
                if (await this.options.preparation.quarantine(current, rebound.code, rebound.message)) result.quarantined += 1;
                else result.failed += 1;
                return;
            }
            result.failed += 1;
            return;
        }
        if (inspection.kind === "absent") {
            if (await this.options.preparation.abandon(current)) result.abandoned += 1;
            else result.failed += 1;
            return;
        }
        if (await this.options.preparation.quarantine(current, inspection.code, inspection.message)) {
            result.quarantined += 1;
        } else {
            result.failed += 1;
        }
    }
}
