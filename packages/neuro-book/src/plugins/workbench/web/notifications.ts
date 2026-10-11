/**
 * 工作台的通知服务（docs/specs/workbench/notifications.md）：本窗口一份 nb-ui 通知队列，`notificationsKey` 的提供项包着它，
 * 页面根上的 `NotificationViewport` 显示它。常驻规则在这里定：error 与带动作的通知不自动消失，调用方不用自己算时长。
 */

// 队列从不带 DOM 的子路径取：本文件与插件入口一起在无 DOM 的编译组里，composables 的总出口会把用到 window 的别的 composable 一起拉进来。
import {createNotificationQueue, DEFAULT_NOTIFICATION_DURATION} from "@notnotype/nb-ui/notifications";
import type {NotificationQueue} from "@notnotype/nb-ui/notifications";

import type {NotificationHandle, NotificationInput, Notifications} from "../shared/contracts";

export interface WindowNotifications extends Notifications {
    /** 交给视口显示的队列。 */
    readonly queue: NotificationQueue;
    /** 入口停止时清空：计时器随之清掉。 */
    dispose(): void;
}

function durationOf(input: Pick<NotificationInput, "tone" | "action" | "sticky">): number {
    const tone = input.tone ?? "info";
    const sticky = input.sticky ?? (tone === "error" || input.action !== undefined);
    return sticky ? 0 : DEFAULT_NOTIFICATION_DURATION[tone];
}

export function createNotifications(): WindowNotifications {
    const queue = createNotificationQueue();
    return {
        queue,
        notify: (input) => {
            const id = queue.notify({
                message: input.message,
                tone: input.tone ?? "info",
                duration: durationOf(input),
                ...(input.title === undefined ? {} : {title: input.title}),
                ...(input.action === undefined ? {} : {action: input.action}),
                ...(input.progress === undefined ? {} : {progress: input.progress}),
            });
            const handle: NotificationHandle = {
                id,
                update: (patch) => {
                    const current = queue.notifications.value.find((item) => item.id === id);
                    if (current === undefined) return;
                    // 常驻与否随色调和动作一起重算：进度条的任务结束后改成 success 就会按时消失。
                    const merged = {tone: patch.tone ?? current.tone, action: patch.action ?? current.action, sticky: patch.sticky};
                    const rescheduling = patch.sticky !== undefined || patch.tone !== undefined || patch.action !== undefined;
                    queue.update(id, {
                        ...(patch.title === undefined ? {} : {title: patch.title}),
                        ...(patch.message === undefined ? {} : {message: patch.message}),
                        ...(patch.tone === undefined ? {} : {tone: patch.tone}),
                        ...(patch.action === undefined ? {} : {action: patch.action}),
                        ...(patch.progress === undefined ? {} : {progress: patch.progress}),
                        ...(rescheduling ? {duration: durationOf(merged)} : {}),
                    });
                },
                dismiss: () => queue.remove(id),
            };
            return handle;
        },
        dispose: () => queue.clearAll(),
    };
}
