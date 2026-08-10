import {afterEach, describe, expect, it, vi} from "vitest";

afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
});

describe("GET /api/text-to-image/character-visual", () => {
    it("rejects a browser-supplied groupId", async () => {
        vi.doMock("h3", async () => {
            const actual = await vi.importActual<typeof import("h3")>("h3");
            return {
                ...actual,
                defineEventHandler: (handler: unknown) => handler,
                getQuery: vi.fn(() => ({projectRoot: "demo", characterId: "hero", groupId: "legacy-group"})),
            };
        });
        vi.doMock("nbook/server/text-to-image/auth", () => ({
            requireTextToImageUser: vi.fn(async () => ({id: 1})),
        }));
        vi.doMock("nbook/server/text-to-image/project-client", () => ({
            resolveTextToImageProjectRoot: vi.fn((value: string) => value),
        }));
        const readCharacterVisual = vi.fn();
        vi.doMock("nbook/server/text-to-image/character-visual.service", () => ({
            readCharacterVisual,
        }));

        const handler = (await import("nbook/server/api/text-to-image/character-visual.get")).default as (
            event: never
        ) => Promise<unknown>;

        await expect(handler({} as never)).rejects.toMatchObject({statusCode: 400});
        expect(readCharacterVisual).not.toHaveBeenCalled();
    });
});
