import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vitest";

import {
    PRODUCT_SOURCE_DATE_EPOCH,
    PRODUCT_NODE_OPTIONS,
    productBuildEnvironment,
    productRuntimeOwnerBaselines,
    withProductBuildLease,
} from "nbook/scripts/build/build-product-runtime-image";
import {
    assertAllProductRuntimeBuildPolicies,
    missingProductRuntimeBuildPolicies,
} from "nbook/scripts/build/check-product-runtime-policies";

describe("Product build environment", () => {
    it("只透传 OS 启动变量，并固定所有会改变 Nuxt/Nitro payload 的输入", () => {
        const source: NodeJS.ProcessEnv = {
            Path: "C:\\tools",
            TEMP: "C:\\temp",
            NODE_OPTIONS: "--require malicious-build-hook.cjs",
            NUXT_DEVTOOLS: "1",
            NUXT_PUBLIC_LEAK: "host-value",
            NITRO_PRESET: "cloudflare-pages",
            VITE_PRIVATE_VALUE: "host-value",
            NODE_ENV: "development",
            SOURCE_DATE_EPOCH: "12345",
            NEURO_BOOK_OUTPUT_DIR: "unexpected-output",
            DATABASE_URL: "secret-runtime-value",
        };

        const environment = productBuildEnvironment(source);

        expect(environment).toMatchObject({
            Path: "C:\\tools",
            TEMP: "C:\\temp",
            LANG: "C",
            LC_ALL: "C",
            NITRO_PRESET: "node-server",
            NODE_ENV: "production",
            NUXT_DEVTOOLS: "0",
            NUXT_TELEMETRY_DISABLED: "1",
            NODE_OPTIONS: PRODUCT_NODE_OPTIONS,
            SOURCE_DATE_EPOCH: PRODUCT_SOURCE_DATE_EPOCH,
            TZ: "UTC",
        });
        expect(environment).not.toHaveProperty("NUXT_PUBLIC_LEAK");
        expect(environment).not.toHaveProperty("VITE_PRIVATE_VALUE");
        expect(environment).not.toHaveProperty("NEURO_BOOK_OUTPUT_DIR");
        expect(environment).not.toHaveProperty("DATABASE_URL");
        expect(source.NUXT_DEVTOOLS).toBe("1");
    });

    it("只返回当前平台实测 baseline，未登记平台 fail closed", () => {
        expect(productRuntimeOwnerBaselines("windows-x64")).toEqual([
            {name: "frontend", files: 177, bytes: 15_854_204},
            {name: "server-bundle", files: 1, bytes: 12_608_947},
            {name: "commands", files: 106, bytes: 10_700_869},
            {name: "authoring-kit", files: 510, bytes: 13_400_281},
            {name: "native-islands", files: 2_059, bytes: 75_260_595},
            {name: "system-assets", files: 373, bytes: 5_303_264},
            {name: "runtime-meta", files: 3, bytes: 4_515},
        ]);
        expect(() => productRuntimeOwnerBaselines("linux-x64-glibc")).toThrow("尚未登记 linux-x64-glibc");
        expect(missingProductRuntimeBuildPolicies()).toContain("linux-x64-glibc");
        expect(missingProductRuntimeBuildPolicies()).not.toContain("windows-x64");
        expect(() => assertAllProductRuntimeBuildPolicies()).toThrow("尚未登记 approved runtime policy");
    });

    it("raw Nuxt pipeline 只读取 tracked 的空 Product dotenv", async () => {
        const [packageText, productEnv, attributes] = await Promise.all([
            readFile("package.json", "utf8"),
            readFile(".env.product", "utf8"),
            readFile(".gitattributes", "utf8"),
        ]);
        const packageJson = JSON.parse(packageText) as {scripts: {"nuxt:build:raw": string}};

        expect(packageJson.scripts["nuxt:build:raw"].match(/--dotenv \.env\.product/gu)).toHaveLength(1);
        expect(productEnv).toBe("# Product builds intentionally load no local runtime configuration.\n");
        expect(attributes).toContain("server/generated/project-prisma/** text eol=lf\n");
    });

    it("整个 Product pipeline 共用一个 fail-fast build lease", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-product-build-lease-"));
        let enterFirst!: () => void;
        let releaseFirst!: () => void;
        const firstStarted = new Promise<void>((resolvePromise) => {
            enterFirst = resolvePromise;
        });
        const firstGate = new Promise<void>((resolvePromise) => {
            releaseFirst = resolvePromise;
        });
        try {
            const first = withProductBuildLease(root, async () => {
                enterFirst();
                await firstGate;
                return "first";
            });
            await firstStarted;
            try {
                await expect(withProductBuildLease(root, async () => "second")).rejects.toThrow("拒绝并发构建");
            } finally {
                releaseFirst();
                await expect(first).resolves.toBe("first");
            }
            await expect(withProductBuildLease(root, async () => "third")).resolves.toBe("third");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });
});
