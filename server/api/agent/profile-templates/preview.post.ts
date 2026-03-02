import {PreviewProfileTemplateRequestDtoSchema} from "nbook/shared/dto/profile-template.dto";
import {previewProfileTemplate} from "nbook/server/agent/profile-templates/profile-template-service";

/**
 * 预览 TSX profile 模板消息。
 */
export default defineEventHandler(async (event) => {
    const body = PreviewProfileTemplateRequestDtoSchema.parse(await readBody(event));
    return previewProfileTemplate(body);
});
