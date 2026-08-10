import type {LookupAddress} from "node:dns";
import type {Dispatcher} from "undici";
import {afterEach, describe, expect, it, vi} from "vitest";
import {
    createTextToImageProviderDispatcher,
    fetchTextToImageProvider,
    resolveTextToImageEnvironmentProxyUrl,
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

    it("does not apply environment proxy settings to a generic provider fetch", async () => {
        const fetchImpl = vi.fn(async (_value: string, init: RequestInit & {dispatcher?: Dispatcher}) => {
            expect(init.dispatcher?.constructor.name).not.toBe("ProxyAgent");
            return new Response("ok", {status: 200});
        });
        vi.stubGlobal("fetch", fetchImpl);
        try {
            await fetchTextToImageProvider("https://provider.example/models", {}, {
                allowPrivateNetwork: false,
            });
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        } finally {
            vi.unstubAllGlobals();
        }
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

    it("rejects HTTPS to HTTP redirects", async () => {
        const fetchImpl = vi.fn(async () => new Response(null, {
            status: 307,
            headers: {Location: "http://provider.example/models"},
        }));

        await expect(fetchTextToImageProvider("https://provider.example/models", {}, {
            allowPrivateNetwork: false,
        }, {fetchImpl})).rejects.toThrow("HTTPS 降级");
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
