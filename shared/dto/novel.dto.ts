import { z } from "zod";

export const MAX_NOVEL_CONTENT_LENGTH = 20_000;
export const MAX_NOVEL_REQUIREMENT_LENGTH = 1_000;

/**
 * 小说续写请求 DTO。
 * content: 当前小说正文
 * requirement: 本次续写要求
 */
export const NovelContinueRequestDtoSchema = z.object({
    content: z
        .string()
        .trim()
        .min(1, "content 不能为空")
        .max(MAX_NOVEL_CONTENT_LENGTH, `content 过长，最大 ${MAX_NOVEL_CONTENT_LENGTH} 字符`),
    requirement: z
        .string()
        .trim()
        .min(1, "requirement 不能为空")
        .max(MAX_NOVEL_REQUIREMENT_LENGTH, `requirement 过长，最大 ${MAX_NOVEL_REQUIREMENT_LENGTH} 字符`),
});

export type NovelContinueRequestDto = z.infer<typeof NovelContinueRequestDtoSchema>;

export type NovelContinueTokenDto = {
    text: string;
};

export type NovelContinueDoneDto = {
    fullText: string;
};

export type NovelContinueErrorDto = {
    message: string;
};
