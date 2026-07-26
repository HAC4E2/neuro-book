import {defineNitroPlugin} from "nitropack/runtime";
import {ensureDefaultStoryboardPreset} from "nbook/server/text-to-image/storyboard-preset-init";

/** 服务启动时自动检查并创建默认 Storyboard Preset。如果文件已存在则跳过。 */
export default defineNitroPlugin((_nitroApp) => {
    void ensureDefaultStoryboardPreset();
});