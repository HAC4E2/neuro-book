import {consola} from "consola";

/**
 * 从未知错误中提取状态码。
 */
const resolveStatusCode = (error: unknown): number => {
    if (typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number") {
        return error.statusCode;
    }
    return 500;
};

/**
 * 从未知错误中提取摘要信息。
 */
const resolveErrorMessage = (error: unknown): string => {
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" && error.message) {
        return error.message;
    }
    if (typeof error === "object" && error !== null && "statusMessage" in error && typeof error.statusMessage === "string") {
        return error.statusMessage;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return "Unknown server error";
};

// @ts-ignore
export default defineNitroPlugin((nitroApp) => {
    // @ts-ignore
    nitroApp.hooks.hook("error", (error, context) => {
        const method = context.event?.method ?? "UNKNOWN";
        const path = context.event?.path ?? "UNKNOWN";

        consola.error({
            err: error,
            method,
            path,
            statusCode: resolveStatusCode(error),
            message: resolveErrorMessage(error),
        }, `服务端请求失败: ${method} ${path}`);
    });
});
