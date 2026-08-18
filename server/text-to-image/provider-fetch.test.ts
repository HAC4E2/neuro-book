import type {LookupAddress} from "node:dns";
import type {Dispatcher} from "undici";
import {afterEach, describe, expect, it, vi} from "vitest";
import {
    createTextToImageProviderDispatcher,
    fetchTextToImageProvider,
    resolveTextToImageEnvironmentProxyUrl,
    resolveTextToImageOutboundPolicy,
} from "nbook/server/text-to-image/provider-fetch";

const dispatchers: Dispatcher[] = [];

describe("text-to-image provider fetch", () => {
    afterEach(async () => {
        await Promise.all(dispatchers.splice(0).map(async (dispatcher) => {
            await dispatcher.close();
        }));
    });

    it("prefers HTTPS_PROXY and ignores unsupported proxy protocols", () => {
        expect(resolveTextToImageEnvironmentProxyUrl({
            HTTPS_PROXY: "  http://127.0.0.1:7897  ",
            HTTP_PROXY: "http://127.0.0.1:7898",
        })).toBe("http://127.0.0.1:7897/");
        expect(resolveTextToImageEnvironmentProxyUrl({
            HTTPS_PROXY: "socks5://127.0.0.1:7897",
            HTTP_PROXY: "http://127.0.0.1:7898",
        })).toBe("http://127.0.0.1:7898/");
        expect(resolveTextToImageEnvironmentProxyUrl({
            HTTPS_PROXY: "",
            HTTP_PROXY: "",
        })).toBeNull();
    });

    it("trusts only loopback environment proxies in the outbound policy", () => {
        expect(resolveTextToImageOutboundPolicy({
            HTTPS_PROXY: "http://127.0.0.1:7897",
        })).toEqual({allowPrivateNetwork: false, proxyUrl: "http://127.0.0.1:7897/"});
        expect(resolveTextToImageOutboundPolicy({
            HTTPS_PROXY: "http://localhost:7897",
        }).proxyUrl).toBe("http://localhost:7897/");
        expect(resolveTextToImageOutboundPolicy({
            HTTPS_PROXY: "http://[::1]:7897",
        }).proxyUrl).toBe("http://[::1]:7897/");
        expect(resolveTextToImageOutboundPolicy({
            HTTPS_PROXY: "http://10.0.0.5:7897",
        }).proxyUrl).toBeNull();
        expect(resolveTextToImageOutboundPolicy({
            HTTPS_PROXY: "https://proxy.example.com:8080",
        }).proxyUrl).toBeNull();
        expect(resolveTextToImageOutboundPolicy({}).proxyUrl).toBeNull();
    });

    it("applies a reachable loopback environment proxy and keeps URL literal validation", async () => {
        const loopbackPolicy = resolveTextToImageOutboundPolicy({HTTPS_PROXY: "http://127.0.0.1:7897"});
        const proxiedFetch = vi.fn(async (_value: string, init: RequestInit & {dispatcher?: Dispatcher}) => {
            expect(init.dispatcher?.constructor.name).toBe("ProxyAgent");
            return new Response("ok", {status: 200});
        });

        const response = await fetchTextToImageProvider("https://provider.example/models", {}, loopbackPolicy, {
            fetchImpl: proxiedFetch as never,
            isProxyReachable: async () => true,
        });

        expect(response.status).toBe(200);
        expect(proxiedFetch).toHaveBeenCalledTimes(1);
        expect(proxiedFetch.mock.calls[0]?.[0]).toBe("https://provider.example/models");
    });

    it("does not apply a non-loopback environment proxy to a generic provider fetch", async () => {
        const directPolicy = resolveTextToImageOutboundPolicy({HTTPS_PROXY: "http://10.0.0.5:7897"});
        expect(directPolicy.proxyUrl).toBeNull();

        const fetchImpl = vi.fn(async (_value: string, init: RequestInit & {dispatcher?: Dispatcher}) => {
            expect(init.dispatcher?.constructor.name).not.toBe("ProxyAgent");
            return new Response("ok", {status: 200});
        });

        await fetchTextToImageProvider("https://provider.example/models", {}, directPolicy, {
            fetchImpl: fetchImpl as never,
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("routes Fake-IP targets through a reachable loopback proxy", async () => {
        const fetchImpl = vi.fn(async (_value: string, init: RequestInit & {dispatcher?: Dispatcher}) => {
            expect(init.dispatcher?.constructor.name).toBe("ProxyAgent");
            return new Response(JSON.stringify({data: []}), {status: 200});
        });

        const response = await fetchTextToImageProvider("https://opencode.ai/zen/go/v1/models", {}, {
            ...resolveTextToImageOutboundPolicy({HTTPS_PROXY: "http://127.0.0.1:7897"}),
        }, {
            fetchImpl: fetchImpl as never,
            isProxyReachable: async () => true,
        });

        expect(response.status).toBe(200);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("falls back to direct mode when the trusted proxy is unreachable and still rejects Fake-IP addresses", async () => {
        const dispatcher = createTextToImageProviderDispatcher(async (): Promise<LookupAddress[]> => [{
            address: "198.18.0.23",
            family: 4,
        }]);
        dispatchers.push(dispatcher);

        await expect(fetchTextToImageProvider("http://public.example/resource", {}, {
            ...resolveTextToImageOutboundPolicy({HTTPS_PROXY: "http://127.0.0.1:7897"}),
        }, {
            dispatcher,
            isProxyReachable: async () => false,
        })).rejects.toThrow("私有网络");
    });

    it("wraps proxy-mode request failures as TextToImageProviderProxyError", async () => {
        const fetchImpl = vi.fn(async () => {
            const error = new Error("Proxy Connect Error");
            Object.assign(error, {code: "UND_ERR_CONNECT"});
            throw error;
        });

        await expect(fetchTextToImageProvider("https://opencode.ai/zen/go/v1/models", {}, {
            ...resolveTextToImageOutboundPolicy({HTTPS_PROXY: "http://127.0.0.1:7897"}),
        }, {
            fetchImpl: fetchImpl as never,
            isProxyReachable: async () => true,
        })).rejects.toMatchObject({
            name: "TextToImageProviderProxyError",
            code: "UND_ERR_CONNECT",
            proxyHost: "127.0.0.1",
            proxyPort: "7897",
            message: "Provider 代理连接失败：127.0.0.1:7897",
        });
    });

    it("proxy mode still rejects private-literal URLs before consulting the proxy", async () => {
        const fetchImpl = vi.fn(async () => new Response("ok", {status: 200}));
        const isProxyReachable = vi.fn(async () => true);

        await expect(fetchTextToImageProvider("http://192.168.1.20/v1", {}, {
            ...resolveTextToImageOutboundPolicy({HTTPS_PROXY: "http://127.0.0.1:7897"}),
        }, {
            fetchImpl: fetchImpl as never,
            isProxyReachable,
        })).rejects.toThrow("私有网络");
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(isProxyReachable).not.toHaveBeenCalled();
    });

    it("preserves the underlying connection code and target host", async () => {
        const fetchImpl = vi.fn(async () => {
            const error = new Error("Connect Timeout Error");
            Object.assign(error, {code: "UND_ERR_CONNECT_TIMEOUT"});
            throw error;
        });

        await expect(fetchTextToImageProvider("https://image.novelai.net/ai/generate-image", {}, {
            allowPrivateNetwork: false,
        }, {fetchImpl})).rejects.toMatchObject({
            name: "TextToImageProviderConnectionError",
            code: "UND_ERR_CONNECT_TIMEOUT",
            targetHost: "image.novelai.net",
        });
    });

    it("validates DNS results in the lookup used by the actual socket", async () => {
        const dispatcher = createTextToImageProviderDispatcher(async (): Promise<LookupAddress[]> => [{
            address: "127.0.0.1",
            family: 4,
        }]);
        dispatchers.push(dispatcher);

        await expect(fetchTextToImageProvider("http://public.example/resource", {
            method: "GET",
        }, {allowPrivateNetwork: false}, {dispatcher})).rejects.toThrow("私有网络");
    });

    it("rejects a credentialed cross-origin redirect before forwarding Authorization", async () => {
        const fetchImpl = vi.fn(async () => new Response(null, {
            status: 302,
            headers: {Location: "https://other.example/models"},
        }));

        await expect(fetchTextToImageProvider("https://provider.example/models", {
            headers: {Authorization: "Bearer server-only-token"},
        }, {allowPrivateNetwork: false}, {fetchImpl})).rejects.toThrow("跨源重定向");
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({redirect: "manual"});
    });

    it("proxy mode still rejects a credentialed cross-origin redirect", async () => {
        const fetchImpl = vi.fn(async () => new Response(null, {
            status: 302,
            headers: {Location: "https://other.example/models"},
        }));

        await expect(fetchTextToImageProvider("https://provider.example/models", {
            headers: {Authorization: "Bearer server-only-token"},
        }, {
            ...resolveTextToImageOutboundPolicy({HTTPS_PROXY: "http://127.0.0.1:7897"}),
        }, {
            fetchImpl: fetchImpl as never,
            isProxyReachable: async () => true,
        })).rejects.toThrow("跨源重定向");
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("rejects HTTPS to HTTP redirects", async () => {
        const fetchImpl = vi.fn(async () => new Response(null, {
            status: 307,
            headers: {Location: "http://provider.example/models"},
        }));

        await expect(fetchTextToImageProvider("https://provider.example/models", {}, {
            allowPrivateNetwork: false,
        }, {fetchImpl})).rejects.toThrow("HTTPS 降级");
    });

    it("proxy mode still rejects HTTPS to HTTP redirects", async () => {
        const fetchImpl = vi.fn(async () => new Response(null, {
            status: 307,
            headers: {Location: "http://provider.example/models"},
        }));

        await expect(fetchTextToImageProvider("https://provider.example/models", {}, {
            ...resolveTextToImageOutboundPolicy({HTTPS_PROXY: "http://127.0.0.1:7897"}),
        }, {
            fetchImpl: fetchImpl as never,
            isProxyReachable: async () => true,
        })).rejects.toThrow("HTTPS 降级");
    });

    it("validates every manual redirect target", async () => {
        const fetchImpl = vi.fn(async () => new Response(null, {
            status: 302,
            headers: {Location: "http://127.0.0.1/private"},
        }));

        await expect(fetchTextToImageProvider("https://provider.example/models", {}, {
            allowPrivateNetwork: false,
        }, {fetchImpl})).rejects.toThrow("私有网络");
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
