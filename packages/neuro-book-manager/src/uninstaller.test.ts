import {mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {TEST_RUNTIME_IMAGE_IDENTITY} from "#manager/fixtures/runtime-image";
import {INSTALLED_WINDOWS_ROOT_LOCATORS, PORTABLE_ROOT_LOCATORS} from "#manager/root-locators";
import type {InstallationManifest} from "#manager/types";
import {resetDesktopLocalState, uninstallInstallation} from "#manager/uninstaller";

const cleanupRoots: string[] = [];

afterEach(async () => {
    await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Manager uninstall lifecycle", () => {
    it("portable 默认删除程序、cache、desktop 和 logs，但保留 State Root 用户数据", async () => {
        const root = join(process.cwd(), ".agent", `uninstall-portable-${crypto.randomUUID()}`);
        cleanupRoots.push(root);
        await Promise.all([
            write(root, ".output/server/index.mjs", "product"),
            write(root, ".cache/bun/install/pkg", "cache"),
            write(root, "data/.desktop/webview/profile", "webview"),
            write(root, "data/logs/server-current.jsonl", "log"),
            write(root, "data/workspace/novel/book.md", "truth"),
            write(root, "data/config.yaml", "server: {}"),
        ]);

        let stopSawLock = false;
        const result = await uninstallInstallation({
            installationRoot: root,
            manifest: manifest("windows-portable"),
            stop: async () => {
                stopSawLock = await stat(join(root, ".deploy", "install.lock")).then(() => true, () => false);
            },
        });

        expect(stopSawLock).toBe(true);
        expect(result.statePreserved).toBe(true);
        await expect(readFile(join(root, "data", "workspace", "novel", "book.md"), "utf8")).resolves.toBe("truth");
        await expect(readFile(join(root, "data", "config.yaml"), "utf8")).resolves.toBe("server: {}");
        await expect(stat(join(root, ".output"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(join(root, ".cache"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(join(root, "data", ".desktop"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(join(root, "data", "logs"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("portable 同时删除数据时删除整个 Installation Root", async () => {
        const root = join(process.cwd(), ".agent", `uninstall-portable-all-${crypto.randomUUID()}`);
        cleanupRoots.push(root);
        await write(root, "data/workspace/novel/book.md", "truth");

        const result = await uninstallInstallation({
            installationRoot: root,
            manifest: manifest("windows-portable"),
            deleteData: true,
            stop: async () => undefined,
        });

        expect(result.statePreserved).toBe(false);
        await expect(stat(root)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("installed Windows 删除外置 cache/desktop 与 Installation Root，并按选择保留 State Root", async () => {
        const sandbox = join(process.cwd(), ".agent", `uninstall-installed-${crypto.randomUUID()}`);
        const installationRoot = join(sandbox, "Programs", "NeuroBook");
        const localDataRoot = join(sandbox, "Local");
        cleanupRoots.push(sandbox);
        await Promise.all([
            write(installationRoot, ".output/server/index.mjs", "product"),
            write(localDataRoot, "NeuroBook/data/workspace/novel/book.md", "truth"),
            write(localDataRoot, "NeuroBook/data/logs/server-current.jsonl", "log"),
            write(localDataRoot, "NeuroBook/cache/bun/install/pkg", "cache"),
            write(localDataRoot, "NeuroBook/desktop/webview/profile", "webview"),
        ]);

        await uninstallInstallation({
            installationRoot,
            manifest: manifest("product-bun"),
            localDataRoot,
            stop: async () => undefined,
        });

        await expect(stat(installationRoot)).rejects.toMatchObject({code: "ENOENT"});
        await expect(readFile(join(localDataRoot, "NeuroBook/data/workspace/novel/book.md"), "utf8")).resolves.toBe("truth");
        await expect(stat(join(localDataRoot, "NeuroBook/data/logs"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(join(localDataRoot, "NeuroBook/cache"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(join(localDataRoot, "NeuroBook/desktop"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("desktop reset 只删除 Desktop Local/WebView Root", async () => {
        const root = join(process.cwd(), ".agent", `desktop-reset-${crypto.randomUUID()}`);
        cleanupRoots.push(root);
        await Promise.all([
            write(root, "data/.desktop/webview/profile", "webview"),
            write(root, "data/workspace/novel/book.md", "truth"),
        ]);

        await resetDesktopLocalState({
            installationRoot: root,
            manifest: manifest("windows-portable"),
            stop: async () => undefined,
        });

        await expect(stat(join(root, "data", ".desktop"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(readFile(join(root, "data", "workspace", "novel", "book.md"), "utf8")).resolves.toBe("truth");
    });

    it("停止门禁失败时不删除任何 owner", async () => {
        const root = join(process.cwd(), ".agent", `uninstall-running-${crypto.randomUUID()}`);
        cleanupRoots.push(root);
        await Promise.all([
            write(root, ".output/server/index.mjs", "product"),
            write(root, "data/workspace/novel/book.md", "truth"),
        ]);

        await expect(uninstallInstallation({
            installationRoot: root,
            manifest: manifest("windows-portable"),
            stop: async () => {
                throw new Error("Product 仍在运行");
            },
        })).rejects.toThrow("Product 仍在运行");

        await expect(readFile(join(root, ".output", "server", "index.mjs"), "utf8")).resolves.toBe("product");
        await expect(readFile(join(root, "data", "workspace", "novel", "book.md"), "utf8")).resolves.toBe("truth");
    });
});

async function write(root: string, relativePath: string, content: string): Promise<void> {
    const file = join(root, ...relativePath.split("/"));
    await mkdir(dirname(file), {recursive: true});
    await writeFile(file, content, "utf8");
}

function manifest(profile: "windows-portable" | "product-bun"): InstallationManifest {
    const now = new Date().toISOString();
    const revision = "a".repeat(40);
    const asset = {
        archiveSha256: "b".repeat(64),
        sourceUrl: "https://example.com/asset.zip",
        license: "test",
        redistribution: "test",
    };
    return {
        schemaVersion: 5,
        profile,
        containerEngine: null,
        managerVersion: "0.1.0",
        appVersion: "0.8.0",
        channel: "canary",
        sourceRevision: revision,
        roots: profile === "windows-portable" ? PORTABLE_ROOT_LOCATORS : INSTALLED_WINDOWS_ROOT_LOCATORS,
        components: {
            source: {provider: "release", version: "0.8.0", revision, path: ".", files: ["package.json"], ...asset},
            product: {
                provider: "release",
                version: "0.8.0",
                revision,
                path: ".output",
                platform: "windows-x64",
                ...asset,
                ...TEST_RUNTIME_IMAGE_IDENTITY,
            },
            manager: {provider: "managed", version: "0.1.0", path: ".runtime/manager/neuro-book.mjs", bundleSha256: "c".repeat(64)},
            managerRuntime: {provider: "system", executable: "bun", version: "1.3.0"},
            applicationRuntime: {provider: "system", executable: "bun", version: "1.3.0"},
            tools: {},
        },
        installedAt: now,
        updatedAt: now,
    };
}
