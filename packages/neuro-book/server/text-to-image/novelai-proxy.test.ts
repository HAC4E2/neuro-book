import type {Dispatcher} from "undici";
import {afterEach, describe, expect, it, vi} from "vitest";
import {
    createNovelAiProxyResolver,
    discoverNovelAiProxyUrl,
    parseWindowsProxyUrls,
} from "nbook/server/text-to-image/novelai-proxy";

const dispatchers: Dispatcher[] = [];

describe("NovelAI proxy discovery", () => {
    afterEach(async () => {
        await Promise.all(dispatchers.splice(0).map(async (dispatcher) => {
            await dispatcher.close();
        }));
    });

    it("uses a reachable environment proxy before system and port candidates", async () => {
        const probe = vi.fn(async (proxyUrl: URL) => proxyUrl.port === "7897");

        const proxyUrl = await discoverNovelAiProxyUrl({
            environment: {
                HTTPS_PROXY: "http://127.0.0.1:7897",
                HTTP_PROXY: "http://127.0.0.1:7898",
            },
            systemProxyUrls: ["http://127.0.0.1:8080"],
            candidatePorts: [1080],
            probe,
        });

        expect(proxyUrl).toBe("http://127.0.0.1:7897/");
        expect(probe).toHaveBeenCalledTimes(1);
    });

    it("falls back to a reachable system proxy after an unreachable environment proxy", async () => {
        const probe = vi.fn(async (proxyUrl: URL) => proxyUrl.port === "8080");

        const proxyUrl = await discoverNovelAiProxyUrl({
            environment: {HTTPS_PROXY: "http://127.0.0.1:7897"},
            systemProxyUrls: ["http://127.0.0.1:8080"],
            candidatePorts: [1080],
            probe,
        });

        expect(proxyUrl).toBe("http://127.0.0.1:8080/");
        expect(probe.mock.calls.map(([url]) => (url as URL).port)).toEqual(["7897", "8080"]);
    });

    it("uses the configured port list and ignores invalid entries", async () => {
        const probe = vi.fn(async (proxyUrl: URL) => proxyUrl.port === "1080");

        const proxyUrl = await discoverNovelAiProxyUrl({
            environment: {
                NEURO_BOOK_NOVELAI_PROXY_PORTS: "10809,invalid,70000,1080",
            },
            systemProxyUrls: [],
            probe,
        });

        expect(proxyUrl).toBe("http://127.0.0.1:1080/");
        expect(probe.mock.calls.map(([url]) => (url as URL).port)).toEqual(["10809", "1080"]);
    });

    it("only accepts local HTTP(S) proxy candidates", async () => {
        const probe = vi.fn(async () => true);

        const proxyUrl = await discoverNovelAiProxyUrl({
            environment: {
                HTTPS_PROXY: "socks5://127.0.0.1:7897",
                HTTP_PROXY: "http://192.168.1.20:7897",
            },
            systemProxyUrls: ["https://proxy.example.test:443"],
            candidatePorts: [],
            probe,
        });

        expect(proxyUrl).toBeNull();
        expect(probe).not.toHaveBeenCalled();
    });

    it("parses Windows proxy output without retaining credentials", () => {
        expect(parseWindowsProxyUrls([
            "ProxyEnable    REG_DWORD    0x1",
            "ProxyServer    REG_SZ    http=127.0.0.1:7897;https=127.0.0.1:7898",
            "Proxy Server(s) : http=127.0.0.1:8080;https=127.0.0.1:8443",
        ].join("\r\n"))).toEqual([
            "http://127.0.0.1:7897/",
            "https://127.0.0.1:7898/",
            "http://127.0.0.1:8080/",
            "https://127.0.0.1:8443/",
        ]);
    });

    it("caches the successful dispatcher and retries discovery after invalidation", async () => {
        const probe = vi.fn(async () => true);
        const resolver = createNovelAiProxyResolver({
            environment: {HTTPS_PROXY: "http://127.0.0.1:7897"},
            systemProxyUrls: [],
            candidatePorts: [],
            probe,
        });

        const first = await resolver.resolveDispatcher();
        const second = await resolver.resolveDispatcher();
        expect(first).toBeDefined();
        expect(second).toBe(first);
        expect(probe).toHaveBeenCalledTimes(1);

        await resolver.invalidate();
        const third = await resolver.resolveDispatcher();
        expect(third).toBeDefined();
        expect(probe).toHaveBeenCalledTimes(2);
        if (third) dispatchers.push(third);
    });
});
