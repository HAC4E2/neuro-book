import {randomBytes, timingSafeEqual} from "node:crypto";
import {readFile} from "node:fs/promises";
import type {Server, ServerWebSocket} from "bun";
import type {HerdrClient} from "../herdr/client.js";
import {NbdevError, isNbdevError, systemErrorCode, type Warning} from "../core/errors.js";
import type {RepoContext} from "../core/repo.js";
import {createNameIndexCache, searchCheckouts, validateSearchQuery} from "../core/search.js";
import {createPanelAuth, type PanelAuth} from "./auth.js";
import {allowedHosts, contentType, decodePath, guardedFile, rejectForwarded, rejectHost, sameHostOn, type Rejection} from "./guard.js";
import {PanelState, type PartName} from "./state.js";
import {artifactsView, artifactView, docFileView, docsTreeView, NotReady, overviewView, recordMatches, sessionsView, taskView, workView} from "./views.js";

/**
 * 面板服务：两个来源（`Bun.serve` 各一个）。
 * - 面板 `127.0.0.1:<port>`：前端页面、`/api/*` 的 JSON、`/ws` 的推送、`/login` 的一次性登录；
 * - 产物 `127.0.0.1:<artifactPort>`：只读的静态文件，地址带服务启动时生成的随机前缀，只给 `.agents/works/` 下的文件。
 * 合同见 docs/panel.md。
 */

export const PANEL_API_SCHEMA = "nbdev.panel-api/v1";
/** 产物来源上留给 t10 表单脚本的保留路径（本片回 404）。 */
export const RESERVED_ARTIFACT_SEGMENT = "_nbdev";

export type PanelServerOptions = {
    context: RepoContext;
    host: string;
    port: number;
    artifactPort: number;
    herdr: HerdrClient | null;
    token: string;
    log: (message: string) => void;
};

export type PanelServer = {
    readonly url: string;
    readonly artifactUrl: string;
    readonly port: number;
    readonly artifactPort: number;
    readonly instanceId: string;
    readonly state: PanelState;
    readonly auth: PanelAuth;
    /** 前端产物目录（构建或测试注入之后才有）；没有时页面回 503。 */
    setStatic(dir: string, build: {failed: string | null}): Promise<void>;
    /** 预热（记录与活动各算一遍）并开始监视；之前 `/api/*` 回 503。 */
    warm(): Promise<void>;
    stop(): Promise<void>;
};

type SocketData = {instance: string};

const SECURITY_HEADERS = {"X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store"};

