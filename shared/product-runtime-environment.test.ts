import {join} from "node:path";

import {describe, expect, it} from "vitest";
import {createProductRuntimeEnvironment} from "nbook/shared/product-runtime-environment";

describe("Product runtime environment", () => {
    it("State 环境覆盖普通配置，但不能覆盖受管 root 与工具路径", () => {
        const applicationRoot = join("C:", "NeuroBook");
        const stateRoot = join("C:", "NeuroBookData", "data");
        const cacheRoot = join("C:", "NeuroBookData", "cache");
        const environment = createProductRuntimeEnvironment({
            applicationRoot,
            stateRoot,
            cacheRoot,
            development: false,
            inheritedEnvironment: {API_ORIGIN: "inherited", HOST: "inherited-host"},
            stateEnvironment: {
                API_ORIGIN: "state",
                NEURO_BOOK_STATE_ROOT: "outside-state",
                NEURO_BOOK_CACHE_ROOT: "outside-cache",
                NEURO_BOOK_LOG_DIR: "outside-logs",
                LLMLINT_HOME: "outside-llmlint",
                LLMLINT_CACHE_DIR: "outside-llmlint-cache",
                BUN_INSTALL_CACHE_DIR: "outside-bun",
            },
            host: "127.0.0.1",
            runtimeExecutable: "bun-managed",
        });

        expect(environment).toMatchObject({
            API_ORIGIN: "state",
            NODE_ENV: "production",
            HOST: "127.0.0.1",
            NITRO_HOST: "127.0.0.1",
            NEURO_BOOK_APPLICATION_ROOT: applicationRoot,
            NEURO_BOOK_STATE_ROOT: stateRoot,
            NEURO_BOOK_CACHE_ROOT: cacheRoot,
            NEURO_BOOK_LOG_DIR: join(stateRoot, "logs"),
            LLMLINT_HOME: join(stateRoot, "tool-state", "llmlint"),
            LLMLINT_CACHE_DIR: join(cacheRoot, "llmlint"),
            BUN_INSTALL_CACHE_DIR: join(cacheRoot, "bun", "install"),
            BUN: "bun-managed",
        });
    });

    it("未指定 host 时保留 State 环境的容器监听配置", () => {
        const environment = createProductRuntimeEnvironment({
            applicationRoot: "/app",
            stateRoot: "/app/data",
            cacheRoot: "/app/cache",
            development: false,
            inheritedEnvironment: {HOST: "inherited-host"},
            stateEnvironment: {HOST: "0.0.0.0", NITRO_HOST: "0.0.0.0"},
        });

        expect(environment.HOST).toBe("0.0.0.0");
        expect(environment.NITRO_HOST).toBe("0.0.0.0");
    });
});
