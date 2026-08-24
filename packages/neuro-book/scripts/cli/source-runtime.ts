#!/usr/bin/env bun
import {spawn} from "node:child_process";
import {resolve} from "node:path";
import {seedSystemAssets} from "nbook/server/workspace-files/system-asset-installation";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";

const packageRoot = resolve(import.meta.dirname, "../..");
process.env.NEURO_BOOK_RUNTIME_ASSET_MODE = "install";
delete process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT;
delete process.env.NEURO_BOOK_PRODUCT_BUILD;

const runtimePaths = runtimePathsFromEnv(packageRoot);
await seedSystemAssets({
    applicationRoot: runtimePaths.applicationRoot,
    stateRoot: runtimePaths.stateRoot,
});

const steps: readonly (readonly string[])[] = [
    ["--no-install", resolve(packageRoot, "scripts/db/check-migrations.ts")],
    ["--no-install", "run", "nuxt:prepare"],
    ["--no-install", "run", "generate"],
    ["--no-install", resolve(packageRoot, "scripts/build/prepare-system-assets.ts"), "--sync-user-assets", "--force-sync-user-assets"],
    ["--no-install", "x", "nuxt", "dev", "--no-fork"],
];

for (const args of steps) {
    const code = await run(args);
    if (code !== 0) {
        process.exitCode = code;
        break;
    }
}

function run(args: readonly string[]): Promise<number> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(process.execPath, args, {
            cwd: packageRoot,
            env: process.env,
            stdio: "inherit",
            windowsHide: false,
        });
        child.once("error", rejectPromise);
        child.once("exit", (code, signal) => {
            if (signal) {
                resolvePromise(1);
                return;
            }
            resolvePromise(code ?? 1);
        });
    });
}
