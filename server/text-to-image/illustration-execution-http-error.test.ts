import {createError} from "h3";
import {NovelAiCapabilityError} from "nbook/shared/text-to-image-provider-registry";
import {IllustrationCompileError} from "nbook/server/text-to-image/illustration-compiler";
import {IllustrationExecutionCompilerError} from "nbook/server/text-to-image/illustration-execution.compiler";
import {IllustrationExecutionServiceError} from "nbook/server/text-to-image/illustration-execution.service";
import {TextToImageManualReferencesUnsupportedError} from "nbook/server/text-to-image/recipe.service";
import {describe, expect, it} from "vitest";
import {throwIllustrationExecutionHttpError} from "nbook/server/text-to-image/illustration-execution-http-error";

describe("illustration-execution HTTP 错误映射", () => {
    it("Compiler preflight 错误映射为 422 稳定 code", () => {
        const error = new NovelAiCapabilityError("TEXT_TO_IMAGE_REFERENCE_LIMIT_EXCEEDED", "too many");
        expect(() => throwIllustrationExecutionHttpError(error)).toThrow(expect.objectContaining({
            statusCode: 422,
            data: {code: "TEXT_TO_IMAGE_REFERENCE_LIMIT_EXCEEDED"},
        }));
    });

    it("手工生成携带参考资源映射为 422 稳定 code", () => {
        expect(() => throwIllustrationExecutionHttpError(new TextToImageManualReferencesUnsupportedError()))
            .toThrow(expect.objectContaining({
                statusCode: 422,
                data: {code: "TEXT_TO_IMAGE_MANUAL_REFERENCES_UNSUPPORTED"},
            }));
    });

    it("IllustrationCompileError 的 stale 映射为 409，其余 422", () => {
        expect(() => throwIllustrationExecutionHttpError(
            new IllustrationCompileError("ILLUSTRATION_SHOT_STALE", "stale"),
        )).toThrow(expect.objectContaining({statusCode: 409}));
        expect(() => throwIllustrationExecutionHttpError(
            new IllustrationCompileError("REFERENCE_ASSET_NOT_FOUND", "missing"),
        )).toThrow(expect.objectContaining({statusCode: 422}));
        expect(() => throwIllustrationExecutionHttpError(
            new IllustrationCompileError("REFERENCE_ASSET_INPAINT_DIMENSIONS_MISMATCH", "mismatch"),
        )).toThrow(expect.objectContaining({statusCode: 422}));
    });

    it("IllustrationExecutionCompilerError 的 not-found 映射为 404", () => {
        expect(() => throwIllustrationExecutionHttpError(
            new IllustrationExecutionCompilerError("ILLUSTRATION_EXECUTION_TARGET_NOT_FOUND", "missing target"),
        )).toThrow(expect.objectContaining({statusCode: 404}));
    });

    it("IllustrationExecutionServiceError 的 confirmation 映射为 409", () => {
        expect(() => throwIllustrationExecutionHttpError(
            new IllustrationExecutionServiceError("ILLUSTRATION_PREVIEW_CONFIRMATION_REQUIRED", "confirm"),
        )).toThrow(expect.objectContaining({statusCode: 409}));
    });

    it("未知错误原样传播", () => {
        const boom = new Error("boom");
        expect(() => throwIllustrationExecutionHttpError(boom)).toThrow(boom);
    });

    it("mapped 错误是 h3 createError 形状", () => {
        const error = createError({statusCode: 422, message: "x", data: {code: "TEXT_TO_IMAGE_MANUAL_REFERENCES_UNSUPPORTED"}});
        expect(error.statusCode).toBe(422);
        expect(error.data).toEqual({code: "TEXT_TO_IMAGE_MANUAL_REFERENCES_UNSUPPORTED"});
    });
});
