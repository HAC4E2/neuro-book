import {readProfileTemplate} from "nbook/server/agent/profile-templates/profile-template-service";

/**
 * 读取 TSX profile 模板详情。
 */
export default defineEventHandler(async (event) => {
    const name = getRouterParam(event, "name") ?? "";
    return readProfileTemplate(name);
});
