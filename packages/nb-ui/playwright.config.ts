import { defineConfig, devices } from "@playwright/test";

// Bun 下直接跑 playwright 会在 CDP 握手超时（design-language 坑 #20），
// 因此 package.json 的 test:e2e 走 `node node_modules/@playwright/test/cli.js` 显式 Node 入口。
export default defineConfig({
    testDir: "./e2e",
    timeout: 60_000,
    expect: {timeout: 15_000},
    retries: 0,
    workers: 1,
    reporter: [["list"]],
    use: {
        baseURL: "http://localhost:3100",
        trace: "retain-on-failure",
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
    webServer: {
        command: "bunx nuxt dev playground --port 3100",
        url: "http://localhost:3100/",
        reuseExistingServer: true,
        timeout: 120_000,
    },
});
