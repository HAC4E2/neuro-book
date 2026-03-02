import {listProfileTemplates} from "nbook/server/agent/profile-templates/profile-template-service";

/**
 * 列出 TSX profile 模板。
 */
export default defineEventHandler(async () => {
    return listProfileTemplates();
});
