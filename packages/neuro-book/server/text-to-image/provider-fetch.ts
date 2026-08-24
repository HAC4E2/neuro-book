import type {LookupAddress} from "node:dns";
import {lookup as dnsLookup} from "node:dns/promises";
import {connect as netConnect, type LookupFunction, type Socket} from "node:net";
import {Agent, ProxyAgent, type Dispatcher} from "undici";
import {
    assertTextToImageProviderAddress,
    assertTextToImageProviderUrl,
} from "nbook/server/text-to-image/provider-url-policy";

export type TextToImageProviderFetchPolicy = {
    allowPrivateNetwork: boolean;
    /**
     * 受信任本机代理地址；非空且可达时，目标域名解析委托给该代理，
     * 不再用 safeDispatcher 校验 socket 连接地址。为空时保持直连 + DNS 校验。
     */
    proxyUrl?: string | null;
};

export type TextToImageProviderFetch = (
    value: string | URL,
    init: RequestInit,
    policy: TextToImageProviderFetchPolicy,
) => Promise<Response>;

export type TextToImageProviderAddressResolver = (hostname: string) => Promise<LookupAddress[]>;

export class TextToImageProviderConnectionError extends Error {
    readonly code: string | undefined;
    readonly targetHost: string;
    readonly targetPort: string;

    constructor(targetUrl: string, cause: unknown) {
        const url = new URL(targetUrl);
        super(`Provider 连接失败：${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`);
        this.name = "TextToImageProviderConnectionError";
        this.code = findErrorCode(cause);
        this.targetHost = url.hostname;
        this.targetPort = url.port || (url.protocol === "https:" ? "443" : "80");
        this.cause = cause;
    }
}

/**
 * 代理模式下请求失败（非 URL 策略错误）的可区分错误；
 * message 只包含代理 host:port，不包含代理凭据或 Provider 凭据。
 */
export class TextToImageProviderProxyError extends Error {
    readonly code: string | undefined;
    readonly proxyHost: string;
    readonly proxyPort: string;

    constructor(proxyUrl: string, cause: unknown) {
        const url = new URL(proxyUrl);
        super(`Provider 代理连接失败：${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`);
        this.name = "TextToImageProviderProxyError";
        this.code = findErrorCode(cause);
        this.proxyHost = url.hostname;
        this.proxyPort = url.port || (url.protocol === "https:" ? "443" : "80");
        this.cause = cause;
    }
}

type ProviderFetchInit = RequestInit & {
    dispatcher?: Dispatcher;
};

type ProviderHttpFetch = (value: string, init: ProviderFetchInit) => Promise<Response>;

type ProviderFetchDependencies = {
    dispatcher?: Dispatcher;
    fetchImpl?: ProviderHttpFetch;
    /**
     * 代理可达性检查；缺省用 net.connect 探测并按代理 URL 做进程内缓存。
     * 只有明确配置且可达的代理才被信任。
     */
    isProxyReachable?: (proxyUrl: URL) => Promise<boolean>;
};

const maximumRedirects = 5;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const proxyReachabilityTimeoutMs = 1_500;
const safeDispatcher = createTextToImageProviderDispatcher();
const proxyReachabilityCache = new Map<string, boolean>();
const trustedProxyDispatchers = new Map<string, ProxyAgent>();

/**
 * 创建把地址校验绑定到 net/tls socket lookup 的 Dispatcher。
 */
export function createTextToImageProviderDispatcher(
    resolver: TextToImageProviderAddressResolver = resolveAddresses,
): Dispatcher {
    const lookup: LookupFunction = (hostname, options, callback) => {
        void resolver(normalizeDnsHostname(hostname))
            .then((addresses) => {
                if (addresses.length === 0) {
                    throw new Error("Provider DNS 没有返回地址");
                }
                for (const result of addresses) {
                    assertTextToImageProviderAddress(result.address);
                }

                const requestedFamily = typeof options.family === "number" ? options.family : 0;
                const compatible = requestedFamily === 4 || requestedFamily === 6
                    ? addresses.filter((result) => result.family === requestedFamily)
                    : addresses;
                if (compatible.length === 0) {
                    throw new Error("Provider DNS 没有返回兼容地址");
                }
                if (options.all) {
                    callback(null, compatible);
                    return;
                }
                const selected = compatible[0];
                if (!selected) {
                    throw new Error("Provider DNS 没有返回兼容地址");
                }
                callback(null, selected.address, selected.family);
            })
            .catch((error) => {
                callback(toError(error), "", 0);
            });
    };

    return new Agent({
        connect: {
            lookup,
            autoSelectFamily: false,
        },
    });
}

