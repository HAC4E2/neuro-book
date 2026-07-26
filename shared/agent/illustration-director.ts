/** 插图 Director 在 Agent Runtime 与 Global Config 中共用的稳定 Profile key。 */
export const ILLUSTRATION_DIRECTOR_PROFILE_KEY = "illustration.director" as const;

/** 插图 Director 模型 binding 的稳定标识；当前与 Profile key 相同。 */
export const ILLUSTRATION_DIRECTOR_BINDING_ID = "illustration.director" as const;

/** Agent operation 在 Director binding 缺失时使用的稳定错误码。 */
export const ILLUSTRATION_DIRECTOR_MODEL_NOT_CONFIGURED = "ILLUSTRATION_DIRECTOR_MODEL_NOT_CONFIGURED" as const;

/** TTP converter 语义变化必须显式提升该版本，不能复用旧批准。 */
export const ILLUSTRATION_DIRECTOR_CONVERTER_VERSION = "route-b-p2.1" as const;

/** plan-chapter / plan-selection 输入与提示协议版本。 */
export const ILLUSTRATION_DIRECTOR_PLAN_OPERATION_VERSION = "route-b-p3.1" as const;

/** Director operation 的非敏感硬预算；workflow/runtime 必须消费同一注册表。 */
export const ILLUSTRATION_DIRECTOR_OPERATION_POLICIES = {
    "convert-preset": {
        maxTurns: 32,
        maxToolCalls: 256,
        maxDurationMs: 10 * 60_000,
        maxOutputTokens: 32000,
    },
    "propose-character-visual": {
        maxTurns: 6,
        maxToolCalls: 1,
        maxDurationMs: 3 * 60_000,
        maxOutputTokens: 8000,
    },
    "plan-chapter": {
        maxTurns: 20,
        maxToolCalls: 64,
        maxDurationMs: 8 * 60_000,
        maxOutputTokens: 24000,
    },
    "plan-selection": {
        maxTurns: 12,
        maxToolCalls: 32,
        maxDurationMs: 5 * 60_000,
        maxOutputTokens: 12000,
    },
    "review-candidates": {
        maxTurns: 8,
        maxToolCalls: 16,
        maxDurationMs: 4 * 60_000,
        maxOutputTokens: 8000,
    },
} as const;

export type IllustrationDirectorOperation = keyof typeof ILLUSTRATION_DIRECTOR_OPERATION_POLICIES;