function plain(status: number, text: string, extra: Record<string, string> = {}): Response {
    return new Response(`${text}\n`, {status, headers: {...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8", ...extra}});
}

function rejection(result: Rejection): Response {
    return plain(result.status, `${result.code}：${result.message}`);
}

function isRejection(value: unknown): value is Rejection {
    return typeof value === "object" && value !== null && "status" in value && "code" in value;
}

function equalSecret(given: string | null, expected: string): boolean {
    if (given === null) return false;
    const left = Buffer.from(given);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
}

export async function startPanelServer(options: PanelServerOptions): Promise<PanelServer> {
    const {context, host, log} = options;
    const state = new PanelState(context, options.herdr, log);
    const auth = createPanelAuth(options.token);
    const csrf = randomBytes(24).toString("base64url");
    const artifactPrefix = randomBytes(18).toString("base64url");
    const names = createNameIndexCache();
    let staticDir: string | null = null;
    let indexHtml: string | null = null;
    let ready = false;
    let currentSearch: AbortController | null = null;
    const sockets = new Set<ServerWebSocket<SocketData>>();

    let panel: Server<SocketData> | null = null;
    let artifacts: Server<undefined> | null = null;
    const listen = <T>(port: number, create: (port: number) => Server<T>): Server<T> => {
        try {
            return create(port);
        } catch (error) {
            if (systemErrorCode(error) === "EADDRINUSE") {
                throw new NbdevError("port_in_use", `端口 ${port} 已被占用；换一个端口（--port、--artifact-port）或先停掉占用它的进程`, {details: {port}});
            }
            throw error;
        }
    };

    const panelPort = () => panel!.port!;
    const artifactPortOf = () => artifacts!.port!;
    const artifactOrigin = (requestHost: string) => `http://${sameHostOn(requestHost, artifactPortOf())}`;

    const envelope = (data: unknown, warnings: Warning[], error: {code: string; message: string; details?: unknown} | null, status = 200): Response => new Response(JSON.stringify({
        schema: PANEL_API_SCHEMA, ok: error === null, data, warnings, errors: error ? [error] : [], instance: state.instanceId, revisions: state.revisions(),
    }), {status, headers: {...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8"}});
    const notFound = () => envelope(null, [], {code: "not_found", message: "找不到"}, 404);

    const panelCsp = (requestHost: string) => [
        "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", `img-src 'self' data: ${artifactOrigin(requestHost)}`,
        `connect-src 'self' ws://${requestHost}`, `frame-src ${artifactOrigin(requestHost)}`, "frame-ancestors 'none'", "form-action 'none'", "base-uri 'none'", "object-src 'none'",
    ].join("; ");

    async function api(req: Request, segments: string[], url: URL, requestHost: string): Promise<Response> {
        const [, route, ...rest] = segments;
        try {
            if (route === "meta" && rest.length === 0) {
                const herdr = state.herdr.current();
                const parts = {records: state.records.part, activity: state.activity.part};
                return envelope({
                    instance: state.instanceId,
                    startedAt: state.startedAt,
                    ready,
                    codeChanged: state.codeChanged,
                    build: state.build,
                    herdr: {available: herdr.available, mode: herdr.mode, version: herdr.version, at: herdr.at, error: herdr.error},
                    parts: Object.fromEntries(Object.entries(parts).map(([name, part]) => [name, {revision: part.revision, at: part.at, error: part.error}])),
                    artifactOrigin: artifactOrigin(requestHost),
                    // 前端渲染 Markdown 时把 `.agents/works/` 下的图片与证据链接改写到产物来源上；前缀只经登录后的接口交出。
                    artifactBase: `${artifactOrigin(requestHost)}/a/${artifactPrefix}`,
                }, [], null);
            }
            if (!ready) return envelope(null, [], {code: "warming_up", message: "面板正在启动"}, 503);
            if (route === "overview" && rest.length === 0) {
                const {data, warnings} = overviewView(state);
                return envelope(data, warnings, null);
            }
            if (route === "work" && rest.length === 1) {
                const view = workView(state, rest[0]!);
                return view ? envelope(view.data, view.warnings, null) : notFound();
            }
            if (route === "task" && rest.length === 2) {
                const view = await taskView(state, rest[0]!, rest[1]!);
                return view ? envelope(view.data, view.warnings, null) : notFound();
            }
            if (route === "artifacts" && rest.length === 0) {
                const {data, warnings} = await artifactsView(state);
                return envelope(data, warnings, null);
            }
            if (route === "artifact" && rest.length === 3) {
                const base = (checkoutKey: string, path: string) => `${artifactOrigin(requestHost)}/a/${artifactPrefix}/${encodeURIComponent(checkoutKey)}/${path.split("/").map(encodeURIComponent).join("/")}`;
                const view = await artifactView(state, {workId: rest[0]!, taskId: rest[1] === "-" ? null : rest[1]!, artifactId: rest[2]!, version: url.searchParams.get("version")}, base);
                return view ? envelope(view.data, view.warnings, null) : notFound();
            }
            if (route === "docs" && rest.length === 1 && rest[0] === "tree") {
                const view = await docsTreeView(state, url.searchParams.get("checkout") ?? "main");
                return view ? envelope(view.data, view.warnings, null) : notFound();
            }
            if (route === "docs" && rest.length === 1 && rest[0] === "file") {
                const path = url.searchParams.get("path");
                if (path === null) return notFound();
                const view = await docFileView(state, url.searchParams.get("checkout") ?? "main", path);
                return view ? envelope(view.data, view.warnings, null) : notFound();
            }
            if (route === "sessions" && rest.length === 0) {
                const {data, warnings} = sessionsView(state);
                return envelope(data, warnings, null);
            }
            if (route === "search" && rest.length === 0) return search(req, url);
            return notFound();
        } catch (error) {
            if (error instanceof NotReady) return envelope(null, [], {code: "warming_up", message: error.message}, 503);
            if (isNbdevError(error)) return envelope(null, [], {code: error.code, message: error.message, details: error.details}, error.exitCode === 5 ? 404 : error.exitCode === 2 ? 400 : 500);
            log(`接口 ${url.pathname} 失败：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
            return envelope(null, [], {code: "internal", message: "面板内部错误，详见面板的日志"}, 500);
        }
    }

    /** 搜索：按行流式返回 NDJSON。全局同一时刻只跑一组，有新搜索或客户端断开就结束旧的子进程。 */
    function search(req: Request, url: URL): Response {
        let q: string;
        try {
            q = validateSearchQuery(url.searchParams.get("q") ?? "");
        } catch (error) {
            if (!isNbdevError(error)) throw error;
            return envelope(null, [], {code: error.code, message: error.message}, 400);
        }
        const key = url.searchParams.get("checkout");
        const targets = state.checkouts.filter((checkout) => !checkout.prunable && (key === null || state.keyOf(checkout.root) === key));
        if (key !== null && targets.length === 0) return notFound();
        currentSearch?.abort();
        const controller = new AbortController();
        currentSearch = controller;
        req.signal.addEventListener("abort", () => controller.abort(), {once: true});
        const started = Date.now();
        const encoder = new TextEncoder();
        let cancelled = false;
        const stream = new ReadableStream<Uint8Array>({
            async start(sink) {
                // 被新的搜索取代时照样送最后一行（`aborted: true`），客户端知道这组结果不全；客户端断开后就不再送。
                const send = (line: unknown) => {
                    if (!cancelled) sink.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
                };
                let truncated = false;
                try {
                    for (const match of recordMatches(state, q)) send({type: "record", ...match});
                    await searchCheckouts({
                        q,
                        checkouts: targets.map((checkout) => ({key: state.keyOf(checkout.root)!, root: checkout.root, head: checkout.head})),
                        names,
                        signal: controller.signal,
                        onHit: (hit) => send({type: "hit", ...hit}),
                        onCheckoutDone: (done) => {
                            truncated ||= done.truncated;
                            send({type: "checkout_done", ...done});
                        },
                    });
                    send({type: "end", truncated: truncated || controller.signal.aborted, aborted: controller.signal.aborted, elapsedMs: Date.now() - started});
                } catch (error) {
                    log(`搜索失败：${error instanceof Error ? error.message : String(error)}`);
                    send({type: "error", message: "搜索失败，详见面板的日志"});
                } finally {
                    if (currentSearch === controller) currentSearch = null;
                    if (!cancelled) sink.close();
                }
            },
            cancel() {
                cancelled = true;
                controller.abort();
            },
        });
        return new Response(stream, {headers: {...SECURITY_HEADERS, "Content-Type": "application/x-ndjson; charset=utf-8"}});
    }

    async function serveStatic(segments: string[], requestHost: string): Promise<Response> {
        if (!staticDir || !indexHtml) return plain(503, "面板正在启动，稍后刷新");
        const last = segments.at(-1) ?? "";
        // 单页路由回退只给不带点的路径：`/.git/config`、`/x.js` 这样的不会拿到 index.html。
        if (segments.length === 0 || !last.includes(".")) {
            if (segments.some((segment) => segment.startsWith("."))) return plain(404, "找不到");
            return new Response(indexHtml, {headers: {...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": panelCsp(requestHost)}});
        }
        const file = await guardedFile(staticDir, segments.join("/"));
        if (!file) return plain(404, "找不到");
        return new Response(Bun.file(file), {headers: {...SECURITY_HEADERS, "Content-Type": contentType(file), "Cache-Control": segments[0] === "assets" ? "public, max-age=31536000, immutable" : "no-store"}});
    }

    async function handlePanel(req: Request, server: Server<SocketData>): Promise<Response | undefined> {
        const forwarded = rejectForwarded(req.headers);
        if (forwarded) return rejection(forwarded);
        const badHost = rejectHost(req.headers, panelPort());
        if (badHost) return rejection(badHost);
        const requestHost = req.headers.get("host")!.toLowerCase();
        const url = new URL(req.url);
        const decoded = decodePath(url.pathname);
        if (isRejection(decoded)) return rejection(decoded);
        const {segments} = decoded;
        const origin = req.headers.get("origin");
        const sameOrigin = origin !== null && allowedHosts(panelPort()).some((allowed) => origin === `http://${allowed}`);
        if (req.method !== "GET" && req.method !== "HEAD") {
            // 本片没有写接口；校验先建好（t10 直接用）：同源的 Origin 加页面里的 CSRF 令牌。
            if (!sameOrigin || !equalSecret(req.headers.get("x-nbdev-csrf"), csrf)) return plain(403, "forbidden：跨来源的写请求，或缺少 CSRF 令牌");
            return plain(405, "method_not_allowed：面板本片只读");
        }
        if (segments[0] === "login" && segments.length === 1) {
            const sessionId = auth.redeem(url.searchParams.get("ticket") ?? "");
            if (!sessionId) return plain(403, "登录链接无效或已过期：用 nbdev panel open 重新打开");
            return new Response(null, {status: 302, headers: {...SECURITY_HEADERS, "Set-Cookie": auth.cookie(sessionId), Location: "/"}});
        }
        if (segments[0] === "api" || segments[0] === "ws") {
            const site = req.headers.get("sec-fetch-site");
            if (site !== null && site !== "same-origin" && site !== "none") return plain(403, "forbidden：跨站请求");
            if (!auth.authorized(req.headers.get("cookie"))) return segments[0] === "api" ? envelope(null, [], {code: "unauthorized", message: "没有登录：用 nbdev panel open 打开面板"}, 401) : plain(401, "unauthorized");
            if (segments[0] === "ws") {
                if (segments.length !== 1) return plain(404, "找不到");
                if (!sameOrigin) return plain(403, "forbidden：WebSocket 的 Origin 不是本面板");
                return server.upgrade(req, {data: {instance: state.instanceId}}) ? undefined : plain(400, "需要 WebSocket 升级");
            }
            return api(req, segments, url, requestHost);
        }
        return serveStatic(segments, requestHost);
    }

    async function handleArtifact(req: Request): Promise<Response> {
        const forwarded = rejectForwarded(req.headers);
        if (forwarded) return rejection(forwarded);
        const badHost = rejectHost(req.headers, artifactPortOf());
        if (badHost) return rejection(badHost);
        if (req.method !== "GET" && req.method !== "HEAD") return plain(405, "method_not_allowed：产物来源只读");
        const decoded = decodePath(new URL(req.url).pathname);
        if (isRejection(decoded)) return rejection(decoded);
        const [a, prefix, checkoutKey, ...rest] = decoded.segments;
        if (a !== "a" || !equalSecret(prefix ?? null, artifactPrefix) || checkoutKey === undefined || checkoutKey === RESERVED_ARTIFACT_SEGMENT || rest.length === 0) return plain(404, "找不到");
        const checkout = state.checkoutByKey(checkoutKey);
        if (!checkout) return plain(404, "找不到");
        const file = await guardedFile(checkout.root, rest.join("/"), ".agents/works/");
        if (!file) return plain(404, "找不到");
        const requestHost = req.headers.get("host")!.toLowerCase();
        const panelOrigins = allowedHosts(panelPort()).map((allowed) => `http://${allowed}`).join(" ");
        return new Response(Bun.file(file), {headers: {
            ...SECURITY_HEADERS,
            "Content-Type": contentType(file),
            // 地址里有猜不到的前缀，才能放开 CORS：沙箱 iframe 是不透明来源，模块脚本、fetch 与字体都按 CORS 取。
            "Access-Control-Allow-Origin": "*",
            "Content-Security-Policy": `sandbox allow-scripts allow-forms allow-popups; frame-ancestors ${panelOrigins} http://${sameHostOn(requestHost, panelPort())}`,
        }});
    }

    panel = listen(options.port, (port) => Bun.serve<SocketData>({
        hostname: host,
        port,
        fetch: (req, server) => handlePanel(req, server),
        websocket: {
            open(ws) {
                sockets.add(ws);
                state.clientConnected();
                ws.send(JSON.stringify({type: "hello", instance: state.instanceId, revisions: state.revisions()}));
            },
            message() {},
            close(ws) {
                sockets.delete(ws);
                state.clientDisconnected();
            },
        },
    }));
    try {
        artifacts = listen(options.artifactPort, (port) => Bun.serve({hostname: host, port, fetch: (req) => handleArtifact(req)}));
    } catch (error) {
        await panel.stop(true);
        throw error;
    }
    const unsubscribe = state.onChange((part: PartName) => {
        const message = JSON.stringify({type: "changed", instance: state.instanceId, parts: [part], revisions: state.revisions()});
        for (const ws of sockets) ws.send(message);
    });

    const urlHost = host.includes(":") ? `[${host}]` : host;
    return {
        url: `http://${urlHost}:${panel.port}`,
        artifactUrl: `http://${urlHost}:${artifacts.port}`,
        port: panel.port!,
        artifactPort: artifacts.port!,
        instanceId: state.instanceId,
        state,
        auth,
        async setStatic(dir, build) {
            const html = await readFile(`${dir}/index.html`, "utf8");
            state.build = {failed: build.failed !== null, message: build.failed};
            indexHtml = html.replace("</head>", `<meta name="nbdev-csrf" content="${csrf}">\n</head>`);
            staticDir = dir;
        },
        async warm() {
            await state.warm();
            state.watchAll();
            ready = true;
            for (const ws of sockets) ws.send(JSON.stringify({type: "changed", instance: state.instanceId, parts: ["records", "activity", "sessions"], revisions: state.revisions()}));
        },
        async stop() {
            unsubscribe();
            currentSearch?.abort();
            state.stop();
            for (const ws of sockets) ws.close(1001, "面板退出");
            await Promise.all([panel?.stop(true), artifacts?.stop(true)]);
        },
    };
}
