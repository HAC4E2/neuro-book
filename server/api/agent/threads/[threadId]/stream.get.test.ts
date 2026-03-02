import {beforeEach, describe, expect, it, vi} from "vitest";

/**
 * 等待后台异步流转完成。
 */
async function flushAsyncTasks(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("GET /api/agent/threads/[threadId]/stream", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it("会先推送 thread_snapshot，再转发后续非 snapshot 事件", async () => {
        const pushedEvents: unknown[] = [];
        const eventStream = {
            push: vi.fn(async (event) => {
                pushedEvents.push(event);
            }),
            send: vi.fn(async () => "sent"),
            close: vi.fn(async () => {}),
            onClosed: vi.fn(),
        };
        const agentSystem = {
            syncClientVariables: vi.fn(async () => {}),
            subscribeThreadStream: vi.fn(() => (async function* () {
                yield {type: "thread_snapshot", ignored: true};
                yield {type: "run_state", threadId: "thread-1", status: "completed"};
            })()),
            getThreadSnapshotProjection: vi.fn(async () => ({
                thread: {id: "thread-1"},
                subagents: [],
                leaders: [],
                messages: [],
                activeRun: null,
            })),
        };

        vi.doMock("h3", () => ({
            createEventStream: vi.fn(() => eventStream),
            createError: ({statusCode, message}: {statusCode?: number; message?: string}) => {
                const error = new Error(message ?? "error") as Error & {statusCode?: number};
                error.statusCode = statusCode;
                return error;
            },
        }));
        vi.doMock("nbook/server/agent/api", () => ({
            requireThreadId: vi.fn(() => "thread-1"),
            readClientVariablesHeader: vi.fn(() => null),
            pushAgentEvent: vi.fn(async (_stream, payload) => {
                pushedEvents.push(payload);
            }),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentSystem: () => agentSystem,
            toAgentThreadSnapshotEventDto: vi.fn((snapshot) => ({
                type: "thread_snapshot",
                ...snapshot,
            })),
            toAgentStreamEventDto: vi.fn((event) => event),
        }));

        const handler = (await import("nbook/server/api/agent/threads/[threadId]/stream.get")).default;
        await expect(handler({} as never)).resolves.toBe("sent");
        await flushAsyncTasks();

        expect(pushedEvents).toEqual([
            expect.objectContaining({type: "thread_snapshot"}),
            expect.objectContaining({type: "run_state", status: "completed"}),
        ]);
    });

    it("后台流失败且未关闭时会补发 failed run_state", async () => {
        const pushedEvents: unknown[] = [];
        const eventStream = {
            push: vi.fn(async (event) => {
                pushedEvents.push(event);
            }),
            send: vi.fn(async () => "sent"),
            close: vi.fn(async () => {}),
            onClosed: vi.fn(),
        };
        const agentSystem = {
            syncClientVariables: vi.fn(async () => {}),
            subscribeThreadStream: vi.fn(() => (async function* () {
                throw new Error("stream boom");
            })()),
            getThreadSnapshotProjection: vi.fn(async () => ({
                thread: {id: "thread-1"},
                subagents: [],
                leaders: [],
                messages: [],
                activeRun: null,
            })),
        };

        vi.doMock("h3", () => ({
            createEventStream: vi.fn(() => eventStream),
            createError: ({statusCode, message}: {statusCode?: number; message?: string}) => {
                const error = new Error(message ?? "error") as Error & {statusCode?: number};
                error.statusCode = statusCode;
                return error;
            },
        }));
        vi.doMock("nbook/server/agent/api", () => ({
            requireThreadId: vi.fn(() => "thread-1"),
            readClientVariablesHeader: vi.fn(() => null),
            pushAgentEvent: vi.fn(async (_stream, payload) => {
                pushedEvents.push(payload);
            }),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentSystem: () => agentSystem,
            toAgentThreadSnapshotEventDto: vi.fn((snapshot) => ({
                type: "thread_snapshot",
                ...snapshot,
            })),
            toAgentStreamEventDto: vi.fn((event) => event),
        }));

        const handler = (await import("nbook/server/api/agent/threads/[threadId]/stream.get")).default;
        await handler({} as never);
        await flushAsyncTasks();

        expect(pushedEvents.at(-1)).toMatchObject({
            type: "run_state",
            threadId: "thread-1",
            status: "failed",
            error: "stream boom",
        });
    });
});
