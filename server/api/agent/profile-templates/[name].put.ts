import {SaveProfileTemplateRequestDtoSchema} from "nbook/shared/dto/profile-template.dto";
import {saveProfileTemplate} from "nbook/server/agent/profile-templates/profile-template-service";

/**
 * 保存 TSX profile 模板。
 */
export default defineEventHandler(async (event) => {
    const name = getRouterParam(event, "name") ?? "";
    const body = SaveProfileTemplateRequestDtoSchema.parse(await readBody(event));
    return saveProfileTemplate(name, body);
});
