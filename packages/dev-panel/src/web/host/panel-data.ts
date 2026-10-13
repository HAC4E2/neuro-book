import {computed, onScopeDispose, reactive, ref, shallowRef, watch, type ComputedRef, type Ref} from "vue";
import {ApiError, getJson, onAuthLost, type ApiWarning, type PartName, type Revisions} from "./api.js";

/**
 * 面板的数据宿主（单例）：全应用只有一条 `/ws`，外壳与各页面共用。
 * - 推送只说“哪块变了”（`records`、`activity`、`sessions`），订阅了这几块的资源各自重取；
 * - 回应带服务实例 id 与各块的 revision，只接受更新的数据：两次“变了”触发的两次重取，旧的回应后到时丢掉；
 * - 服务重启（实例 id 变了）时全部重取；连接断开后退避重连，每次重连前先探一次 `/api/meta`（见 `probeBeforeReconnect`）。
 * 页面经 `useResource` 取数，零件只吃 props。
 */

export type ConnectionState = "connecting" | "open" | "closed";
export type ResourceError = {code: string; message: string; status: number};

type Subscriber = {parts: readonly PartName[]; refresh: () => void};

const LOADING_DELAY_MS = 200;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 10_000;

export const panelState = reactive({
    instance: "",
    revisions: {records: 0, activity: 0, sessions: 0, notify: 0, github: 0} as Revisions,
    connection: "connecting" as ConnectionState,
    /**
     * 登录失效（任何 `/api/*` 回 401）：停止推送、重连与取数，外壳盖一层提示、页面不卸载（草稿还在）。
     * 重新登录后 `confirmRelogin()` 解除，`authEpoch` 加一（会话页据此重建终端连接），全部重取。
     */
    unauthorized: false,
    authEpoch: 0,
    /** 最近一次推送到达的时刻（顶栏显示数据的新旧）。 */
    lastPushAt: null as string | null,
});

const subscribers = new Set<Subscriber>();
let socket: WebSocket | null = null;
let attempts = 0;
let started = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function notify(parts: readonly PartName[], all: boolean): void {
    for (const subscriber of subscribers) {
        if (all || subscriber.parts.some((part) => parts.includes(part))) subscriber.refresh();
    }
}

function onMessage(event: MessageEvent): void {
    let message: {type?: string; instance?: string; parts?: PartName[]; revisions?: Revisions};
    try {
        message = JSON.parse(String(event.data)) as typeof message;
    } catch {
        console.warn("面板推送了一条读不懂的消息，已忽略", event.data);
        return;
    }
    if (!message.instance || !message.revisions) return;
    const restarted = panelState.instance !== "" && message.instance !== panelState.instance;
    const changed = (Object.keys(message.revisions) as PartName[]).filter((part) => message.revisions![part] !== panelState.revisions[part]);
    panelState.instance = message.instance;
    panelState.revisions = {...message.revisions};
    panelState.lastPushAt = new Date().toISOString();
    if (message.type === "hello") notify([], restarted || attempts > 0);
    else notify(message.parts ?? changed, restarted);
    attempts = 0;
}

/**
 * 重连之前先取一次 `/api/meta`：会话只在一个服务实例里有效，面板重启后 `/ws` 的升级回 401，
 * 浏览器却只报一次断开、拿不到状态码，只靠重连会永远停在旧数据上。这里回 401 就经登录失效的出口进入失效状态并停止重连；
 * 其余情形（200，连不上，还在启动的 503）照常退避重连，重连后的 `hello` 负责全部重取。
 */
async function probeBeforeReconnect(): Promise<boolean> {
    try {
        await getJson<unknown>("/api/meta");
    } catch (caught) {
        // 回 401 时登录失效的出口已经停掉一切（见 `onAuthLost`）。
        if (!(caught instanceof ApiError && caught.status === 401)) console.warn("重连前探测面板失败，照常重连", caught);
    }
    return !panelState.unauthorized;
}

function connect(): void {
    panelState.connection = "connecting";
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    socket = ws;
    ws.addEventListener("open", () => {
        panelState.connection = "open";
    });
    ws.addEventListener("message", onMessage);
    ws.addEventListener("close", () => {
        if (socket !== ws) return;
        panelState.connection = "closed";
        attempts += 1;
        const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.min(attempts - 1, 4));
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (panelState.unauthorized) return;
            void probeBeforeReconnect().then((go) => {
                if (go && started && !panelState.unauthorized) connect();
            });
        }, delay);
    });
}

/** 关掉推送连接、取消已排的重连；`socket` 先置空，旧连接的 close 事件不再排重连。 */
function disconnect(): void {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    const ws = socket;
    socket = null;
    ws?.close(1000, "面板数据宿主停止");
}

/** 外壳挂载时调一次。 */
export function startPanelData(): void {
    if (started) return;
    started = true;
    connect();
}

onAuthLost(() => {
    if (panelState.unauthorized) return;
    panelState.unauthorized = true;
    disconnect();
});

/**
 * 外壳的“我已重新登录”：重探 `/api/meta`，通过就解除登录失效、`authEpoch` 加一、重连推送，并全部重取（不靠 `hello`：
 * 同一个服务实例里失效再重登，`hello` 不会触发全部重取）。回 `null` 表示好了，否则是还不行的原因。
 */
