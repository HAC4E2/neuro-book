import {fileURLToPath} from "node:url";
import {defineConfig} from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "#manager": fileURLToPath(new URL("./src", import.meta.url)),
            "nbook": fileURLToPath(new URL("../../", import.meta.url)),
        },
    },
    test: {
        include: ["src/**/*.test.ts"],
        environment: "node",
        // Manager回归包含真实Git、PowerShell和子进程冷启动；共享runner负载下5秒不足以区分慢启动与挂死。
        testTimeout: 20_000,
    },
});
