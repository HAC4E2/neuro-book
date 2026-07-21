import {z} from "zod";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";

const StableDispatchIdSchema = z.string().trim().min(1).max(200);
const ProjectPathSchema = z.string().regex(/^workspace\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u);
const IsoTimestampSchema = z.string().datetime();
const StableErrorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,119}$/u);

export const DispatchPreparationStateSchema = z.enum([
    "prepared",
    "project_committed",
    "ready",
    "abandoned",
    "quarantined",
]);

export const ProviderLaneItemStateSchema = z.enum([
    "prepared",
    "ready",
    "leased",
    "retry_wait",
    "retry_leased",
    "attempt_started",
    "completed",
    "failed",
    "outcome_unknown",
    "quarantined",
]);

/** App preparation 与 Project outbox 共享的跨库提交身份。 */
export const DispatchPreparationStampSchema = z.object({
    preparationId: StableDispatchIdSchema,
    prepareAttemptId: StableDispatchIdSchema,
    prepareLeaseUntil: IsoTimestampSchema,
    prepareVersion: z.number().int().positive().safe(),
}).strict();

export type DispatchPreparationStamp = z.infer<typeof DispatchPreparationStampSchema>;

/** App DB preparation 的严格只读快照；它只保存跨库 identity/state，不保存执行请求。 */
export const DispatchPreparationSnapshotSchema = z.object({
    schemaVersion: z.literal("nbook.text-to-image-dispatch-preparation/v1"),
    id: StableDispatchIdSchema,
    ownerUserId: z.number().int().positive().safe(),
    providerId: z.number().int().positive().safe(),
    providerCredentialRevision: z.number().int().positive().safe(),
    projectId: StableDispatchIdSchema,
    projectPath: ProjectPathSchema,
    manifestHash: TextToImageContractHashSchema,
    prepareAttemptId: StableDispatchIdSchema,
    prepareLeaseUntil: IsoTimestampSchema,
    prepareVersion: z.number().int().positive().safe(),
    stateVersion: z.number().int().positive().safe(),
    state: DispatchPreparationStateSchema,
    jobIds: z.array(StableDispatchIdSchema).min(1).max(32),
    dispatchKeys: z.array(TextToImageContractHashSchema).min(1).max(32),
    quarantineCode: StableErrorCodeSchema.nullable(),
    quarantineMessage: z.string().trim().min(1).max(1_000).nullable(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
}).strict().superRefine((snapshot, context) => {
    if (snapshot.jobIds.length !== snapshot.dispatchKeys.length
        || new Set(snapshot.jobIds).size !== snapshot.jobIds.length
        || new Set(snapshot.dispatchKeys).size !== snapshot.dispatchKeys.length) {
        context.addIssue({code: "custom", path: ["dispatchKeys"], message: "jobIds 与 dispatchKeys 必须是一一对应的唯一闭集"});
    }
    const quarantined = snapshot.state === "quarantined";
    if (quarantined !== Boolean(snapshot.quarantineCode && snapshot.quarantineMessage)) {
        context.addIssue({code: "custom", path: ["quarantineCode"], message: "只有 quarantined preparation 必须携带完整隔离证据"});
    }
});

export type DispatchPreparationSnapshot = z.infer<typeof DispatchPreparationSnapshotSchema>;

/** App DB lane item 的严格只读快照；leased 与 attempt_started 是两个不可混淆的付费边界。 */
export const ProviderLaneItemSnapshotSchema = z.object({
    schemaVersion: z.literal("nbook.text-to-image-provider-lane-item/v1"),
    dispatchKey: TextToImageContractHashSchema,
    preparationId: StableDispatchIdSchema,
    jobId: StableDispatchIdSchema,
    ownerUserId: z.number().int().positive().safe(),
    providerId: z.number().int().positive().safe(),
    providerCredentialRevision: z.number().int().positive().safe(),
    projectId: StableDispatchIdSchema,
    projectPath: ProjectPathSchema,
    manifestHash: TextToImageContractHashSchema,
    prepareAttemptId: StableDispatchIdSchema,
    prepareVersion: z.number().int().positive().safe(),
    state: ProviderLaneItemStateSchema,
    stateVersion: z.number().int().positive().safe(),
    claimId: StableDispatchIdSchema.nullable(),
    claimLeaseUntil: IsoTimestampSchema.nullable(),
    sendAttemptId: StableDispatchIdSchema.nullable(),
    sendLeaseUntil: IsoTimestampSchema.nullable(),
    sendFence: z.number().int().positive().safe().nullable(),
    attemptCount: z.number().int().nonnegative().safe(),
    errorCode: StableErrorCodeSchema.nullable(),
    errorMessage: z.string().trim().min(1).max(1_000).nullable(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
}).strict().superRefine((item, context) => {
    const hasClaim = Boolean(item.claimId && item.claimLeaseUntil);
    const hasPartialClaim = Boolean(item.claimId) !== Boolean(item.claimLeaseUntil);
    const sendParts = [item.sendAttemptId, item.sendLeaseUntil, item.sendFence];
    const hasSend = sendParts.every((value) => value !== null);
    const hasPartialSend = sendParts.some((value) => value !== null) && !hasSend;
    if (hasPartialClaim || hasPartialSend) {
        context.addIssue({code: "custom", path: ["sendAttemptId"], message: "claim 与 send attempt identity 必须各自完整或全空"});
        return;
    }
    const hasError = Boolean(item.errorCode && item.errorMessage);
    const hasPartialError = Boolean(item.errorCode) !== Boolean(item.errorMessage);
    if (hasPartialError) {
        context.addIssue({code: "custom", path: ["errorCode"], message: "错误码与错误消息必须成对出现"});
        return;
    }
    if (["prepared", "ready"].includes(item.state) && (hasClaim || hasSend || hasError)) {
        context.addIssue({code: "custom", path: ["state"], message: "prepared/ready item 不得携带领取、发送 attempt 或错误证据"});
    }
    if (item.state === "leased" && (!hasClaim || hasSend || hasError)) {
        context.addIssue({code: "custom", path: ["state"], message: "leased 只允许 claim lease，不得提前拥有 send attempt 或错误证据"});
    }
    if (item.state === "retry_wait" && (hasClaim || !hasSend || !hasError || item.attemptCount < 1)) {
        context.addIssue({code: "custom", path: ["state"], message: "retry_wait 必须释放 claim，并保留上一 attempt 与明确可重试错误"});
    }
    if (item.state === "retry_leased" && (!hasClaim || !hasSend || !hasError || item.attemptCount < 1)) {
        context.addIssue({code: "custom", path: ["state"], message: "retry_leased 必须闭合 claim 与上一 attempt 的明确可重试证据"});
    }
    if (item.state === "attempt_started" && (!hasClaim || !hasSend || hasError || item.attemptCount < 1)) {
        context.addIssue({code: "custom", path: ["state"], message: "attempt_started 必须闭合 claim、send fence 与 attemptCount"});
    }
    if (["completed", "failed", "outcome_unknown"].includes(item.state) && (hasClaim || !hasSend || item.attemptCount < 1)) {
        context.addIssue({code: "custom", path: ["state"], message: "发送终态必须保留 send evidence 并释放 claim"});
    }
    if (item.state === "completed" && hasError) {
        context.addIssue({code: "custom", path: ["errorCode"], message: "completed 不得携带错误证据"});
    }
    const requiresError = ["retry_wait", "retry_leased", "failed", "outcome_unknown", "quarantined"].includes(item.state);
    if (requiresError !== hasError) {
        context.addIssue({code: "custom", path: ["errorCode"], message: "重试/失败/未知/隔离状态必须且仅能携带完整错误证据"});
    }
    if (item.state === "quarantined" && hasClaim) {
        context.addIssue({code: "custom", path: ["state"], message: "quarantined 必须释放 claim"});
    }
});

export type ProviderLaneItemSnapshot = z.infer<typeof ProviderLaneItemSnapshotSchema>;

/** 每个 owner/provider 唯一 throttle 快照；active attempt 与 lease 必须成对出现。 */
export const ProviderThrottleSnapshotSchema = z.object({
    schemaVersion: z.literal("nbook.text-to-image-provider-throttle/v1"),
    ownerUserId: z.number().int().positive().safe(),
    providerId: z.number().int().positive().safe(),
    nextAllowedAt: IsoTimestampSchema,
    activeAttemptId: StableDispatchIdSchema.nullable(),
    leaseUntil: IsoTimestampSchema.nullable(),
    fencingVersion: z.number().int().nonnegative().safe(),
    updatedAt: IsoTimestampSchema,
}).strict().superRefine((throttle, context) => {
    if (Boolean(throttle.activeAttemptId) !== Boolean(throttle.leaseUntil)) {
        context.addIssue({code: "custom", path: ["activeAttemptId"], message: "active attempt 与 leaseUntil 必须成对出现"});
    }
    if (throttle.activeAttemptId && throttle.fencingVersion < 1) {
        context.addIssue({code: "custom", path: ["fencingVersion"], message: "active attempt 必须拥有正 fencingVersion"});
    }
});

export type ProviderThrottleSnapshot = z.infer<typeof ProviderThrottleSnapshotSchema>;