export async function confirmRelogin(): Promise<string | null> {
    try {
        await getJson<unknown>("/api/meta");
    } catch (caught) {
        if (!(caught instanceof ApiError)) throw caught;
        return caught.status === 401 ? "还是没有登录：用 nbdev panel open 给的新链接在这个浏览器里登录一次" : `连不上面板：${caught.message}`;
    }
    panelState.unauthorized = false;
    panelState.authEpoch += 1;
    if (started) {
        attempts = 0;
        connect();
    }
    notify([], true);
    return null;
}

/** 外壳卸载时调：关连接、取消重连，复位连接状态，之后可以再 `startPanelData()`。 */
export function stopPanelData(): void {
    started = false;
    attempts = 0;
    disconnect();
    panelState.instance = "";
    panelState.revisions = {records: 0, activity: 0, sessions: 0, notify: 0, github: 0};
    panelState.connection = "connecting";
    panelState.unauthorized = false;
    panelState.authEpoch = 0;
    panelState.lastPushAt = null;
}

export type Resource<T> = {
    data: Ref<T | null>;
    warnings: Ref<ApiWarning[]>;
    error: Ref<ResourceError | null>;
    /** 请求已经等了 200 毫秒以上还没回来（快的请求不闪加载态）。 */
    loading: Ref<boolean>;
    /** 最近一次接受数据的时刻（ISO）。 */
    receivedAt: Ref<string | null>;
    /** 已有数据、这次重取却失败：页面显示的是上次读到的内容（`StaleNotice`，t15）。 */
    stale: ComputedRef<boolean>;
    reload(): void;
};

/**
 * 页面取一份数据：`path` 变了就重取；它依赖的几块数据（`parts`）变了也重取。
 * 只接受最后一次发出的请求的回应，且回应的 revision 不比已接受的旧。
 * 推送触发的重取单飞（t15）：在途时再来推送只记一笔，结束后至多再取一次。直接中止重发的话，推送间隔短于请求耗时就永远收不到数据。
 * 显式 `reload()` 与 `path` 变化照旧中止在途、立即重取：它们多在写入之后调，要的是比这次写入新的数据，不能并进写入前发出的请求。
 */
export function useResource<T>(path: () => string | null, parts: readonly PartName[]): Resource<T> {
    const data = shallowRef<T | null>(null);
    const warnings = shallowRef<ApiWarning[]>([]);
    const error = ref<ResourceError | null>(null);
    const loading = ref(false);
    const receivedAt = ref<string | null>(null);
    let sequence = 0;
    let accepted: {instance: string; revisions: Revisions} | null = null;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inflight = false;
    let pushedWhileInflight = false;
    let disposed = false;

    const load = async (keepData: boolean) => {
        if (disposed) return;
        // 登录失效期间不取数（自带轮询的页面也就停了），重新登录后全部重取。
        if (panelState.unauthorized) return;
        const target = path();
        controller?.abort();
        if (timer) clearTimeout(timer);
        if (target === null) {
            data.value = null;
            receivedAt.value = null;
            loading.value = false;
            return;
        }
        const mine = ++sequence;
        const local = new AbortController();
        controller = local;
        inflight = true;
        if (!keepData) {
            data.value = null;
            accepted = null;
            receivedAt.value = null;
        }
        timer = setTimeout(() => {
            if (mine === sequence) loading.value = true;
        }, LOADING_DELAY_MS);
        try {
            const body = await getJson<T>(target, local.signal);
            if (mine !== sequence) return;
            const stale = accepted !== null && accepted.instance === body.instance && parts.some((part) => body.revisions[part] < accepted!.revisions[part]);
            if (!stale) {
                accepted = {instance: body.instance, revisions: body.revisions};
                data.value = body.data;
                warnings.value = body.warnings;
                receivedAt.value = new Date().toISOString();
            }
            error.value = null;
        } catch (caught) {
            if (caught instanceof DOMException && caught.name === "AbortError") return;
            if (mine !== sequence) return;
            if (caught instanceof ApiError) {
                error.value = {code: caught.code, message: caught.message, status: caught.status};
            } else {
                error.value = {code: "internal", message: caught instanceof Error ? caught.message : String(caught), status: 0};
            }
        } finally {
            if (mine === sequence) {
                if (timer) clearTimeout(timer);
                loading.value = false;
                inflight = false;
                if (controller === local) controller = null;
                if (pushedWhileInflight) {
                    pushedWhileInflight = false;
                    void load(true);
                }
            }
        }
    };

    const restart = (keepData: boolean) => {
        pushedWhileInflight = false;
        void load(keepData);
    };
    const subscriber: Subscriber = {parts, refresh: () => {
        if (inflight) pushedWhileInflight = true;
        else void load(true);
    }};
    subscribers.add(subscriber);
    watch(path, () => restart(false), {immediate: true});
    onScopeDispose(() => {
        disposed = true;
        subscribers.delete(subscriber);
        controller?.abort();
        if (timer) clearTimeout(timer);
    });
    const stale = computed(() => data.value !== null && error.value !== null);
    return {data, warnings, error, loading, receivedAt, stale, reload: () => restart(true)};
}
