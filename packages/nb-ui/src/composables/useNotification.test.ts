/**
 * 通知队列（`createNotificationQueue`）：自建队列互不干扰；进度与文字可更新；时长改变后重新计时；常驻不自动消失。
 * 计时用真实的短时长，等可观察的状态，不用假计时器。
 */

import {describe, expect, it, vi} from "vitest";

import {createNotificationQueue, useNotification} from "./useNotification";

const ids = (queue: ReturnType<typeof createNotificationQueue>): string[] => queue.notifications.value.map((item) => item.id);

describe("createNotificationQueue", () => {
    it("自建的队列与缺省队列互不干扰；缺省队列每次拿到同一份", () => {
        const own = createNotificationQueue();
        const shared = useNotification();
        const id = own.info("只在这份队列里");
        expect(ids(own)).toEqual([id]);
        expect(shared.notifications.value.some((item) => item.id === id)).toBe(false);
        expect(useNotification()).toBe(shared);
        own.clearAll();
    });

    it("update 改进度与文字；不存在的 id 忽略；不给 duration 时仍是常驻", () => {
        const queue = createNotificationQueue();
        const id = queue.notify({message: "正在统计", progress: null, duration: 0});
        queue.update(id, {progress: 40, message: "已统计 2 部"});
        expect(queue.notifications.value[0]).toMatchObject({id, progress: 40, message: "已统计 2 部", duration: 0});
        queue.update("nope", {progress: 100});
        expect(ids(queue)).toEqual([id]);
        queue.clearAll();
    });

    it("常驻通知改成限时后自动消失；限时通知改成常驻后留下", async () => {
        const queue = createNotificationQueue();
        const sticky = queue.notify({message: "任务进行中", duration: 0});
        // 它原来的时长比下面那条改出来的短：等那条消失时它早该到期了，还在就说明改成常驻真的取消了计时。
        const timed = queue.notify({message: "即将出错", duration: 20});
        queue.update(timed, {tone: "error", duration: 0});
        queue.update(sticky, {message: "任务完成", tone: "success", duration: 40});
        await vi.waitFor(() => {
            expect(ids(queue)).toEqual([timed]);
        });
        queue.clearAll();
    });

    it("色调决定缺省时长；error 与 warning 比 info 长", () => {
        const queue = createNotificationQueue();
        queue.info("一");
        queue.warning("二");
        queue.error("三");
        const [info, warning, error] = queue.notifications.value.map((item) => item.duration);
        expect(info).toBeLessThan(warning as number);
        expect(warning).toBeLessThan(error as number);
        queue.clearAll();
    });
});
