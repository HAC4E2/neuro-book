import {createError, getQuery} from "h3";
import {exchangeRateService} from "nbook/server/utils/exchange-rate-service";

/**
 * 读取费用显示使用的汇率；当前只支持 USD -> CNY。
 */
export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const base = String(query.base ?? "USD").toUpperCase();
    const quote = String(query.quote ?? "CNY").toUpperCase();

    if (base !== "USD" || quote !== "CNY") {
        throw createError({
            statusCode: 400,
            statusMessage: "当前只支持 USD -> CNY 汇率",
        });
    }

    try {
        return await exchangeRateService.rate({base: "USD", quote: "CNY"});
    } catch (error) {
        throw createError({
            statusCode: 502,
            statusMessage: error instanceof Error ? error.message : "刷新汇率失败",
        });
    }
});
