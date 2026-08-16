import {fileURLToPath} from "node:url";
import {defineConfig} from "vitest/config";

export default defineConfig({
    root: fileURLToPath(new URL("../..", import.meta.url)),
    resolve: {
        alias: {
            "#owned-process": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    test: {
        include: ["packages/owned-process/tests/**/*.test.ts"],
        environment: "node",
        setupFiles: ["@notnotype/neuro-book-test-support/vitest"],
        globalSetup: ["@notnotype/neuro-book-test-support/vitest"],
        testTimeout: 20_000,
    },
});
