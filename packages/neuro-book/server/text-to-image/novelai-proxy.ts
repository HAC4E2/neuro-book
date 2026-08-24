import {execFile as nodeExecFile} from "node:child_process";
import {connect as netConnect, type Socket} from "node:net";
import {connect as tlsConnect} from "node:tls";
import {promisify} from "node:util";
import {ProxyAgent, type Dispatcher} from "undici";

export type NovelAiProxyResolver = {
    resolveDispatcher(): Promise<Dispatcher | undefined>;
    invalidate(): Promise<void>;
};

export type NovelAiProxyResolverOptions = {
    environment?: Readonly<Record<string, string | undefined>>;
    platform?: NodeJS.Platform;
    systemProxyUrls?: readonly string[];
    candidatePorts?: readonly number[];
    probe?: (proxyUrl: URL, targetHost: string, targetPort: number) => Promise<boolean>;
};

const execFile = promisify(nodeExecFile);
const novelAiHost = "image.novelai.net";
const novelAiPort = 443;
const defaultCandidatePorts = [7897, 7890, 10809, 1080, 8080, 20170, 2080];
const proxyEnvironmentKeys = [
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "ALL_PROXY",
    "all_proxy",
] as const;
const probeTimeoutMs = 1_500;
let defaultResolver: NovelAiProxyResolver | undefined;

export async function discoverNovelAiProxyUrl(
    options: NovelAiProxyResolverOptions = {},
): Promise<string | null> {
    const environment = options.environment ?? process.env;
    const candidates: URL[] = [];
    const seen = new Set<string>();
    const addCandidate = (value: string, protocol?: "http:" | "https:") => {
        const candidate = normalizeLoopbackProxyUrl(value, protocol);
        if (!candidate || seen.has(candidate.toString())) return;
        seen.add(candidate.toString());
        candidates.push(candidate);
    };

    for (const key of proxyEnvironmentKeys) {
        const value = environment[key]?.trim() ?? "";
        if (value !== "") addCandidate(value);
    }

    const systemProxyUrls = options.systemProxyUrls !== undefined
        ? options.systemProxyUrls
        : (options.platform ?? process.platform) === "win32"
            ? await readWindowsProxyUrls()
            : [];
    for (const value of systemProxyUrls) {
        addCandidate(value);
    }

    const candidatePorts = resolveCandidatePorts(environment, options.candidatePorts);
    for (const port of candidatePorts) {
        addCandidate(`http://127.0.0.1:${port}`);
    }

    const probe = options.probe ?? probeHttpProxy;
    for (const candidate of candidates) {
        try {
            if (await probe(candidate, novelAiHost, novelAiPort)) {
                return candidate.toString();
            }
        } catch {
            // 代理不可达时继续尝试下一个候选，不把探测错误暴露为生成错误。
        }
    }
    return null;
}

export function createNovelAiProxyResolver(
    options: NovelAiProxyResolverOptions = {},
): NovelAiProxyResolver {
    let resolved = false;
    let cachedDispatcher: Dispatcher | null = null;
    let inFlight: Promise<Dispatcher | undefined> | null = null;

    return {
        async resolveDispatcher() {
            if (resolved) return cachedDispatcher ?? undefined;
            if (inFlight) return await inFlight;

            inFlight = (async () => {
                const proxyUrl = await discoverNovelAiProxyUrl(options);
                if (!proxyUrl) return undefined;
                return new ProxyAgent(proxyUrl);
            })();
            try {
                const dispatcher = await inFlight;
                cachedDispatcher = dispatcher ?? null;
                resolved = true;
                return dispatcher;
            } finally {
                inFlight = null;
            }
        },
        async invalidate() {
            if (inFlight) await inFlight;
            const dispatcher = cachedDispatcher;
            cachedDispatcher = null;
            resolved = false;
            if (dispatcher) await dispatcher.close();
        },
    };
}

export function getNovelAiProxyResolver(): NovelAiProxyResolver {
    if (!defaultResolver) {
        defaultResolver = createNovelAiProxyResolver();
    }
    return defaultResolver;
}

