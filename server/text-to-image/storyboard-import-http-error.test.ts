import {describe, expect, it} from "vitest";
import {throwStoryboardImportHttpError} from "nbook/server/text-to-image/storyboard-import-http-error";
import {
    StoryboardPublishError,
    type StoryboardPublishErrorCode,
} from "nbook/server/text-to-image/storyboard-publish.service";

describe("throwStoryboardImportHttpError", () => {
    it.each([
        ["STORYBOARD_IMPORT_APPROVAL_INVALID", 400],
        ["STORYBOARD_PRESET_STALE", 409],
        ["STORYBOARD_PRESET_ID_CONFLICT", 409],
        ["TAG_PATTERN_SET_STALE", 409],
    ] satisfies Array<[StoryboardPublishErrorCode, number]>) (
        "把 %s 映射为稳定 HTTP 状态",
        (code, statusCode) => {
            try {
                throwStoryboardImportHttpError(new StoryboardPublishError(code, "测试错误"));
            } catch (error) {
                expect(error).toMatchObject({statusCode, data: {code}});
            }
        },
    );
});
