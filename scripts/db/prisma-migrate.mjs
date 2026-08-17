#!/usr/bin/env bun
import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {preparePrismaEnv} from "./prisma-env.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptApplicationRoot = resolve(scriptDir, "..", "..");
const applicationRoot = process.env.NEURO_BOOK_APPLICATION_ROOT?.trim()
    ? resolve(process.env.NEURO_BOOK_APPLICATION_ROOT)
    : scriptApplicationRoot;
const configRoot = existsSync(resolve(applicationRoot, "prisma.config.ts"))
    ? applicationRoot
    : scriptApplicationRoot;
const configPath = resolve(configRoot, "prisma.config.ts");
const env = preparePrismaEnv({applicationRoot});
const mode = process.argv.includes("--deploy") ? "deploy" : "dev";
// 额外参数透传给 prisma CLI（如 --name xxx），--deploy 是本脚本自己的开关不下传
const extraArgs = process.argv.slice(2).filter((arg) => arg !== "--deploy");
if (mode === "deploy") {
    const child = spawn(process.execPath, [resolve(scriptDir, "sqlite-migrate.mjs")], {
        cwd: applicationRoot,
        env: {...process.env, DATABASE_KIND: env.kind, DATABASE_URL: env.databaseUrl},
        stdio: "inherit",
    });
    child.on("exit", (code, signal) => {
        if (signal) {
            process.kill(process.pid, signal);
            return;
        }
        process.exit(code ?? 1);
    });
    child.on("error", (error) => {
        console.error(error);
        process.exit(1);
    });
} else {
    const args = ["prisma", "migrate", mode, "--config", configPath, ...extraArgs];
    const bunCommand = process.execPath;
    const child = spawn(bunCommand, ["x", ...args], {
        cwd: applicationRoot,
        env: {...process.env, DATABASE_KIND: env.kind, DATABASE_URL: env.databaseUrl},
        stdio: "inherit",
    });

    child.on("exit", (code, signal) => {
        if (signal) {
            process.kill(process.pid, signal);
            return;
        }
        process.exit(code ?? 1);
    });
    child.on("error", (error) => {
        console.error(error);
        process.exit(1);
    });
}
