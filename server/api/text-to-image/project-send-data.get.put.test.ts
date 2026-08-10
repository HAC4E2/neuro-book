import {afterEach, describe, expect, it, vi} from "vitest";

afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    delete (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler;
});

describe("Project text-to-image send data routes", () => {
    it("GET returns the saved selection and server-owned options", async () => {
        const readProjectSendData = vi.fn(async () => ({
            lorebookPaths: ["lorebook/world/setting/index.md"],
            characterIds: ["alice"],
            outfitSelections: [{characterId: "alice", name: "School Uniform"}],
        }));
        const listProjectSendDataOptions = vi.fn(async () => ({
            lorebookEntries: [{path: "lorebook/world/setting/index.md", title: "Setting"}],
            characters: [{characterId: "alice", cnName: "爱丽丝", enName: "Alice", outfits: []}],
        }));
        const handler = await loadGetHandler(
            {projectRoot: "demo"},
            {readProjectSendData, listProjectSendDataOptions},
        );

        await expect(handler({} as never)).resolves.toEqual({
            sendData: expect.objectContaining({characterIds: ["alice"]}),
            lorebookEntries: expect.arrayContaining([
                expect.objectContaining({path: "lorebook/world/setting/index.md"}),
            ]),
            characters: expect.arrayContaining([
                expect.objectContaining({characterId: "alice"}),
            ]),
        });
        expect(readProjectSendData).toHaveBeenCalledWith("workspace/demo");
        expect(listProjectSendDataOptions).toHaveBeenCalledWith("workspace/demo");
    });

    it("PUT persists only the current Project selection", async () => {
        const writeProjectSendData = vi.fn(async (_root: string, value: unknown) => value);
        const body = {
            projectRoot: "demo",
            sendData: {
                lorebookPaths: ["lorebook/world/setting/index.md"],
                characterIds: ["alice"],
                outfitSelections: [{characterId: "alice", name: "School Uniform"}],
            },
        };
        const handler = await loadPutHandler(body, writeProjectSendData);

        await expect(handler({} as never)).resolves.toEqual({sendData: body.sendData});
        expect(writeProjectSendData).toHaveBeenCalledWith("workspace/demo", body.sendData);
    });
});

async function loadGetHandler(
    query: {projectRoot: string},
    service: Record<string, unknown>,
): Promise<(event: never) => Promise<unknown>> {
    vi.doMock("h3", async () => {
        const actual = await vi.importActual<typeof import("h3")>("h3");
        return {
            ...actual,
            defineEventHandler: (handler: unknown) => handler,
            getQuery: vi.fn(() => query),
        };
    });
    vi.doMock("nbook/server/text-to-image/auth", () => ({
        requireTextToImageUser: vi.fn(async () => ({id: 1})),
    }));
    vi.doMock("nbook/server/text-to-image/project-client", () => ({
        resolveTextToImageProjectRoot: (value: string) => `workspace/${value}`,
    }));
    vi.doMock("nbook/server/text-to-image/project-send-data.service", () => service);
    (globalThis as typeof globalThis & {defineEventHandler?: (handler: unknown) => unknown}).defineEventHandler = (handler) => handler;
    return (await import("nbook/server/api/text-to-image/project-send-data.get")).default as never;
}

async function loadPutHandler(
    body: unknown,
    writeProjectSendData: ReturnType<typeof vi.fn>,
): Promise<(event: never) => Promise<unknown>> {
    vi.doMock("h3", async () => {
        const actual = await vi.importActual<typeof import("h3")>("h3");
        return {
            ...actual,
            defineEventHandler: (handler: unknown) => handler,
        };
    });
    vi.doMock("nbook/server/text-to-image/auth", () => ({
        requireTextToImageUser: vi.fn(async () => ({id: 1})),
    }));
    vi.doMock("nbook/server/text-to-image/project-client", () => ({
        resolveTextToImageProjectRoot: (value: string) => `workspace/${value}`,
    }));
    vi.doMock("nbook/server/utils/novel-chapter", () => ({
        validateBody: vi.fn(async () => body),
    }));
    vi.doMock("nbook/server/text-to-image/project-send-data.service", () => ({
        writeProjectSendData,
    }));
    (globalThis as typeof globalThis & {defineEventHandler?: (handler: unknown) => unknown}).defineEventHandler = (handler) => handler;
    return (await import("nbook/server/api/text-to-image/project-send-data.put")).default as never;
}
