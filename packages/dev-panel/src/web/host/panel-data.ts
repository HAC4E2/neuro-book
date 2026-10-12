import {onScopeDispose, reactive, ref, shallowRef, watch, type Ref} from "vue";
import {ApiError, getJson, type ApiWarning, type PartName, type Revisions} from "./api.js";

/**
 * 面板的数据宿主（单例）：全应用只有一条 `/ws`，外壳与各页面共用。
 * - 推送只说“哪块变了”（`records`、`activity`、`sessions`），订阅了这几块的资源各自重取；
 * - 回应带服务实例 id 与各块的 revision，只接受更新的数据：两次“变了”触发的两次重取，旧的回应后到时丢掉；
 * - 服务重启（实例 id 变了）时全部重取；连接断开后退避重连。
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
    revisions: {records: 0, activity: 0, sessions: 0} as Revisions,
    connection: "connecting" as ConnectionState,
    /** 没登录（401）：整个面板只显示“用 nbdev panel open 打开”。 */
    unauthorized: false,
    /** 最近一次推送到达的时刻（顶栏显示数据的新旧）。 */
    lastPushAt: null as string | null,
});

const subscribers = new Set<Subscriber>();
let socket: WebSocket | null = null;
let attempts = 0;
let started = false;

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
        setTimeout(() => {
            if (!panelState.unauthorized) connect();
        }, delay);
    });
}

/** 外壳挂载时调一次。 */
export function startPanelData(): void {
    if (started) return;
    started = true;
    connect();
}

export type Resource<T> = {
    data: Ref<T | null>;
    warnings: Ref<ApiWarning[]>;
    error: Ref<ResourceError | null>;
    /** 请求已经等了 200 毫秒以上还没回来（快的请求不闪加载态）。 */
    loading: Ref<boolean>;
    reload(): void;
};

/**
 * 页面取一份数据：`path` 变了就重取；它依赖的几块数据（`parts`）变了也重取。
 * 只接受最后一次发出的请求的回应，且回应的 revision 不比已接受的旧。
 */
export function useResource<T>(path: () => string | null, parts: readonly PartName[]): Resource<T> {
    const data = shallowRef<T | null>(null);
    const warnings = shallowRef<ApiWarning[]>([]);
    const error = ref<ResourceError | null>(null);
    const loading = ref(false);
    let sequence = 0;
    let accepted: {instance: string; revisions: Revisions} | null = null;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async (keepData: boolean) => {
        const target = path();
        controller?.abort();
        if (timer) clearTimeout(timer);
        if (target === null) {
            data.value = null;
            loading.value = false;
            return;
        }
        const mine = ++sequence;
        const local = new AbortController();
        controller = local;
        if (!keepData) {
            data.value = null;
            accepted = null;
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
            }
            error.value = null;
        } catch (caught) {
            if (caught instanceof DOMException && caught.name === "AbortError") return;
            if (mine !== sequence) return;
            if (caught instanceof ApiError) {
                if (caught.status === 401) panelState.unauthorized = true;
                error.value = {code: caught.code, message: caught.message, status: caught.status};
            } else {
                error.value = {code: "internal", message: caught instanceof Error ? caught.message : String(caught), status: 0};
            }
        } finally {
            if (mine === sequence) {
                if (timer) clearTimeout(timer);
                loading.value = false;
            }
        }
    };

    const subscriber: Subscriber = {parts, refresh: () => void load(true)};
    subscribers.add(subscriber);
    watch(path, () => void load(false), {immediate: true});
    onScopeDispose(() => {
        subscribers.delete(subscriber);
        controller?.abort();
        if (timer) clearTimeout(timer);
    });
    return {data, warnings, error, loading, reload: () => void load(true)};
}