/**
 * Provider 安全出站请求：URL 校验、代理决策与重定向策略在同一入口执行。
 * proxyUrl 非空且可达时走受信任本机代理，DNS 解析委托给代理；
 * 否则直连并用 socket lookup 校验每个连接地址。
 */
export async function fetchTextToImageProvider(
    value: string | URL,
    init: RequestInit,
    policy: TextToImageProviderFetchPolicy,
    dependencies: ProviderFetchDependencies = {},
): Promise<Response> {
    let currentUrl = assertTextToImageProviderUrl(value.toString(), policy);
    let currentInit: RequestInit = {
        ...init,
        headers: new Headers(init.headers),
        redirect: "manual",
    };
    const fetchImpl = dependencies.fetchImpl ?? defaultHttpFetch;
    const {dispatcher, proxyUrl} = await resolveProviderDispatcher(policy, dependencies);

    for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
        let response: Response;
        try {
            response = await fetchImpl(currentUrl.toString(), {
                ...currentInit,
                ...(dispatcher ? {dispatcher} : {}),
            });
        } catch (error) {
            const policyError = findPolicyError(error);
            if (policyError) {
                throw policyError;
            }
            if (proxyUrl) {
                throw new TextToImageProviderProxyError(proxyUrl, error);
            }
            throw new TextToImageProviderConnectionError(currentUrl.toString(), error);
        }
        if (!redirectStatuses.has(response.status)) {
            return response;
        }

        const location = response.headers.get("location");
        if (!location) {
            return response;
        }
        if (redirectCount === maximumRedirects) {
            await response.body?.cancel();
            throw new Error("Provider 重定向次数过多");
        }

        const nextUrl = assertTextToImageProviderUrl(new URL(location, currentUrl).toString(), policy);
        if (currentUrl.protocol === "https:" && nextUrl.protocol === "http:") {
            await response.body?.cancel();
            throw new Error("Provider 禁止 HTTPS 降级重定向");
        }

        const headers = new Headers(currentInit.headers);
        if (currentUrl.origin !== nextUrl.origin && hasCredentialHeaders(headers)) {
            await response.body?.cancel();
            throw new Error("Provider 禁止携带凭据的跨源重定向");
        }

        await response.body?.cancel();
        currentInit = redirectedInit(currentInit, response.status, headers);
        currentUrl = nextUrl;
    }

    throw new Error("Provider 重定向次数过多");
}

/** 读取运行环境代理；Node fetch 不会像 Bun 一样自动消费这些变量。 */
export function resolveTextToImageEnvironmentProxyUrl(
    environment: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
    for (const key of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]) {
        const value = environment[key]?.trim() ?? "";
        if (value === "") continue;
        try {
            const url = new URL(value);
            if (url.protocol === "http:" || url.protocol === "https:") {
                return url.toString();
            }
        } catch {
            // 忽略无效代理，继续尝试下一个环境变量。
        }
    }
    return null;
}

/**
 * Provider 出站策略统一解析：模型发现与正式 LLM 请求共用。
 * 只自动信任 loopback 主机（127.0.0.1、[::1]、localhost）的 http/https 环境代理；
 * 非 loopback 环境代理被忽略，避免把 Provider API Key 交给任意远程代理。
 */
export function resolveTextToImageOutboundPolicy(
    environment: Readonly<Record<string, string | undefined>> = process.env,
): {allowPrivateNetwork: false; proxyUrl: string | null} {
    const proxyUrl = resolveTextToImageEnvironmentProxyUrl(environment);
    if (proxyUrl && isTrustedLoopbackProxyHostname(normalizeProxyHostname(new URL(proxyUrl).hostname))) {
        return {allowPrivateNetwork: false, proxyUrl};
    }
    return {allowPrivateNetwork: false, proxyUrl: null};
}

