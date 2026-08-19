import {mkdir, mkdtemp, rm} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {resolveSystemNbookRoot} from "nbook/server/workspace-files/system-workspace-assets";

const originalApplicationRoot = process.env.NEURO_BOOK_APPLICATION_ROOT;
const originalStateRoot = process.env.NEURO_BOOK_STATE_ROOT;
const originalProductImageRoot = process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT;
const roots: string[] = [];

beforeEach(() => {
    delete process.env.NEURO_BOOK_APPLICATION_ROOT;
    delete process.env.NEURO_BOOK_STATE_ROOT;
    delete process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT;
});

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    restoreEnv("NEURO_BOOK_APPLICATION_ROOT", originalApplicationRoot);
    restoreEnv("NEURO_BOOK_STATE_ROOT", originalStateRoot);
    restoreEnv("NEURO_BOOK_PRODUCT_IMAGE_ROOT", originalProductImageRoot);
});

function restoreEnv(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}

describe("System Workspace assets", () => {
    it("无根node_modules时使用Product内已修补的系统模板", async () => {
        const root = await mkdtemp(testHostPath("nbook-product-assets-"));
        roots.push(root);
        await mkdir(join(root, "assets", "workspace", ".nbook"), {recursive: true});
        const productRoot = join(root, ".output", "server", "assets", "workspace", ".nbook");
        await mkdir(productRoot, {recursive: true});

        expect(resolveSystemNbookRoot(root)).toBe(productRoot);
    });

    it("源码Application Root存在node_modules时使用bundled系统模板", async () => {
        const root = await mkdtemp(testHostPath("nbook-source-assets-"));
        roots.push(root);
        const sourceRoot = join(root, "assets", "workspace", ".nbook");
        await mkdir(sourceRoot, {recursive: true});
        await mkdir(join(root, "node_modules"), {recursive: true});
        await mkdir(join(root, ".output", "server", "assets", "workspace", ".nbook"), {recursive: true});

        expect(resolveSystemNbookRoot(root)).toBe(sourceRoot);
    });
});
