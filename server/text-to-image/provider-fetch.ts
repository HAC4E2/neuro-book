import type {LookupAddress} from "node:dns";
import {lookup as dnsLookup} from "node:dns/promises";
import type {LookupFunction} from "node:net";
import {Agent, ProxyAgent, type Dispatcher} from "undici";
import {
    assertTextToImageProviderAddress,
    assertTextToImageProviderUrl,
} from "nbook/server/text-to-image/provider-url-policy";

export type TextToImageProviderFetchPolicy = {
    allowPrivateNetwork: boolean;
};

export type TextToImageProviderFetch = (
    value: string | URL,
    init: RequestInit,
    policy: TextToImageProviderFetchPolicy,
) => Promise<Response>;

export type TextToImageProviderAddressResolver = (hostname: string) => Promise<LookupAddress[]>;

type ProviderFetchInit = RequestInit & {
    dispatcher?: Dispatcher;
};

type ProviderHttpFetch = (value: string, init: ProviderFetchInit) => Promise<Response>;

type ProviderFetchDependencies = {
    dispatcher?: Dispatcher;
    fetchImpl?: ProviderHttpFetch;
};

const maximumRedirects = 5;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const safeDispatcher = createTextToImageProviderDispatcher();
let defaultProviderDispatcher: Dispatcher | undefined;

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
 * Provider 安全出站请求：socket lookup 校验与重定向策略在同一入口执行。
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
    const dispatcher = policy.allowPrivateNetwork
        ? undefined
        : dependencies.dispatcher ?? resolveDefaultProviderDispatcher();

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
            throw new Error("Provider 连接失败");
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

function resolveDefaultProviderDispatcher(): Dispatcher {
    if (defaultProviderDispatcher) return defaultProviderDispatcher;
    const proxyUrl = resolveTextToImageEnvironmentProxyUrl();
    defaultProviderDispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : safeDispatcher;
    return defaultProviderDispatcher;
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
