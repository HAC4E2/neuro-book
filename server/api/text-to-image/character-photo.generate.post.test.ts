import {afterEach, describe, expect, it, vi} from "vitest";

afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
});

describe("POST /api/text-to-image/character-photo.generate", () => {
    it("uses the char_display binding before submitting the NovelAI photo job", async () => {
        const requestBody = {
            projectRoot: "demo",
            characterId: "hero",
            characterText: "林砚舟的角色资料",
            outfitText: "黑色长风衣",
            userRequirement: "半身正面展示",
        };
        const resolveBoundTextToImageLlmRuntime = vi.fn(async () => ({
            providerId: 10,
            credential: "llm-secret",
            settings: {baseUrl: "https://llm.example.com", model: "display-model"},
            contextEntries: [],
        }));
        const generateCharacterAvatar = vi.fn(async () => ({
            prompt: "1girl, upper body, black coat",
            photo: null,
        }));

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
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => requestBody),
        }));
        vi.doMock("nbook/server/text-to-image/llm-context", () => ({
            resolveTextToImageRequestProvider: vi.fn(async () => ({
                providerId: 99,
                credential: "wrong-route",
                settings: {baseUrl: "https://wrong.example.com", model: "wrong-model"},
            })),
        }));
        vi.doMock("nbook/server/text-to-image/llm-runtime", () => ({
            resolveBoundTextToImageLlmRuntime,
        }));
        vi.doMock("nbook/server/text-to-image/character-photo.service", () => ({
            generateCharacterAvatar,
        }));

        const handler = (await import("nbook/server/api/text-to-image/character-photo.generate.post")).default as (
            event: never
        ) => Promise<unknown>;
        await handler({} as never);

        expect(resolveBoundTextToImageLlmRuntime).toHaveBeenCalledWith(1, "char_display");
        expect(generateCharacterAvatar).toHaveBeenCalledWith(expect.objectContaining({
            userId: 1,
            llmRuntime: expect.objectContaining({
                credential: "llm-secret",
                settings: {baseUrl: "https://llm.example.com", model: "display-model"},
            }),
        }));
        expect(generateCharacterAvatar.mock.calls[0]?.[0]).not.toHaveProperty("novelAiProviderId");
        expect(generateCharacterAvatar.mock.calls[0]?.[0]).not.toHaveProperty("llmProviderId");
    });
});
