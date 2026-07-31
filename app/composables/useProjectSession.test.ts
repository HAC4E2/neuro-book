import {afterEach, describe, expect, it, vi} from "vitest";
import {
    createProjectSessionController,
    isProjectSessionSupersededError,
    type ProjectPresenceEventDto,
    type ProjectSessionNotificationAdapter,
    type ProjectSessionTransport,
} from "nbook/app/composables/useProjectSession";

describe("Project Session Controller", () => {
    afterEach(() => vi.useRealTimers());

    it("open 必须等到 presence_ready 才发布 ready", async () => {
        const transport = controlledTransport();
        const controller = createProjectSessionController(transport, notifications());

        const opening = controller.open("project-a");
        await flushPromises();
        expect(controller.state.value).toEqual({status: "opening", projectRoot: "project-a", ready: null});

        transport.ready("project-a");
        await expect(opening).resolves.toEqual({projectRoot: "project-a", revision: 1});
        expect(controller.state.value).toEqual({status: "ready", ready: {projectRoot: "project-a", revision: 1}});
        await controller.release();
    });

    it("同 root opening 复用一个 Promise 与一次 open", async () => {
        const transport = controlledTransport();
        const controller = createProjectSessionController(transport, notifications());

        const first = controller.open("project-a");
        const second = controller.open("project-a");
        expect(second).toBe(first);
        await flushPromises();
        transport.ready("project-a");

        await expect(first).resolves.toEqual({projectRoot: "project-a", revision: 1});
        expect(transport.open).toHaveBeenCalledOnce();
        await controller.release();
    });

    it("A 到 B 到 C 只允许最新目标发布 ready，旧 owner 只被取消", async () => {
        const transport = controlledTransport();
        const controller = createProjectSessionController(transport, notifications());

        const first = controller.open("project-a");
        await flushPromises();
        const second = controller.open("project-b");
        await flushPromises();
        const third = controller.open("project-c");
        await flushPromises();
        transport.ready("project-c");

        await expect(first).rejects.toSatisfy(isProjectSessionSupersededError);
        await expect(second).rejects.toSatisfy(isProjectSessionSupersededError);
        await expect(third).resolves.toEqual({projectRoot: "project-c", revision: 1});
        expect(controller.state.value).toEqual({status: "ready", ready: {projectRoot: "project-c", revision: 1}});
        expect(transport.aborted).toEqual(expect.arrayContaining(["project-a", "project-b"]));
        await controller.release();
    });

    it("release 中止 opening 并等待本标签页 presence 退出", async () => {
        const transport = controlledTransport();
        const controller = createProjectSessionController(transport, notifications());

        const opening = controller.open("project-a");
        await flushPromises();
        await controller.release();

        await expect(opening).rejects.toSatisfy(isProjectSessionSupersededError);
        expect(controller.state.value).toEqual({status: "idle", ready: null});
        expect(transport.aborted).toContain("project-a");
    });

    it("初次 open 失败进入 failed，不发布任何 ready Project", async () => {
        const transport = controlledTransport();
        vi.mocked(transport.open).mockRejectedValueOnce(new Error("open failed"));
        const notification = notifications();
        const controller = createProjectSessionController(transport, notification);

        await expect(controller.open("project-a")).rejects.toThrow("open failed");
        expect(controller.state.value).toEqual({status: "failed", projectRoot: "project-a", ready: null});
        expect(notification.openFailed).toHaveBeenCalledOnce();
    });

    it("presence 断开立即撤销 ready；重连必须再次 open + presence_ready 并递增 revision", async () => {
        vi.useFakeTimers();
        const transport = controlledTransport();
        const controller = createProjectSessionController(transport, notifications());

        const first = controller.open("project-a");
        await flushPromises();
        transport.ready("project-a");
        await first;
        transport.end("project-a");
        await flushPromises();
        expect(controller.state.value).toEqual({status: "reconnecting", projectRoot: "project-a", ready: null});

        await vi.advanceTimersByTimeAsync(300);
        await flushPromises();
        expect(transport.open).toHaveBeenCalledTimes(2);
        transport.ready("project-a");
        await flushPromises();
        expect(controller.state.value).toEqual({status: "ready", ready: {projectRoot: "project-a", revision: 2}});
        await controller.release();
    });

    it("reconnect 打开失败后保持 reconnecting，并按 backoff 继续下一次 open", async () => {
        vi.useFakeTimers();
        const transport = controlledTransport();
        const controller = createProjectSessionController(transport, notifications());

        const first = controller.open("project-a");
        await flushPromises();
        transport.ready("project-a");
        await first;
        transport.end("project-a");
        await flushPromises();

        vi.mocked(transport.open).mockRejectedValueOnce(new Error("restart in progress"));
        await vi.advanceTimersByTimeAsync(300);
        await flushPromises();
        expect(controller.state.value).toEqual({status: "reconnecting", projectRoot: "project-a", ready: null});
        expect(transport.open).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(800);
        await flushPromises();
        expect(transport.open).toHaveBeenCalledTimes(3);
        transport.ready("project-a");
        await flushPromises();
        expect(controller.state.value).toEqual({status: "ready", ready: {projectRoot: "project-a", revision: 2}});
        await controller.release();
    });

    it("release 或新目标会取消已安排的 reconnect", async () => {
        vi.useFakeTimers();
        const transport = controlledTransport();
        const controller = createProjectSessionController(transport, notifications());

        const first = controller.open("project-a");
        await flushPromises();
        transport.ready("project-a");
        await first;
        transport.end("project-a");
        await flushPromises();

        const next = controller.open("project-b");
        await flushPromises();
        transport.ready("project-b");
        await next;
        await vi.advanceTimersByTimeAsync(5000);
        expect(transport.open).toHaveBeenCalledTimes(2);

        await controller.release();
        await vi.advanceTimersByTimeAsync(5000);
        expect(transport.open).toHaveBeenCalledTimes(2);
    });
});

/** 逐帧控制 transport，使测试覆盖真实 open/Abort/presence 时序。 */
function controlledTransport() {
    type Stream = {
        onEvent: (event: ProjectPresenceEventDto) => void;
        resolve: () => void;
        reject: (error: unknown) => void;
    };
    const streams = new Map<string, Stream>();
    const aborted: string[] = [];
    const transport: ProjectSessionTransport & {
        readonly aborted: string[];
        ready(projectRoot: string): void;
        end(projectRoot: string): void;
    } = {
        open: vi.fn(async () => undefined),
        stream: vi.fn(async (projectRoot, signal, onEvent) => await new Promise<void>((resolve, reject) => {
            streams.set(projectRoot, {onEvent, resolve, reject});
            signal.addEventListener("abort", () => {
                aborted.push(projectRoot);
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
            }, {once: true});
        })),
        aborted,
        ready(projectRoot) {
            streams.get(projectRoot)?.onEvent({type: "presence_ready", projectRoot});
        },
        end(projectRoot) {
            streams.get(projectRoot)?.resolve();
            streams.delete(projectRoot);
        },
    };
    return transport;
}

function notifications() {
    return {
        interrupted: vi.fn<() => void>(),
        openFailed: vi.fn<(projectRoot: string, error: unknown) => void>(),
    } satisfies ProjectSessionNotificationAdapter;
}

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}
