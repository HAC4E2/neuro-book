import {beforeEach, describe, expect, it, vi} from "vitest";
import {CharacterVisualDirectWriteRequestSchema} from "nbook/shared/text-to-image-character-direct-write";
import {createTextToImageFileHash} from "nbook/shared/text-to-image-file-hash";

const SOURCE_HASH = createTextToImageFileHash("# Hero\n");
const KEY = "9aa9105b-0c1c-4ad3-9032-20b2aafc7e5f";
const generateCharacterVisualFiles = vi.fn();
const requireCurrentUser = vi.fn(async () => undefined);
const validateBody = vi.fn(async (event: {body: unknown}, schema: {parse(value: unknown): unknown}) => schema.parse(event.body));
const withProjectNotOpenHttpError = vi.fn((operation: () => Promise<unknown>) => operation());

const request = {
    projectPath: "workspace/demo",
    characterPath: "lorebook/character/hero/index.md",
    sourceCharacterFileHash: SOURCE_HASH,
    idempotencyKey: KEY,
};

const completed = {
    state: "completed",
    operationId: "character-visual-direct:hero",
    sessionId: 41,
    invocationId: "invoke-41",
    characterImageTagsPath: "lorebook/character/hero/image-tags.md",
    outfitPaths: ["lorebook/character/hero/outfits/travel.md"],
    diagnostics: [],
    fileHashes: {"lorebook/character/hero/image-tags.md": SOURCE_HASH},
};

describe("POST /api/text-to-image/character-image-tags direct contract", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        generateCharacterVisualFiles.mockReset();
        vi.unstubAllGlobals();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.doMock("nbook/server/text-to-image/character-image-tags", () => ({
            CharacterVisualDirectWriteRequestSchema,
            generateCharacterVisualFiles,
        }));
        vi.doMock("nbook/server/utils/auth", () => ({requireCurrentUser}));
        vi.doMock("nbook/server/utils/novel-chapter", () => ({validateBody}));
        vi.doMock("nbook/server/workspace-files/project-open-guard", () => ({withProjectNotOpenHttpError}));
    });

    it("认证并严格校验 direct request，只返回 completed result", async () => {
        generateCharacterVisualFiles.mockResolvedValue(completed);
        const handler = (await import("nbook/server/api/text-to-image/character-image-tags.post")).default;

        await expect(handler({body: request} as never)).resolves.toEqual(completed);
        expect(requireCurrentUser).toHaveBeenCalledOnce();
        expect(validateBody).toHaveBeenCalledOnce();
        expect(generateCharacterVisualFiles).toHaveBeenCalledWith(request);
        expect(withProjectNotOpenHttpError).toHaveBeenCalledOnce();
    }, 15_000);

    it("在进入 direct orchestration 前拒绝错误 hash、UUID、路径及额外字段", async () => {
        const handler = (await import("nbook/server/api/text-to-image/character-image-tags.post")).default;
        for (const body of [
            {...request, sourceCharacterFileHash: "sha256:bad"},
            {...request, idempotencyKey: "not-a-uuid"},
            {...request, characterPath: "lorebook/character/hero/image-tags.md"},
            {...request, proposalId: "proposal-1"},
        ]) {
            await expect(handler({body} as never)).rejects.toThrow();
        }
        expect(generateCharacterVisualFiles).not.toHaveBeenCalled();
    });

    it("拒绝 service 返回的非 completed 或额外字段响应", async () => {
        const handler = (await import("nbook/server/api/text-to-image/character-image-tags.post")).default;
        generateCharacterVisualFiles.mockResolvedValueOnce({...completed, state: "running"});
        await expect(handler({body: request} as never)).rejects.toThrow();
        generateCharacterVisualFiles.mockResolvedValueOnce({...completed, proposal: {}});
        await expect(handler({body: request} as never)).rejects.toThrow();
    });

    it.each([
        "CHARACTER_VISUAL_OPERATION_RUNNING",
        "CHARACTER_VISUAL_INVOCATION_ORPHANED",
    ] as const)("将 %s 保持为共享 409 error code", async (code) => {
        const {CharacterVisualDirectWriteError} = await import("nbook/server/text-to-image/character-visual-direct-write.service");
        generateCharacterVisualFiles.mockRejectedValue(new CharacterVisualDirectWriteError(code, code));
        const handler = (await import("nbook/server/api/text-to-image/character-image-tags.post")).default;

        await expect(handler({body: request} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {code},
        });
    });
});
