import {fileURLToPath} from "node:url";

import {defineConfig} from "vitest/config";

/** Manager clean-checkout合同不加载Nuxt或Agent测试的全局fixture。 */
export default defineConfig({
    root: fileURLToPath(new URL("../../", import.meta.url)),
    test: {
        environment: "node",
        include: ["scripts/release/manager-release-contract.test.ts"],
    },
});
