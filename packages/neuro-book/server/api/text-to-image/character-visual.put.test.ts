import {afterEach, describe, expect, it, vi} from "vitest";

afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
});

describe("PUT /api/text-to-image/character-visual", () => {
    it("rejects a browser-supplied groupId because a Project has one character collection", async () => {
        const writeCharacterVisual = vi.fn();
        const body = {
            projectRoot: "demo",
            characterId: "hero",
            groupId: "legacy-group",
            visual: {
                schema: "nbook.character-visual/v1",
                characterId: "hero",
                character: {},
                outfits: [],
                photos: [],
            },
        };

        vi.doMock("h3", async () => {
            const actual = await vi.importActual<typeof import("h3")>("h3");
            return {
                ...actual,
                defineEventHandler: (handler: unknown) => handler,
                readBody: vi.fn(async () => body),
            };
        });
        vi.doMock("nbook/server/text-to-image/auth", () => ({
            requireTextToImageUser: vi.fn(async () => ({id: 1})),
        }));
        vi.doMock("nbook/server/text-to-image/project-client", () => ({
            resolveTextToImageProjectRoot: vi.fn((value: string) => value),
        }));
        vi.doMock("nbook/server/text-to-image/character-visual.service", () => ({
            writeCharacterVisual,
        }));

        const handler = (await import("nbook/server/api/text-to-image/character-visual.put")).default as (
            event: never
        ) => Promise<unknown>;

        await expect(handler({} as never)).rejects.toMatchObject({statusCode: 400});
        expect(writeCharacterVisual).not.toHaveBeenCalled();
    });
});
