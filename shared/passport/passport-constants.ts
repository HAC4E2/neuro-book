// Passport 客户端共享常量（Task 112 spec §11）。

/** v1 唯一账号槽位；表结构已带 slotId，将来做多槽位切换不迁移 */
export const DEFAULT_SLOT_ID = "default";

/** 实例申请的 scope 全集：v1 实例功能就是发布 + 备份 */
export const REQUESTED_SCOPES = ["workshop:publish", "backup:read", "backup:write"] as const;

/**
 * 官方站默认地址。官方域名上线前为空：设置页要求用户显式填写（开发环境通常是本机 nb-workshop dev 站）。
 */
export const DEFAULT_PASSPORT_SITE_URL = "";

/**
 * 归一化官方站地址：去空白、去结尾斜杠。协议合法性由 DTO schema 保证。
 */
export function normalizeSiteBaseUrl(input: string): string {
    return input.trim().replace(/\/+$/, "");
}
