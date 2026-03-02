import {
    FormAnnotationRequestDtoSchema,
    type FormAnnotationRequestDto,
} from "nbook/shared/dto/ai-form-annotation.dto";
import {FormAnnotationService} from "nbook/server/ai/form-annotation/form-annotation.service";

/**
 * AI 表单批注接口。
 * 当前只返回 stub 结果，用于打通前后端草稿流。
 */
export default defineEventHandler(async (event) => {
    const body = await readBody(event);
    const parseResult = FormAnnotationRequestDtoSchema.safeParse(body);
    if (!parseResult.success) {
        throw createError({
            statusCode: 400,
            message: parseResult.error.issues[0]?.message ?? "请求体不合法",
        });
    }

    return new FormAnnotationService().annotate(parseResult.data as FormAnnotationRequestDto);
});