async function resolveProviderDispatcher(
    policy: TextToImageProviderFetchPolicy,
    dependencies: ProviderFetchDependencies,
): Promise<{dispatcher: Dispatcher | undefined; proxyUrl: string | null}> {
    if (policy.allowPrivateNetwork) {
        return {dispatcher: undefined, proxyUrl: null};
    }
    const proxyUrl = policy.proxyUrl?.trim() || null;
    if (proxyUrl) {
        const reachable = dependencies.isProxyReachable
            ? await dependencies.isProxyReachable(new URL(proxyUrl))
            : await defaultProxyReachabilityCheck(new URL(proxyUrl));
        if (reachable && !dependencies.dispatcher) {
            return {dispatcher: getOrCreateTrustedProxyDispatcher(proxyUrl), proxyUrl};
        }
        // 代理明确配置但不可达（或调用方显式注入了 dispatcher）时退回直连：
        // 直连模式仍保留全部 URL/DNS/socket 地址校验，这不是放宽私网安全。
    }
    return {
        dispatcher: dependencies.dispatcher ?? (dependencies.fetchImpl ? undefined : safeDispatcher),
        proxyUrl: null,
    };
}

function isTrustedLoopbackProxyHostname(hostname: string): boolean {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function normalizeProxyHostname(value: string): string {
    return value.replace(/^\[|\]$/gu, "").toLowerCase().replace(/\.+$/u, "");
}

function getOrCreateTrustedProxyDispatcher(proxyUrl: string): ProxyAgent {
    let dispatcher = trustedProxyDispatchers.get(proxyUrl);
    if (!dispatcher) {
        dispatcher = new ProxyAgent(proxyUrl);
        trustedProxyDispatchers.set(proxyUrl, dispatcher);
    }
    return dispatcher;
}

async function defaultProxyReachabilityCheck(proxyUrl: URL): Promise<boolean> {
    const key = proxyUrl.toString();
    const cached = proxyReachabilityCache.get(key);
    if (cached !== undefined) {
        return cached;
    }
    const result = await probeProxyTcp(proxyUrl);
    proxyReachabilityCache.set(key, result);
    return result;
}

function probeProxyTcp(proxyUrl: URL): Promise<boolean> {
    return new Promise((resolve) => {
        let socket: Socket;
        let settled = false;
        const finish = (result: boolean) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(result);
        };
        socket = netConnect({
            host: proxyUrl.hostname.replace(/^\[|\]$/gu, ""),
            port: Number(proxyUrl.port || (proxyUrl.protocol === "https:" ? 443 : 80)),
        });
        socket.setTimeout(proxyReachabilityTimeoutMs, () => finish(false));
        socket.once("connect", () => finish(true));
        socket.once("error", () => finish(false));
    });
}

async function resolveAddresses(hostname: string): Promise<LookupAddress[]> {
    return await dnsLookup(hostname, {all: true, verbatim: true});
}

async function defaultHttpFetch(value: string, init: ProviderFetchInit): Promise<Response> {
    return await fetch(value, init);
}

function redirectedInit(init: RequestInit, status: number, headers: Headers): RequestInit {
    const method = (init.method ?? "GET").toUpperCase();
    if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
        headers.delete("content-length");
        headers.delete("content-type");
        return {
            ...init,
            method: "GET",
            body: undefined,
            headers,
            redirect: "manual",
        };
    }
    return {...init, headers, redirect: "manual"};
}

function hasCredentialHeaders(headers: Headers): boolean {
    return headers.has("authorization")
        || headers.has("proxy-authorization")
        || headers.has("cookie");
}

function normalizeDnsHostname(value: string): string {
    return value.replace(/\.+$/u, "");
}

function toError(error: unknown): Error {
    // Promise rejection comes from DNS or policy code and is unknown at this boundary.
    return error instanceof Error ? error : new Error("Provider DNS lookup 失败");
}

function findPolicyError(error: unknown): Error | null {
    // Fetch wraps dispatcher failures in nested unknown causes; only unwrap our controlled policy messages.
    let current = error;
    while (current instanceof Error) {
        if (current.message.startsWith("Provider URL") || current.message.startsWith("Provider DNS")) {
            return current;
        }
        current = current.cause;
    }
    return null;
}

function findErrorCode(error: unknown): string | undefined {
    let current = error;
    while (current instanceof Error) {
        const code = (current as Error & {code?: unknown}).code;
        if (typeof code === "string" && code.trim() !== "") {
            return code;
        }
        current = current.cause;
    }
    return undefined;
}