export function parseWindowsProxyUrls(output: string): string[] {
    const urls: string[] = [];
    const seen = new Set<string>();
    for (const line of output.split(/\r?\n/u)) {
        const marker = line.match(/proxy server(?:\(s\))?|proxyserver/iu);
        if (!marker || marker.index === undefined) continue;
        const payload = line.slice(marker.index + marker[0].length)
            .replace(/^\s*(?::|REG_SZ)\s*/iu, "");
        for (const token of payload.split(/[;\s]+/u)) {
            if (!token) continue;
            const separator = token.indexOf("=");
            const scheme = separator >= 0 ? token.slice(0, separator).toLowerCase() : "http";
            const address = separator >= 0 ? token.slice(separator + 1) : token;
            if (scheme !== "http" && scheme !== "https") continue;
            const url = normalizeLoopbackProxyUrl(address, `${scheme}:`);
            if (!url || seen.has(url.toString())) continue;
            seen.add(url.toString());
            urls.push(url.toString());
        }
    }
    return urls;
}

async function readWindowsProxyUrls(): Promise<string[]> {
    const outputs: string[] = [];
    const commands: Array<[string, string[]]> = [
        ["reg.exe", [
            "query",
            "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
        ]],
        ["netsh.exe", ["winhttp", "show", "proxy"]],
    ];
    for (const [command, args] of commands) {
        try {
            const result = await execFile(command, args, {
                timeout: 1_000,
                windowsHide: true,
                maxBuffer: 64 * 1024,
            });
            if (command !== "reg.exe" || isWindowsProxyEnabled(result.stdout)) {
                outputs.push(result.stdout);
            }
        } catch (error) {
            const stdout = (error as {stdout?: unknown}).stdout;
            if (typeof stdout === "string" && (command !== "reg.exe" || isWindowsProxyEnabled(stdout))) {
                outputs.push(stdout);
            }
        }
    }
    return outputs.flatMap(parseWindowsProxyUrls);
}

function isWindowsProxyEnabled(output: string): boolean {
    const match = output.match(/ProxyEnable\s+REG_DWORD\s+(0x[0-9a-f]+|\d+)/iu);
    return !match || Number(match[1]) !== 0;
}

function resolveCandidatePorts(
    environment: Readonly<Record<string, string | undefined>>,
    configuredPorts: readonly number[] | undefined,
): number[] {
    if (configuredPorts) return configuredPorts.filter(isValidPort);
    const override = environment.NEURO_BOOK_NOVELAI_PROXY_PORTS?.trim() ?? "";
    if (override !== "") {
        return override
            .split(/[\s,;]+/u)
            .map((value) => Number(value))
            .filter(isValidPort);
    }
    return defaultCandidatePorts;
}

function normalizeLoopbackProxyUrl(
    value: string,
    defaultProtocol: "http:" | "https:" = "http:",
): URL | null {
    try {
        const source = value.includes("://") ? value : `${defaultProtocol}//${value}`;
        const url = new URL(source);
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        if (!isLoopbackHostname(url.hostname)) return null;
        if (url.port !== "" && !isValidPort(Number(url.port))) return null;
        return url;
    } catch {
        return null;
    }
}

function isLoopbackHostname(value: string): boolean {
    const hostname = value.replace(/^\[|\]$/gu, "").toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isValidPort(value: number): boolean {
    return Number.isInteger(value) && value >= 1 && value <= 65_535;
}

async function probeHttpProxy(proxyUrl: URL, targetHost: string, targetPort: number): Promise<boolean> {
    return await new Promise((resolve) => {
        let socket: Socket;
        let settled = false;
        const finish = (result: boolean) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(result);
        };
        const sendConnect = () => {
            const credentials = proxyUrl.username !== ""
                ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString("base64")}\r\n`
                : "";
            socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nConnection: close\r\n${credentials}\r\n`);
        };

        socket = proxyUrl.protocol === "https:"
            ? tlsConnect({
                host: proxyUrl.hostname,
                port: Number(proxyUrl.port || 443),
                servername: proxyUrl.hostname,
            })
            : netConnect({
                host: proxyUrl.hostname,
                port: Number(proxyUrl.port || 80),
            });
        socket.setTimeout(probeTimeoutMs, () => finish(false));
        socket.once("error", () => finish(false));
        socket.once(proxyUrl.protocol === "https:" ? "secureConnect" : "connect", sendConnect);

        let response = "";
        socket.on("data", (chunk: Buffer) => {
            response += chunk.toString("latin1");
            if (!response.includes("\r\n\r\n")) return;
            const status = response.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/u)?.[1];
            finish(status !== undefined && Number(status) >= 200 && Number(status) < 300);
        });
    });
}
