import {ProxyAgent} from "undici";
import type Dispatcher from "undici/types/dispatcher";
import type {DeepSeekFlashConfig} from "nbook/server/agent-v3/model-provider/config.types";
import {resolveDeepSeekFlashConfig as resolveConfig} from "nbook/server/agent-v3/model-provider/config";
import {DeepSeekChatModel} from "nbook/server/agent-v3/neuro-agent";

const proxyAgentCache = new Map<string, ProxyAgent>();

/**
 * 公开配置解析函数，便于测试和外部检查。
 */
export const resolveDeepSeekFlashConfig = resolveConfig;

/**
 * v3 当前默认导出的 NeuroAgent chat model。
 */
export const chatModel = createChatModel();

/**
 * 创建 DeepSeek Flash 聊天模型。
 */
export function createChatModel(config: DeepSeekFlashConfig = resolveConfig()): DeepSeekChatModel {
    return new DeepSeekChatModel({
        modelId: config.modelId,
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        fetch: createFetch(config),
        enableThinking: true,
    });
}

/**
 * 构造带代理支持的 fetch。
 */
function createFetch(config: DeepSeekFlashConfig) {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const dispatcher = resolveDispatcher(config.proxy);
        const requestUrl = typeof input === "string" || input instanceof URL ? input : input.url;
        if (!dispatcher) {
            return fetch(input, init);
        }
        return fetch(requestUrl, {
            ...init,
            dispatcher,
        } as RequestInit & {dispatcher: Dispatcher});
    };
}

/**
 * 解析可复用代理 dispatcher。
 */
function resolveDispatcher(proxy: string): Dispatcher | undefined {
    if (!proxy) {
        return undefined;
    }
    let dispatcher = proxyAgentCache.get(proxy);
    if (!dispatcher) {
        dispatcher = new ProxyAgent(proxy);
        proxyAgentCache.set(proxy, dispatcher);
    }
    return dispatcher;
}
