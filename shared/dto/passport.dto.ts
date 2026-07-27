import {z} from "zod";

// Passport 实例客户端 DTO（Task 112 spec §11）：设置页「NeuroBook 账号」面板与
// server/api/passport 路由之间的合同。官方站侧 wire 契约见 nb-workshop reference/passport/api-v1.md。

/** 关联状态 */
export type PassportStatusDto = {
    linked: boolean;
    siteBaseUrl: string; // 未关联时为空字符串
    account: {id: number; username: string; displayName: string} | null; // 为空表示未关联
    scopes: string[];
    linkedAt: string | null; // 为空表示未关联
};

/** 发起关联：返回给前端展示的设备码信息（deviceCode 本体留在服务端，不下发） */
export type PassportLinkSessionDto = {
    linkSessionId: string;
    userCode: string; // XXXX-XXXX，展示给用户
    verificationUri: string;
    verificationUriComplete: string; // 可直接点击打开的批准页地址
    expiresIn: number; // 秒
    interval: number; // 前端轮询间隔秒
};

/** 单次轮询结果：pending 继续轮询（interval 可能被 slow_down 放大）；其余为终态 */
export type PassportLinkPollDto =
    | {state: "pending"; interval: number}
    | {state: "linked"; status: PassportStatusDto}
    | {state: "expired"}
    | {state: "denied"};

export const PassportLinkStartRequestSchema = z.object({
    siteBaseUrl: z
        .string()
        .trim()
        .min(1, "请填写官方站地址")
        .max(200)
        .regex(/^https?:\/\//, "官方站地址必须以 http:// 或 https:// 开头"),
});

export type PassportLinkStartRequestDto = z.infer<typeof PassportLinkStartRequestSchema>;

export const PassportLinkPollRequestSchema = z.object({
    linkSessionId: z.string().min(1, "缺少 linkSessionId"),
});

export type PassportLinkPollRequestDto = z.infer<typeof PassportLinkPollRequestSchema>;

// ---------- 云备份（wire 契约同官方站 spec §9） ----------

/** 云端备份条目 */
export type PassportBackupDto = {
    id: number;
    instanceLabel: string;
    kind: "manual" | "auto";
    fileSize: number;
    sha256: string;
    appVersion: string;
    comment: string;
    createdAt: string;
};

/** 配额与用量 */
export type PassportBackupQuotaDto = {
    usedBytes: number;
    maxBytes: number;
    count: number;
    maxCount: number;
    maxFileBytes: number;
};

/** 备份列表（官方站响应透传） */
export type PassportBackupListDto = {
    items: PassportBackupDto[];
    quota: PassportBackupQuotaDto;
};

/** 后台任务进度（结构化，前端负责转成文案） */
export type PassportJobProgress = {
    phase: "packing" | "uploading" | "downloading" | "unpacking";
    done: number;
    total: number | null; // 为空表示总量未知（如上传流）
};

/** 备份/恢复后台任务 */
export type PassportJobDto = {
    id: string;
    kind: "backup" | "restore";
    state: "running" | "done" | "error";
    progress: PassportJobProgress | null; // 为空表示尚未产生进度或已结束
    error: string | null; // state=error 时非空
    backup: PassportBackupDto | null; // kind=backup 且完成时非空：云端落库结果
    restore: {restoreDir: string; fileCount: number; appVersion: string} | null; // kind=restore 且完成时非空
    warnings: string[]; // 非致命警告（如某 SQLite 快照失败退化为原样拷贝）
};

export const PassportBackupStartRequestSchema = z.object({
    comment: z.string().trim().max(500).default(""),
});

export type PassportBackupStartRequestDto = z.infer<typeof PassportBackupStartRequestSchema>;
