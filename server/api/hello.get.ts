/**
 * 简单演示 API：返回服务端时间与提示信息。
 */

export default defineEventHandler(() => {
    return {
        message: "Hello from Nuxt server api",
        now: new Date().toISOString(),
    };
});
