import {fileURLToPath} from "node:url";
import {defineConfig} from "vitest/config";

const rootDir = fileURLToPath(new URL("./", import.meta.url));

/**
 * 当前测试先聚焦后端 Agent 与 Agent 前端纯逻辑投影。
 * 统一使用 Node 环境，避免前端测试依赖和 Nuxt 浏览器运行时混进来。
 */
export default defineConfig({
    resolve: {
        alias: {
            nbook: rootDir,
        },
    },
    test: {
        environment: "node",
        globals: true,
        // run 级：回收上一次残留 fixture + 建立共享只读 system assets snapshot。
        globalSetup: [
            "server/agent/test/global-setup.ts",
        ],
        setupFiles: [
            "server/agent/test/setup.ts",
        ],
        include: [
            "app/components/novel-ide/agent/**/*.test.ts",
            "app/components/novel-ide/rag/**/*.test.ts",
            "app/components/novel-ide/settings/**/*.test.ts",
            "app/components/markdown-studio/**/*.test.ts",
            "app/components/profile-template-editor/**/*.test.ts",
            "app/stores/**/*.test.ts",
            "app/utils/**/*.test.ts",
            "scripts/build/**/*.test.ts",
            "scripts/db/**/*.test.ts",
            "scripts/install/**/*.test.ts",
            "scripts/release/**/*.test.ts",
            "server/**/*.test.ts",
            // Profile DSL 用 JSX，相关测试必须是 .tsx 才能被 oxc 解析。
            "server/**/*.test.tsx",
            "shared/**/*.test.ts",
        ],
        coverage: {
            provider: "v8",
            reporter: ["text", "html"],
            include: [
                "server/agent/**/*.ts",
                "shared/dto/agent-chat.dto.ts",
            ],
        },
    },
});
