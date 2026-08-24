import {afterEach, describe, expect, it, vi} from "vitest";

afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
});

describe("POST /api/text-to-image/character-visual.generate", () => {
    it("accepts a Unicode characterId and only returns a draft without writing the library", async () => {
        const body = {
            projectRoot: "demo",
            groupId: "default",
            characterId: "艾璃丝·赛瑞利亚",
            characterPage: "# 艾璃丝·赛瑞利亚",
            mode: "fill_empty",
            userRequirement: "保留银发",
        };
        const readWithInfo = vi.fn(async () => null);
        const write = vi.fn();
        const draft = {
            schema: "nbook.character-visual/v1" as const,
            characterId: body.characterId,
            character: {cnName: body.characterId, facialAppearance: "silver hair"},
            outfits: [],
            photos: [],
        };
        const generateCharacterVisualDraft = vi.fn(async () => draft);

        vi.doMock("h3", async () => {
            const actual = await vi.importActual<typeof import("h3")>("h3");
            return {...actual, defineEventHandler: (handler: unknown) => handler};
        });
        vi.doMock("nbook/server/text-to-image/auth", () => ({
            requireTextToImageUser: vi.fn(async () => ({id: 1})),
        }));
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => body),
        }));
        vi.doMock("nbook/server/text-to-image/project-client", () => ({
            resolveTextToImageProjectRoot: vi.fn((value: string) => value),
        }));
        vi.doMock("nbook/server/text-to-image/llm-runtime", () => ({
            resolveBoundTextToImageLlmRuntime: vi.fn(async () => ({
                providerId: 1,
                credential: "secret",
                settings: {baseUrl: "https://llm.example.com", model: "design"},
                contextEntries: [],
            })),
        }));
        vi.doMock("nbook/server/text-to-image/character-visual-library.service", () => ({
            CharacterVisualLibraryService: class {
                readWithInfo = readWithInfo;
                write = write;
            },
        }));
        vi.doMock("nbook/server/text-to-image/character-visual-llm", () => ({generateCharacterVisualDraft}));

        const handler = (await import("nbook/server/api/text-to-image/character-visual.generate.post")).default as (
            event: never
        ) => Promise<unknown>;
        const result = await handler({} as never) as {visual: typeof draft; current: null};

        expect(result.visual).toEqual(draft);
        expect(result.current).toBeNull();
        expect(generateCharacterVisualDraft).toHaveBeenCalledWith(expect.objectContaining({
            characterId: body.characterId,
            userRequirement: body.userRequirement,
        }));
        expect(readWithInfo).toHaveBeenCalledWith("demo", expect.objectContaining({characterId: body.characterId}));
        expect(write).not.toHaveBeenCalled();
    });
});
