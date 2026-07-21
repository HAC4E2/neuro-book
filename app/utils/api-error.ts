const DEFAULT_API_ERROR_MESSAGE = "请求失败";

type I18nRuntime = {
    t: (key: string) => string;
};

/**
 * 读取当前前端 locale 下的默认 API 错误文案；测试或非 Nuxt 上下文回退中文。
 */
function resolveDefaultApiErrorMessage(): string {
    try {
        const nuxtApp = useNuxtApp() as {$i18n?: I18nRuntime};
        return nuxtApp.$i18n?.t("api.requestFailed") ?? DEFAULT_API_ERROR_MESSAGE;
    } catch {
        return DEFAULT_API_ERROR_MESSAGE;
    }
}

export function resolveApiErrorMessage(error: unknown, fallback?: string): string {
    if (typeof error === "object" && error !== null) {
        if ("data" in error && typeof error.data === "object" && error.data !== null) {
            const data = error.data as Record<string, unknown>;

            if (typeof data.message === "string" && data.message) {
                return data.message;
            }
            if (typeof data.statusMessage === "string" && data.statusMessage) {
                return data.statusMessage;
            }
        }

        if ("response" in error && typeof error.response === "object" && error.response !== null) {
            const response = error.response as {_data?: unknown};
            if (typeof response._data === "object" && response._data !== null) {
                const data = response._data as Record<string, unknown>;
                if (typeof data.message === "string" && data.message) {
                    return data.message;
                }
                if (typeof data.statusMessage === "string" && data.statusMessage) {
                    return data.statusMessage;
                }
            }
        }

        if ("statusMessage" in error && typeof error.statusMessage === "string" && error.statusMessage) {
            return error.statusMessage;
        }
        if ("message" in error && typeof error.message === "string" && error.message) {
            return error.message;
        }
    }

    return fallback ?? resolveDefaultApiErrorMessage();
}

/**
 * 提取 `$fetch` / h3 错误中的 HTTP 状态码；无法识别时返回 null。
 */
export function resolveApiErrorStatus(error: unknown): number | null {
    if (typeof error !== "object" || error === null) {
        return null;
    }
    if ("status" in error && typeof error.status === "number") {
        return error.status;
    }
    if ("statusCode" in error && typeof error.statusCode === "number") {
        return error.statusCode;
    }
    if ("response" in error && typeof error.response === "object" && error.response !== null && "status" in error.response && typeof error.response.status === "number") {
        return error.response.status;
    }
    return null;
}

/**
 * 提取 `$fetch` / h3 错误 data 中的稳定业务错误码。
 * `unknown` 只存在于外部 HTTP 错误边界；函数逐层收窄后返回字符串或 null。
 */
export function resolveApiErrorCode(error: unknown): string | null {
    if (typeof error !== "object" || error === null) return null;
    if ("data" in error) {
        const fromData = readApiErrorCode(error.data);
        if (fromData) return fromData;
    }
    if ("response" in error && typeof error.response === "object" && error.response !== null && "_data" in error.response) {
        const fromResponse = readApiErrorCode(error.response._data);
        if (fromResponse) return fromResponse;
    }
    return readApiErrorCode(error);
}

/** 读取当前 HTTP payload 或其 h3 data 包装层中的 code。 */
function readApiErrorCode(payload: unknown): string | null {
    if (typeof payload !== "object" || payload === null) return null;
    if ("code" in payload && typeof payload.code === "string" && payload.code) return payload.code;
    if ("data" in payload && typeof payload.data === "object" && payload.data !== null
        && "code" in payload.data && typeof payload.data.code === "string" && payload.data.code) {
        return payload.data.code;
    }
    return null;
}
