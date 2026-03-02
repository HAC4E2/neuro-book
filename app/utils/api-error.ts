export function resolveApiErrorMessage(error: unknown, fallback = "请求失败"): string {
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

    return fallback;
}
