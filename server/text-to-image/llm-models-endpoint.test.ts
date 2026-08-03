import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const originalDefineEventHandler = (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler;
const originalDefineRouteMeta = (globalThis as typeof globalThis & {defineRouteMeta?: unknown}).defineRouteMeta;
let body: unknown;
let fetchLlmModels: ReturnType<typeof vi.fn>;

describe("POST /api/text-to-image/llm/models", () => {
    beforeEach(() => {
        vi.resetModules();
        fetchLlmModels = vi.fn(async () => ["gpt-4o", "gpt-4o-mini"]);
        const globals = globalThis as typeof globalThis & {
            defineEventHandler?: <THandler>(handler: THandler) => THandler;
            defineRouteMeta?: (meta: unknown) => void;
        };
        globals.defineEventHandler = (handler) => handler;
        globals.defineRouteMeta = () => undefined;
        vi.doMock("nbook/server/utils/auth", () => ({
            requireCurrentUser: vi.fn(async () => ({id: 1})),
        }));
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => body),
        }));
        vi.doMock("nbook/server/text-to-image/llm-models", () => ({
            fetchLlmModels,
        }));
        vi.doMock("nbook/server/text-to-image/provider.service", () => ({
            TextToImageProviderService: class {},
        }));
    });

    afterEach(() => {
        const globals = globalThis as typeof globalThis & {
            defineEventHandler?: unknown;
            defineRouteMeta?: unknown;
        };
        globals.defineEventHandler = originalDefineEventHandler;
        globals.defineRouteMeta = originalDefineRouteMeta;
        vi.doUnmock("nbook/server/utils/auth");
        vi.doUnmock("nbook/server/utils/novel-chapter");
        vi.doUnmock("nbook/server/text-to-image/llm-models");
        vi.doUnmock("nbook/server/text-to-image/provider.service");
    });

    it("未保存 Provider 时用 baseUrl/credential 直拉模型", async () => {
        body = {baseUrl: "https://api.example.com/v1", credential: "sk-test"};
        const handler = (await import("nbook/server/api/text-to-image/llm/models.post")).default;
        const result = await handler({});
        expect(fetchLlmModels).toHaveBeenCalledWith({
            baseUrl: "https://api.example.com/v1",
            credential: "sk-test",
        });
        expect(result).toEqual({models: ["gpt-4o", "gpt-4o-mini"]});
    });
});
