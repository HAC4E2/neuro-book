import {afterEach, describe, expect, it, vi} from "vitest";

afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
});

describe("POST /api/text-to-image/prompt-placeholders/:id/generate", () => {
    it("maps semantic reference errors before creating a queue job", async () => {
        const enqueue = vi.fn();
        const compileError = class extends Error {
            readonly code = "reference_missing" as const;
            readonly statusCode = 409;
        };
        const requestBody = {
            projectRoot: "demo",
            path: "manuscript/chapter-1.md",
            providerId: 1,
            content: "正文\n<text-to-image-prompt id=\"tti-1\">\n{}\n</text-to-image-prompt>",
        };

        vi.doMock("h3", () => ({
            createError: (input: {statusCode?: number; message?: string; data?: unknown}) => Object.assign(new Error(input.message), input),
            defineEventHandler: (handler: unknown) => handler,
            getRouterParam: vi.fn(() => "tti-1"),
        }));
        vi.doMock("nbook/server/text-to-image/auth", () => ({
            requireTextToImageUser: vi.fn(async () => ({id: 1})),
        }));
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => requestBody),
        }));
        vi.doMock("nbook/server/text-to-image/project-client", () => ({
            resolveTextToImageProjectRoot: vi.fn((value: string) => value),
        }));
        vi.doMock("nbook/server/runtime/paths/file-path", () => ({
            absoluteFsPath: vi.fn((value: string) => value),
        }));
        vi.doMock("nbook/shared/text-to-image-markdown", () => ({
            findTextToImagePromptMarkdown: vi.fn(() => ({
                raw: "placeholder",
                payload: {
                    id: "tti-1",
                    schema: "nbook.text-to-image-prompt/v1",
                    prompt: `${"$"}{"name":"missing outfit","upperBody":"visible","lowerBody":"visible"}$`,
                    negativePrompt: "",
                    anchor: "正文",
                    title: "标题",
                    size: "",
                    tagThink: "",
                },
            })),
        }));
        vi.doMock("nbook/server/text-to-image/chapter.service", () => ({
            readChapterMarkdown: vi.fn(),
            replacePromptPlaceholderWithAsset: vi.fn(),
        }));
        vi.doMock("nbook/server/text-to-image/body-prompt-compiler", () => ({
            BodyPromptCompileError: compileError,
            compileBodyPrompt: vi.fn(async () => {
                throw new compileError("未找到独立服装“missing outfit”");
            }),
        }));
        vi.doMock("nbook/server/text-to-image/character-visual.codec", () => ({
            CharacterVisualFileSchema: {parse: vi.fn((value: unknown) => value)},
        }));
        vi.doMock("nbook/server/text-to-image/provider.service", () => ({
            TextToImageProviderService: class {},
        }));
        vi.doMock("nbook/server/text-to-image/queue.service", () => ({
            TextToImageQueueService: class {
                enqueue = enqueue;
                async list() { return []; }
            },
        }));
        vi.doMock("nbook/server/text-to-image/queue.processor", () => ({processTextToImageJobs: vi.fn()}));
        vi.doMock("nbook/server/text-to-image/queue-runtime", () => ({kickTextToImageQueue: vi.fn()}));
        vi.doMock("nbook/server/text-to-image/novelai-image-generation", () => ({requestNovelAiImages: vi.fn()}));
        vi.doMock("nbook/server/text-to-image/asset.service", () => ({
            findLatestTextToImageAssetBySourceAnchorId: vi.fn(),
            saveTextToImageAsset: vi.fn(),
        }));
        vi.doMock("nbook/server/text-to-image/reference-image.service", () => ({
            readTextToImageReferenceImageBytes: vi.fn(),
        }));

        const handler = (await import("nbook/server/api/text-to-image/prompt-placeholders/[id]/generate.post")).default as (
            event: never
        ) => Promise<unknown>;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {code: "reference_missing"},
            message: "未找到独立服装“missing outfit”",
        });
        expect(enqueue).not.toHaveBeenCalled();
    });

    it("只入队并返回 202，NovelAI 与正文写回交给共享消费者", async () => {
        const requestBody = {
            projectRoot: "demo",
            path: "manuscript/chapter-1.md",
            providerId: 1,
        };
        const setResponseStatus = vi.fn();
        const kick = vi.fn(async () => 1);
        const queuedJob = {
            id: "job-1",
            kind: "body",
            status: "queued",
            sourcePath: requestBody.path,
            sourceAnchorId: "tti-1",
            createdAt: "2026-08-18T00:00:00.000Z",
        };
        const list = vi.fn(async (_projectPath: string, status?: string) => status === "queued" ? [queuedJob] : []);
        const enqueue = vi.fn(async () => queuedJob);

        vi.doMock("h3", () => ({
            createError: (input: {statusCode?: number; message?: string; data?: unknown}) => Object.assign(new Error(input.message), input),
            defineEventHandler: (handler: unknown) => handler,
            getRouterParam: vi.fn(() => "tti-1"),
            setResponseStatus,
        }));
        vi.doMock("nbook/server/text-to-image/auth", () => ({
            requireTextToImageUser: vi.fn(async () => ({id: 1})),
        }));
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => requestBody),
        }));
        vi.doMock("nbook/server/text-to-image/project-client", () => ({
            resolveTextToImageProjectRoot: vi.fn((value: string) => value),
        }));
        vi.doMock("nbook/server/runtime/paths/file-path", () => ({
            absoluteFsPath: vi.fn((value: string) => value),
        }));
        vi.doMock("nbook/server/text-to-image/chapter.service", () => ({
            readChapterMarkdown: vi.fn(async () => "正文\n<text-to-image-prompt id=\"tti-1\">\n{}\n</text-to-image-prompt>"),
        }));
        vi.doMock("nbook/shared/text-to-image-markdown", () => ({
            findTextToImagePromptMarkdown: vi.fn(() => ({
                raw: "placeholder",
                payload: {
                    id: "tti-1",
                    schema: "nbook.text-to-image-prompt/v1",
                    prompt: "1girl",
                    negativePrompt: "",
                    anchor: "正文",
                    title: "标题",
                    size: "832x1216",
                    tagThink: "",
                },
            })),
        }));
        vi.doMock("nbook/server/text-to-image/body-prompt-compiler", () => ({
            BodyPromptCompileError: class extends Error {},
            compileBodyPrompt: vi.fn(async () => ({prompt: "1girl", negativePrompt: ""})),
        }));
        vi.doMock("nbook/server/text-to-image/character-visual.codec", () => ({
            CharacterVisualFileSchema: {parse: vi.fn((value: unknown) => value)},
        }));
        vi.doMock("nbook/server/text-to-image/provider.service", () => ({
            TextToImageProviderService: class {
                async list() {
                    return [{id: 1, kind: "novelai", credentialRevision: 3, settings: {}}];
                }
            },
        }));
        vi.doMock("nbook/server/text-to-image/queue.service", () => ({
            TextToImageQueueService: class {
                list = list;
                enqueue = enqueue;
            },
        }));
        vi.doMock("nbook/server/text-to-image/queue-runtime", () => ({kickTextToImageQueue: kick}));
        vi.doMock("nbook/server/text-to-image/asset.service", () => ({
            listTextToImageAssetsBySourceAnchorId: vi.fn(async () => []),
        }));

        const handler = (await import("nbook/server/api/text-to-image/prompt-placeholders/[id]/generate.post")).default as (
            event: never
        ) => Promise<{status: string; jobId: string; queuePosition: number | null}>;
        const result = await handler({} as never);
        await Promise.resolve();

        expect(result).toMatchObject({status: "queued", jobId: "job-1", queuePosition: 1});
        expect(setResponseStatus).toHaveBeenCalledWith({}, 202);
        expect(kick).toHaveBeenCalledWith("workspace/demo");
        expect(enqueue).toHaveBeenCalledOnce();
    });
});
