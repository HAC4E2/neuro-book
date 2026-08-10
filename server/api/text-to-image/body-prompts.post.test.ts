import {afterEach, describe, expect, it, vi} from "vitest";

afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
});

describe("POST /api/text-to-image/body-prompts", () => {
    it("缺少项目与章节路径时拒绝请求，避免绕过后端角色扫描", async () => {
        const requestBody = {
            providerId: 1,
            chapterContent: "正文中出现了角色。",
        };

        vi.doMock("h3", async () => {
            const actual = await vi.importActual<typeof import("h3")>("h3");
            return {
                ...actual,
                defineEventHandler: (handler: unknown) => handler,
                readBody: vi.fn(async () => requestBody),
            };
        });
        vi.doMock("nbook/server/text-to-image/auth", () => ({
            requireTextToImageUser: vi.fn(async () => ({id: 1})),
        }));
        vi.doMock("nbook/server/text-to-image/provider.service", () => ({
            TextToImageProviderService: class {
                async resolveRuntimeProvider() {
                    return {
                        credential: "test",
                        settings: {
                            baseUrl: "https://llm.example.com",
                            model: "test-model",
                        },
                    };
                }
            },
        }));
        vi.doMock("nbook/server/config/config-service", () => ({
            loadEffectiveConfig: vi.fn(async () => ({
                textToImage: {
                    currentWordReplacementProfile: "default",
                    wordReplacementProfiles: {default: {}},
                },
            })),
        }));
        vi.doMock("nbook/server/text-to-image/llm-context", () => ({
            resolveTextToImageRequestProvider: vi.fn(async () => ({
                providerId: 1,
                credential: "test",
                settings: {baseUrl: "https://llm.example.com", model: "test-model"},
            })),
            resolveTextToImageContextEntries: vi.fn(async () => []),
        }));
        vi.doMock("nbook/server/text-to-image/llm-runtime", () => ({
            resolveBoundTextToImageLlmRuntime: vi.fn(async () => ({
                providerId: 1,
                credential: "test",
                settings: {baseUrl: "https://llm.example.com", model: "test-model"},
                contextEntries: [],
            })),
        }));
        vi.doMock("nbook/server/text-to-image/body-session.service", () => ({
            generateBodyPrompts: vi.fn(),
        }));

        const handler = (await import("nbook/server/api/text-to-image/body-prompts.post")).default as (
            event: never
        ) => Promise<unknown>;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 400,
        });
    });

    it("uses the current chapter content and always scans characters on the server", async () => {
        const requestBody = {
            providerId: 1,
            projectRoot: "demo",
            path: "manuscript/chapter-1.md",
            content: "当前编辑器正文",
            chapterContent: "不应优先使用的旧字段",
            characterSummary: "客户端伪造摘要",
            characterIds: ["client-controlled"],
        };
        const scanBodyCharactersFromProject = vi.fn(async () => [{
            characterId: "hero",
            groupId: "default",
            matchedTrigger: "Hero",
            visual: {},
        }]);
        const buildBodyCharacterSummary = vi.fn(() => "服务端扫描摘要");
        const generateBodyPrompts = vi.fn(async () => ({
            blocks: [],
            content: "生成后的正文",
            placeholders: [],
            characterSummary: "服务端扫描摘要",
            matchedCharacters: [{
                characterId: "hero",
                groupId: "default",
                matchedTrigger: "Hero",
                visual: {},
            }],
        }));

        vi.doMock("h3", async () => {
            const actual = await vi.importActual<typeof import("h3")>("h3");
            return {
                ...actual,
                defineEventHandler: (handler: unknown) => handler,
                readBody: vi.fn(async () => requestBody),
            };
        });
        vi.doMock("nbook/server/text-to-image/auth", () => ({
            requireTextToImageUser: vi.fn(async () => ({id: 1})),
        }));
        vi.doMock("nbook/server/text-to-image/provider.service", () => ({
            TextToImageProviderService: class {
                async resolveRuntimeProvider() {
                    return {
                        credential: "test",
                        settings: {
                            baseUrl: "https://llm.example.com",
                            model: "test-model",
                        },
                    };
                }
            },
        }));
        vi.doMock("nbook/server/config/config-service", () => ({
            loadEffectiveConfig: vi.fn(async () => ({
                textToImage: {
                    currentWordReplacementProfile: "default",
                    wordReplacementProfiles: {default: {}},
                },
            })),
        }));
        vi.doMock("nbook/server/text-to-image/llm-context", () => ({
            resolveTextToImageRequestProvider: vi.fn(async () => ({
                providerId: 1,
                credential: "test",
                settings: {baseUrl: "https://llm.example.com", model: "test-model"},
            })),
            resolveTextToImageContextEntries: vi.fn(async () => []),
        }));
        vi.doMock("nbook/server/text-to-image/llm-runtime", () => ({
            resolveBoundTextToImageLlmRuntime: vi.fn(async () => ({
                providerId: 1,
                credential: "test",
                settings: {baseUrl: "https://llm.example.com", model: "test-model"},
                contextEntries: [],
            })),
        }));
        vi.doMock("nbook/server/text-to-image/project-client", () => ({
            resolveTextToImageProjectRoot: vi.fn((value: string) => value),
        }));
        vi.doMock("nbook/server/text-to-image/chapter.service", () => ({
            readChapterMarkdown: vi.fn(async () => {
                throw new Error("磁盘章节不应被读取");
            }),
        }));
        vi.doMock("nbook/server/runtime/paths/file-path", () => ({
            absoluteFsPath: vi.fn((value: string) => value),
        }));
        vi.doMock("nbook/server/text-to-image/body-character-scanner", () => ({
            scanBodyCharactersFromProject,
            buildBodyCharacterSummary,
        }));
        vi.doMock("nbook/server/text-to-image/body-session.service", () => ({
            generateBodyPrompts,
        }));

        const handler = (await import("nbook/server/api/text-to-image/body-prompts.post")).default as (
            event: never
        ) => Promise<{
            content: string;
            matchedCharacters: Array<{characterId: string; groupId: string | null}>;
        }>;
        const result = await handler({} as never);

        expect(scanBodyCharactersFromProject).toHaveBeenCalledWith({
            projectRoot: "workspace/demo",
            chapterContent: "当前编辑器正文",
        });
        expect(generateBodyPrompts).toHaveBeenCalledWith(expect.objectContaining({
            chapterContent: "当前编辑器正文",
            characterMatches: expect.arrayContaining([
                expect.objectContaining({characterId: "hero", groupId: "default"}),
            ]),
            runtime: expect.objectContaining({body: "当前编辑器正文", context: "服务端扫描摘要"}),
        }));
        expect(buildBodyCharacterSummary).toHaveBeenCalledOnce();
        expect(result).toMatchObject({
            content: "生成后的正文",
            matchedCharacters: [{characterId: "hero", groupId: "default"}],
        });
    });
});
