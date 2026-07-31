import {defineNitroPlugin} from "nitropack/runtime";
import {assertProductMigrationsReady} from "nbook/server/runtime/product-migration-gate";

/** 直接运行 Nuxt/Nitro 时仍在监听端口前执行统一只读迁移门禁。 */
export default defineNitroPlugin(async () => {
    await assertProductMigrationsReady();
});
