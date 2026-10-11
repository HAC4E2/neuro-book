import {fileURLToPath} from "node:url";
import {defineConfig} from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
    root: fileURLToPath(new URL(".", import.meta.url)),
    plugins: [vue()],
    test: {
        include: ["src/**/*.test.ts", "themes/**/*.test.ts", "playground/**/*.test.ts"],
        setupFiles: ["@notnotype/neuro-book-test-support/vitest"],
        globalSetup: ["@notnotype/neuro-book-test-support/vitest"],
        globals: true,
        environment: "happy-dom",
        // Node 26 自带的全局 localStorage 在没有 --localstorage-file 时不可用，还会盖住 happy-dom 的；关掉它，
        // 页面里的 localStorage 由 happy-dom 提供。
        execArgv: ["--no-experimental-webstorage"],
        // e2e/ 是 Playwright 用例，由 test:e2e 单独跑，vitest 不扫
        exclude: ["e2e/**", "**/node_modules/**"],
    },
});
