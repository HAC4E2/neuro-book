import {ValidateProfileTemplateRequestDtoSchema} from "nbook/shared/dto/profile-template.dto";
import {validateProfileTemplate} from "nbook/server/agent/profile-templates/profile-template-service";

/**
 * 校验 TSX profile 模板。
 */
export default defineEventHandler(async (event) => {
    const body = ValidateProfileTemplateRequestDtoSchema.parse(await readBody(event));
    return validateProfileTemplate(body);
});
