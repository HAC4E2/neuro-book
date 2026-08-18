import {isIP} from "node:net";

/**
 * 校验 Provider 的服务端请求地址，拒绝会把服务端请求导向本机或内网的 URL。
 */
export function assertTextToImageProviderUrl(value: string, policy: {allowPrivateNetwork: boolean}): URL {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        throw new Error("Provider URL 不合法");
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Provider URL 仅支持 HTTP 或 HTTPS");
    }
    if (!url.hostname || url.username || url.password || url.hash) {
        throw new Error("Provider URL 不能包含凭据或片段");
    }
    if (!policy.allowPrivateNetwork && isPrivateNetworkHost(url.hostname)) {
        throw new Error("Provider URL 不能指向私有网络");
    }
    return url;
}

function isPrivateNetworkHost(hostname: string): boolean {
    const host = normalizeHostname(hostname);
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
        return true;
    }
    if (isIP(host) === 4) {
        return isPrivateIpv4(host);
    }
    if (isIP(host) === 6) {
        return isPrivateIpv6(host);
    }
    return false;
}

/**
 * 校验 DNS lookup 返回的实际 socket 目标地址。
 */
export function assertTextToImageProviderAddress(address: string): void {
    const normalized = normalizeHostname(address);
    const family = isIP(normalized);
    if (family === 0) {
        throw new Error("Provider DNS 返回了不合法地址");
    }
    if (family === 4 ? isPrivateIpv4(normalized) : isPrivateIpv6(normalized)) {
        throw new Error("Provider URL 不能指向私有网络");
    }
}

function isPrivateIpv4(value: string): boolean {
    const octets = value.split(".").map((segment) => Number.parseInt(segment, 10));
    const first = octets[0] ?? -1;
    const second = octets[1] ?? -1;
    const third = octets[2] ?? -1;
    return first === 0
        || first === 10
        || first === 127
        || first >= 224
        || (first === 100 && second >= 64 && second <= 127)
        || (first === 169 && second === 254)
        || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 168)
        || (first === 192 && second === 0 && third === 0)
        || (first === 192 && second === 0 && third === 2)
        || (first === 198 && second >= 18 && second <= 19)
        || (first === 198 && second === 51 && third === 100)
        || (first === 203 && second === 0 && third === 113);
}

function isPrivateIpv6(value: string): boolean {
    const groups = expandIpv6(value);
    if (!groups) {
        return true;
    }
    if (groups.every((group) => group === 0) || groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) {
        return true;
    }
    const [first = 0, second = 0, third = 0, fourth = 0, fifth = 0, sixth = 0, seventh = 0, eighth = 0] = groups;
    if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) {
        return true;
    }
    if (first === 0 && second === 0 && third === 0 && fourth === 0 && fifth === 0 && sixth === 0xffff) {
        const mappedIpv4 = [seventh >> 8, seventh & 0xff, eighth >> 8, eighth & 0xff].join(".");
        return isPrivateIpv4(mappedIpv4);
    }
    return false;
}

function normalizeHostname(value: string): string {
    return value
        .replace(/^\[/u, "")
        .replace(/\]$/u, "")
        .replace(/\.+$/u, "")
        .toLowerCase();
}

function expandIpv6(value: string): number[] | null {
    const [left, right] = value.split("::");
    if (value.split("::").length > 2) {
        return null;
    }
    const leftGroups = left ? left.split(":") : [];
    const rightGroups = right ? right.split(":") : [];
    const missing = 8 - leftGroups.length - rightGroups.length;
    if (missing < 0 || (value.includes("::") && missing < 1) || (!value.includes("::") && missing !== 0)) {
        return null;
    }
    const parts = [...leftGroups, ...Array.from({length: missing}, () => "0"), ...rightGroups];
    if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/iu.test(part))) {
        return null;
    }
    return parts.map((part) => Number.parseInt(part, 16));
}
