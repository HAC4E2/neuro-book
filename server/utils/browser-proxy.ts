import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {ProxyAgent} from "undici";

type ProxyFetchInit = RequestInit & {
    dispatcher?: ProxyAgent;
};

const execFileAsync = promisify(execFile);
const WINDOWS_INTERNET_SETTINGS_KEY = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`;
const CACHE_TTL_MS = 30_000;
const LOCAL_NO_PROXY = "localhost,127.0.0.1,::1";

let cachedProxyUrl: string | null | undefined;
let cachedProxyExpiresAt = 0;
let cachedAgent: {proxyUrl: string; agent: ProxyAgent} | null = null;

export async function withBrowserProxyForFetch(targetUrl: string, init: RequestInit): Promise<ProxyFetchInit> {
    const proxyUrl = await resolveBrowserProxyUrlForTarget(targetUrl);
    if (!proxyUrl) {
        return init as ProxyFetchInit;
    }

    applyProxyEnvironmentDefaults(proxyUrl);
    return {
        ...init,
        dispatcher: getProxyAgent(proxyUrl),
    };
}

export async function resolveBrowserProxyUrlForTarget(targetUrl: string): Promise<string | null> {
    let url: URL;
    try {
        url = new URL(targetUrl);
    } catch {
        return null;
    }

    if (!shouldUseProxy(url)) {
        return null;
    }

    return resolveBrowserProxyUrl();
}

export async function resolveBrowserProxyUrl(): Promise<string | null> {
    const envProxy = normalizeProxyUrl(readEnvironmentProxyValue());
    if (envProxy) {
        return envProxy;
    }

    if (process.platform !== "win32") {
        return null;
    }

    const now = Date.now();
    if (cachedProxyUrl !== undefined && cachedProxyExpiresAt > now) {
        return cachedProxyUrl;
    }

    cachedProxyUrl = await readWindowsBrowserProxyUrl().catch(() => null);
    cachedProxyExpiresAt = now + CACHE_TTL_MS;
    return cachedProxyUrl;
}

function applyProxyEnvironmentDefaults(proxyUrl: string): void {
    process.env.HTTP_PROXY ||= proxyUrl;
    process.env.HTTPS_PROXY ||= proxyUrl;
    process.env.NO_PROXY ||= LOCAL_NO_PROXY;
}

function getProxyAgent(proxyUrl: string): ProxyAgent {
    if (cachedAgent?.proxyUrl === proxyUrl) {
        return cachedAgent.agent;
    }

    const agent = new ProxyAgent(proxyUrl);
    cachedAgent = {proxyUrl, agent};
    return agent;
}

function shouldUseProxy(url: URL): boolean {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return false;
    }

    const hostname = stripIpv6Brackets(url.hostname.toLowerCase());
    if (hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.")) {
        return false;
    }

    return !isNoProxyHost(hostname);
}

function isNoProxyHost(hostname: string): boolean {
    const noProxy = process.env.NO_PROXY || process.env.no_proxy || "";
    return noProxy
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean)
        .some((rule) => {
            if (rule === "*") {
                return true;
            }
            const normalizedRule = stripIpv6Brackets(rule).replace(/:\d+$/u, "");
            if (normalizedRule.startsWith(".")) {
                return hostname.endsWith(normalizedRule);
            }
            return hostname === normalizedRule || hostname.endsWith(`.${normalizedRule}`);
        });
}

function readEnvironmentProxyValue(): string {
    return process.env.HTTPS_PROXY
        || process.env.https_proxy
        || process.env.HTTP_PROXY
        || process.env.http_proxy
        || "";
}

async function readWindowsBrowserProxyUrl(): Promise<string | null> {
    const [proxyEnable, proxyServer] = await Promise.all([
        queryWindowsRegistryValue("ProxyEnable"),
        queryWindowsRegistryValue("ProxyServer"),
    ]);

    if (!isEnabledRegistryValue(proxyEnable)) {
        return null;
    }

    return parseWindowsProxyServer(proxyServer);
}

async function queryWindowsRegistryValue(valueName: string): Promise<string> {
    const {stdout} = await execFileAsync("reg.exe", ["query", WINDOWS_INTERNET_SETTINGS_KEY, "/v", valueName], {
        timeout: 3_000,
        windowsHide: true,
    });
    return extractRegistryValue(String(stdout), valueName);
}

function extractRegistryValue(output: string, valueName: string): string {
    const escapedName = valueName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const pattern = new RegExp(`^\\s*${escapedName}\\s+REG_\\w+\\s+(.+?)\\s*$`, "imu");
    return output.match(pattern)?.[1]?.trim() ?? "";
}

function isEnabledRegistryValue(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "0x1";
}

function parseWindowsProxyServer(proxyServer: string): string | null {
    const raw = proxyServer.trim();
    if (!raw) {
        return null;
    }

    if (!raw.includes("=")) {
        return normalizeProxyUrl(raw);
    }

    const entries = new Map<string, string>();
    for (const segment of raw.split(";")) {
        const [protocol, ...rest] = segment.split("=");
        const value = rest.join("=").trim();
        if (protocol?.trim() && value) {
            entries.set(protocol.trim().toLowerCase(), value);
        }
    }

    return normalizeProxyUrl(entries.get("https") ?? entries.get("http") ?? "");
}

function normalizeProxyUrl(value: string | null | undefined): string | null {
    const trimmed = (value ?? "").trim();
    if (!trimmed) {
        return null;
    }

    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed)
        ? trimmed
        : `http://${trimmed}`;

    try {
        const url = new URL(withProtocol);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return null;
        }
        return url.toString();
    } catch {
        return null;
    }
}

function stripIpv6Brackets(value: string): string {
    return value.replace(/^\[/u, "").replace(/\]$/u, "");
}
