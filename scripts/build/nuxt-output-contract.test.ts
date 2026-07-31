import {execFile} from "node:child_process";
import {resolve} from "node:path";
import {promisify} from "node:util";
import {describe, expect, it} from "vitest";

const execFileAsync = promisify(execFile);
const configProbe = [
    "import {loadNuxtConfig} from '@nuxt/kit';",
    "const config = await loadNuxtConfig({cwd: process.cwd()});",
    "console.log(JSON.stringify({outputDir: config.nitro?.output?.dir, buildId: config.buildId, appManifest: config.experimental?.appManifest}));",
].join(" ");

type NuxtProductConfigProbe = {
    outputDir: string;
    buildId: string;
    appManifest: boolean;
};

describe("Nuxt raw Product output", () => {
    it("没有 Builder 注入输出目录时只写 Developer Build State", async () => {
        const {stdout} = await execFileAsync("bun", ["-e", configProbe], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NEURO_BOOK_OUTPUT_DIR: "",
                NEURO_BOOK_PRODUCT_IMAGE_ROOT: "",
                NEURO_BOOK_PRODUCT_SOURCE_DIGEST: "",
            },
            windowsHide: true,
        });

        const config = JSON.parse(stdout) as NuxtProductConfigProbe;
        expect(config.outputDir).toBe(resolve(".nuxt", "product-raw"));
        expect(config.outputDir).not.toBe(resolve(".output"));
        expect(config.appManifest).toBe(true);
    });

    it("保留 Builder 候选目录并使用 Source digest 派生稳定 build ID", async () => {
        const candidate = resolve(".agent", "workspace", "nuxt-output-contract", ".output");
        const sourceDigest = `sha256:${"a".repeat(64)}`;
        const {stdout} = await execFileAsync("bun", ["-e", configProbe], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NEURO_BOOK_OUTPUT_DIR: candidate,
                NEURO_BOOK_PRODUCT_IMAGE_ROOT: candidate,
                NEURO_BOOK_PRODUCT_SOURCE_DIGEST: sourceDigest,
            },
            windowsHide: true,
        });

        expect(JSON.parse(stdout) as NuxtProductConfigProbe).toEqual({
            outputDir: candidate,
            buildId: sourceDigest.slice("sha256:".length),
            appManifest: false,
        });
    });

    it.each([
        ["只设置 output root", resolve(".agent", "workspace", "nuxt-output-only"), "", "同时注入"],
        ["只设置 image root", "", resolve(".agent", "workspace", "nuxt-image-only"), "同时注入"],
        [
            "注入不一致的两个 root",
            resolve(".agent", "workspace", "nuxt-output-mismatch"),
            resolve(".agent", "workspace", "nuxt-image-mismatch"),
            "不一致",
        ],
    ])("%s 时拒绝 raw Product build", async (_label, outputRoot, imageRoot, expectedMessage) => {
        await expect(execFileAsync("bun", ["-e", configProbe], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NEURO_BOOK_OUTPUT_DIR: outputRoot,
                NEURO_BOOK_PRODUCT_IMAGE_ROOT: imageRoot,
                NEURO_BOOK_PRODUCT_SOURCE_DIGEST: "",
            },
            windowsHide: true,
        })).rejects.toThrow(expectedMessage);
    });

    it.each([
        ["缺少", ""],
        ["无效", "sha256:bad"],
    ])("%s Source digest 时拒绝 raw Product build", async (_label, sourceDigest) => {
        const candidate = resolve(".agent", "workspace", "nuxt-output-digest");
        await expect(execFileAsync("bun", ["-e", configProbe], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NEURO_BOOK_OUTPUT_DIR: candidate,
                NEURO_BOOK_PRODUCT_IMAGE_ROOT: candidate,
                NEURO_BOOK_PRODUCT_SOURCE_DIGEST: sourceDigest,
            },
            windowsHide: true,
        })).rejects.toThrow(sourceDigest ? "Source digest 无效" : "注入 Source digest");
    });
});
