import {createHmac, randomBytes, timingSafeEqual} from "node:crypto";

/**
 * 本机登录（t09 的一半；设备配对与分级在 t13）：回环对本机的其他账户也开放，所以 `/api/*` 与 `/ws` 都要登录。
 * `panel serve` 生成启动令牌写进权限 600 的 `panel.json`；`panel open` 用它签一张一次性票据，
 * 浏览器打开 `/login?ticket=…`，服务核对后换成只在本次服务实例里有效的会话 cookie。
 */

/** 会话 cookie 名的前缀；实际的名字带上面板端口（`nbdev_panel_4400`）。 */
export const SESSION_COOKIE_PREFIX = "nbdev_panel";
export const TICKET_TTL_MS = 5 * 60_000;

function mac(token: string, payload: string): string {
    return createHmac("sha256", token).update(payload).digest("hex");
}

/** `<nonce>.<过期时刻毫秒>.<HMAC>`；用一次作废，5 分钟过期。 */
export function createLoginTicket(token: string, now: number = Date.now()): string {
    const payload = `${randomBytes(16).toString("hex")}.${now + TICKET_TTL_MS}`;
    return `${payload}.${mac(token, payload)}`;
}

export type PanelAuth = {
    /** 核对票据并作废它；通过时返回新的会话 id，否则返回 null。 */
    redeem(ticket: string, now?: number): string | null;
    /** 请求头里的会话 cookie 是否有效。 */
    authorized(cookieHeader: string | null): boolean;
    /** 请求头里有效的会话 id（终端连接记下它，t13 吊销设备时据此关掉已开的终端）；没有为 null。 */
    sessionOf(cookieHeader: string | null): string | null;
    cookie(sessionId: string): string;
};

export function createPanelAuth(token: string, cookieName: () => string = () => SESSION_COOKIE_PREFIX): PanelAuth {
    const used = new Map<string, number>();
    const sessions = new Set<string>();
    return {
        redeem(ticket, now = Date.now()) {
            for (const [nonce, expires] of used) if (expires < now) used.delete(nonce);
            const parts = ticket.split(".");
            if (parts.length !== 3) return null;
            const [nonce, expiresText, signature] = parts as [string, string, string];
            const expected = Buffer.from(mac(token, `${nonce}.${expiresText}`), "hex");
            const given = Buffer.from(/^[0-9a-f]{64}$/u.test(signature) ? signature : "", "hex");
            if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
            const expires = Number(expiresText);
            if (!Number.isFinite(expires) || expires < now || used.has(nonce)) return null;
            used.set(nonce, expires);
            const sessionId = randomBytes(24).toString("base64url");
            sessions.add(sessionId);
            return sessionId;
        },
        authorized(cookieHeader) {
            return this.sessionOf(cookieHeader) !== null;
        },
        sessionOf(cookieHeader) {
            if (!cookieHeader) return null;
            for (const part of cookieHeader.split(";")) {
                const [name, ...rest] = part.trim().split("=");
                if (name === cookieName() && sessions.has(rest.join("="))) return rest.join("=");
            }
            return null;
        },
        cookie(sessionId) {
            return `${cookieName()}=${sessionId}; HttpOnly; SameSite=Strict; Path=/`;
        },
    };
}
