import {shallowRef} from "vue";
import type {ShallowRef} from "vue";

export type NotificationTone = "success" | "warning" | "info" | "error";

export type NotificationAction = {
    label: string;
    run: () => void;
};

export type NotificationInput = {
    message: string;
    title?: string;
    tone?: NotificationTone;
    action?: NotificationAction;
    /** 自动关闭的毫秒数；0 为常驻（只能手动关闭或由发出方移除）。缺省按色调取：info、success 3200，warning 4200，error 5200。 */
    duration?: number;
    /** 进度（0 到 100）；null 为不确定进度。不给就没有进度条。 */
    progress?: number | null;
};

/** 已发出的通知能改的字段；`duration` 给了就按新时长重新计时。 */
export type NotificationPatch = Partial<NotificationInput>;

export type NotificationItem = Required<Pick<NotificationInput, "tone" | "duration">> & NotificationInput & {
    id: string;
};

/**
 * 一份通知队列：发出、更新、移除与自动关闭计时。视口（`NotificationViewport`）从它读列表、经它关闭；悬停时暂停计时。
 * 列表只经这里的方法改，对外是只读的 ref。
 */
export interface NotificationQueue {
    readonly notifications: Readonly<ShallowRef<ReadonlyArray<NotificationItem>>>;
    notify(input: NotificationInput | string): string;
    /** 改已发出的通知（进度、文字、动作）；不存在的 id 忽略。 */
    update(id: string, patch: NotificationPatch): void;
    remove(id: string): void;
    /** 清空全部通知与计时器（测试隔离、登出清屏等场景）。 */
    clearAll(): void;
    /** 暂停自动关闭（悬停时调用），记录剩余时长。 */
    pause(id: string): void;
    /** 恢复自动关闭：按暂停时的剩余时长重新计时（至少留 800ms 反应时间）。 */
    resume(id: string): void;
    success(message: string, options?: Omit<NotificationInput, "message" | "tone">): string;
    warning(message: string, options?: Omit<NotificationInput, "message" | "tone">): string;
    error(message: string, options?: Omit<NotificationInput, "message" | "tone">): string;
    info(message: string, options?: Omit<NotificationInput, "message" | "tone">): string;
}

/** 各色调的缺省自动关闭时长（毫秒）。 */
export const DEFAULT_NOTIFICATION_DURATION: Readonly<Record<NotificationTone, number>> = {info: 3200, success: 3200, warning: 4200, error: 5200};

function createId(): string {
    return `notice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createNotificationQueue(): NotificationQueue {
    const notifications = shallowRef<ReadonlyArray<NotificationItem>>([]);
    const timers = new Map<string, ReturnType<typeof globalThis.setTimeout>>();
    // 自动关闭到期时间戳；pause 时据此换算剩余时长
    const deadlines = new Map<string, number>();

    function remove(id: string): void {
        const timer = timers.get(id);
        if (timer) {
            globalThis.clearTimeout(timer);
            timers.delete(id);
        }
        deadlines.delete(id);
        notifications.value = notifications.value.filter((item) => item.id !== id);
    }

    /** 启动/重启某条通知的自动关闭计时 */
    function schedule(id: string, duration: number): void {
        const existing = timers.get(id);
        if (existing) globalThis.clearTimeout(existing);
        deadlines.set(id, Date.now() + duration);
        timers.set(id, globalThis.setTimeout(() => remove(id), duration));
    }

    function pause(id: string): void {
        const timer = timers.get(id);
        if (!timer) {
            return;
        }
        globalThis.clearTimeout(timer);
        timers.delete(id);
    }

    function resume(id: string): void {
        const deadline = deadlines.get(id);
        if (deadline === undefined || timers.has(id)) {
            return;
        }
        schedule(id, Math.max(deadline - Date.now(), 800));
    }

    function notify(input: NotificationInput | string): string {
        const normalized = typeof input === "string" ? {message: input} : input;
        const tone = normalized.tone ?? "info";
        const item: NotificationItem = {
            id: createId(),
            message: normalized.message,
            title: normalized.title,
            tone,
            action: normalized.action,
            duration: normalized.duration ?? DEFAULT_NOTIFICATION_DURATION[tone],
            ...(normalized.progress === undefined ? {} : {progress: normalized.progress}),
        };
        notifications.value = [...notifications.value, item];
        if (item.duration > 0) {
            schedule(item.id, item.duration);
        }
        return item.id;
    }

    function update(id: string, patch: NotificationPatch): void {
        const index = notifications.value.findIndex((item) => item.id === id);
        if (index === -1) return;
        const current = notifications.value[index] as NotificationItem;
        const next: NotificationItem = {...current, ...patch, tone: patch.tone ?? current.tone, duration: patch.duration ?? current.duration};
        notifications.value = notifications.value.map((item) => (item.id === id ? next : item));
        if (patch.duration === undefined) return;
        // 时长变了就从现在重新计时：常驻改成限时是“任务结束了”，限时改成常驻是“出错要人看”。
        if (next.duration > 0) schedule(id, next.duration);
        else {
            pause(id);
            deadlines.delete(id);
        }
    }

    function clearAll(): void {
        for (const timer of timers.values()) {
            globalThis.clearTimeout(timer);
        }
        timers.clear();
        deadlines.clear();
        notifications.value = [];
    }

    return {
        notifications,
        notify,
        update,
        remove,
        clearAll,
        pause,
        resume,
        success: (message, options) => notify({...options, message, tone: "success"}),
        warning: (message, options) => notify({...options, message, tone: "warning"}),
        error: (message, options) => notify({...options, message, tone: "error"}),
        info: (message, options) => notify({...options, message, tone: "info"}),
    };
}

const defaultQueue = createNotificationQueue();

/**
 * 模块级的缺省通知队列：宿主应用只挂一个 `NotificationViewport` 就能显示各处发出的通知。
 * 要隔离的队列（一个窗口一份、测试、Lab 场景）用 `createNotificationQueue()` 自建，再传给视口的 `queue`。
 */
export function useNotification(): NotificationQueue {
    return defaultQueue;
}
