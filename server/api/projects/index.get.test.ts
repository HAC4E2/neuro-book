import type {H3Event} from "h3";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {flushServerTiming} from "nbook/server/utils/server-timing";
import type {NovelListDiagnostics} from "nbook/server/utils/novel-chapter";

const originalDefineEventHandler = (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler;
const listNovelsMock = vi.fn();
const warnMock = vi.fn();

vi.mock("nbook/server/utils/novel-chapter", () => ({
    listNovels: listNovelsMock,
}));

// 共享测试 setup 的 afterAll 会调用 appLogger.flush()，mock 必须补齐该方法，否则整个 suite 在收尾阶段失败。
vi.mock("nbook/server/app-logs/logger", () => ({
    appLogger: {
        warn: warnMock,
        flush: vi.fn(async () => undefined),
    },
}));

describe("GET /api/projects", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler = originalDefineEventHandler;
        vi.restoreAllMocks();
    });

    it("只把 Server-Timing sink 与 diagnostics 传给列表服务，不再转发裁剪参数", async () => {
        listNovelsMock.mockImplementation(async (options: {
            timingSink?: {mark(name: string, durationMs: number): void};
            diagnostics?: NovelListDiagnostics;
        }) => {
            options.timingSink?.mark("projects.manifests", 1.2);
            options.timingSink?.mark("projects.total", 3.4);
            if (options.diagnostics) {
                options.diagnostics.projectCount = 2;
            }
            return [{id: "workspace/a"}];
        });
        const handler = (await import("nbook/server/api/projects/index.get")).default as (event: H3Event) => Promise<unknown>;
        const {event, headers} = createProjectsEvent();

        const result = await handler(event);
        flushServerTiming(event, {headers: {}});

        expect(result).toEqual([{id: "workspace/a"}]);
        expect(listNovelsMock).toHaveBeenCalledWith({
            timingSink: expect.objectContaining({mark: expect.any(Function)}),
            diagnostics: expect.any(Object),
        });
        expect(headers["server-timing"]).toContain("projects.manifests;dur=1.2");
        expect(headers["server-timing"]).toContain("projects.total;dur=3.4");
        expect(warnMock).not.toHaveBeenCalled();
    });

    it("慢请求 warn 只包含 Project 数量与 manifest 缓存状态", async () => {
        vi.spyOn(performance, "now")
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(750);
        listNovelsMock.mockImplementation(async (options: {diagnostics?: NovelListDiagnostics}) => {
            if (options.diagnostics) {
                Object.assign(options.diagnostics, {
                    projectListCache: "hit",
                    projectCount: 12,
                } satisfies NovelListDiagnostics);
            }
            return [{id: "workspace/a"}];
        });
        const handler = (await import("nbook/server/api/projects/index.get")).default as (event: H3Event) => Promise<unknown>;
        const {event} = createProjectsEvent();

        await handler(event);

        expect(warnMock).toHaveBeenCalledWith("projects.list.slow", {
            durationMs: 750,
            projectCount: 12,
            cache: {projectList: "hit"},
        }, "Project 列表请求过慢");
    });
});

function createProjectsEvent(): {event: H3Event; headers: Record<string, string>} {
    const headers: Record<string, string> = {};
    const event = {
        context: {},
        node: {
            res: {
                getHeader: (name: string) => headers[name.toLowerCase()],
                setHeader: (name: string, value: string) => {
                    headers[name.toLowerCase()] = value;
                },
                getHeaders: () => headers,
            },
        },
    } as unknown as H3Event;
    return {event, headers};
}
