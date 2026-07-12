#!/usr/bin/env bun
/**
 * Tauri Desktop Portable 组装脚本。
 *
 * 把 Tauri 编译出的 neuro-book-desktop.exe、product:stage 产物、官方 Bun 运行时
 * 拼成一个可分发的 portable 文件夹：
 *
 *   dist/neuro-book-desktop-x64/
 *   ├── NeuroBook.exe          ← Tauri 主程序，双击开窗口
 *   ├── product/                ← Nitro 服务端 + 前端（product:stage 产物）
 *   ├── runtime/bun/bun.exe     ← Bun 运行时（启动 Nitro 服务用）
 *   └── data/                   ← 运行时生成（workspace / logs / sqlite）
 *
 * 运行态由 Rust 主进程编排：建 data、写 config、migrate、启服务、开窗口。
 */
import {existsSync} from "node:fs";
import {cp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {basename, dirname, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {runCapture} from "../utils/process.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXE_PATH = join(REPO_ROOT, "src-tauri", "target", "release", "neuro-book-desktop.exe");
const PRODUCT_ROOT = join(REPO_ROOT, "product");
const PACKAGE_ROOT_NAME = "neuro-book-desktop-x64";
const DEFAULT_OUTPUT = join(REPO_ROOT, "dist", PACKAGE_ROOT_NAME);
const EXE_NAME = "NeuroBook.exe";

const options = parseArgs(process.argv.slice(2));

async function main() {
    process.chdir(REPO_ROOT);
    await assertExeBuilt();
    await assertProductStaged();

    const stageRoot = resolve(options.output ?? DEFAULT_OUTPUT);
    // 保留 data/（用户配置、小说、sqlite），只更新 exe / product / runtime
    await rm(join(stageRoot, "product"), {recursive: true, force: true});
    await rm(join(stageRoot, EXE_NAME), {force: true});
    await rm(join(stageRoot, "runtime"), {recursive: true, force: true});
    await mkdir(join(stageRoot, "runtime", "bun"), {recursive: true});
    await mkdir(join(stageRoot, "data"), {recursive: true});

    await copyExe(stageRoot);
    await copyProduct(stageRoot);
    const bunRuntime = await stageBunRuntime(stageRoot);
    await writePortableMeta(stageRoot, bunRuntime);

    console.log(`Desktop portable assembled: ${relative(REPO_ROOT, stageRoot).replaceAll("\\", "/")}`);
    console.log(`  双击启动：${join(stageRoot, EXE_NAME)}`);
}

function parseArgs(args) {
    const parsed = {output: null, bunRuntime: null};
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--output") {
            parsed.output = args[index + 1];
            index += 1;
        } else if (arg === "--bun-runtime") {
            parsed.bunRuntime = args[index + 1];
            index += 1;
        } else {
            throw new Error(`未知参数：${arg}`);
        }
    }
    return parsed;
}

async function assertExeBuilt() {
    if (!existsSync(EXE_PATH)) {
        throw new Error(`缺少 Tauri 产物：${EXE_PATH}\n请先运行 bunx tauri build --no-bundle。`);
    }
}

async function assertProductStaged() {
    const entry = join(PRODUCT_ROOT, ".output", "server", "index.mjs");
    if (!existsSync(entry)) {
        throw new Error(`缺少 Product Payload 入口：${entry}\n请先运行 bun run nuxt:build && bun run product:stage。`);
    }
}

async function copyExe(stageRoot) {
    await cp(EXE_PATH, join(stageRoot, EXE_NAME));
}

async function copyProduct(stageRoot) {
    await cp(PRODUCT_ROOT, join(stageRoot, "product"), {recursive: true});
    // product:stage 写入的 .env 含随机 session 密码，桌面版由 Rust 自管环境变量，移除避免混淆
    await rm(join(stageRoot, "product", ".env"), {force: true});
    // product/workspace 在开发态可能是含 .nbook 数据的真实目录（非联接），
    // 桌面版由 Rust 运行时创建 product/workspace -> data/workspace 联接，
    // 这里必须移除，否则首次启动会报"已存在且非空"错误。
    await rm(join(stageRoot, "product", "workspace"), {recursive: true, force: true});
}

async function stageBunRuntime(stageRoot) {
    const source = options.bunRuntime
        ? resolve(options.bunRuntime)
        : await resolveBunFromPath();
    const target = join(stageRoot, "runtime", "bun", "bun.exe");
    await cp(source, target);
    const version = (await runCapture(target, ["--version"])).trim();
    return {version, path: "runtime/bun/bun.exe"};
}

async function resolveBunFromPath() {
    const locator = process.platform === "win32" ? "where" : "which";
    const output = await runCapture(locator, ["bun"]);
    const first = output.split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
    if (!first) {
        throw new Error("未在 PATH 中找到 Bun。请先安装官方 Bun，或使用 --bun-runtime <bun.exe> 指定。");
    }
    // 官方 Bun 安装器给出 bun.exe；npm 安装给出 bun.cmd（无 bun.exe），后者不可作为便携运行时
    if (process.platform === "win32" && basename(first).toLowerCase() !== "bun.exe") {
        // 跟随可能的 junction/shim 找真实 exe
        const real = join(dirname(first), "bun.exe");
        if (existsSync(real)) {
            return real;
        }
        const npmRuntime = join(dirname(first), "node_modules", "bun", "bin", "bun.exe");
        if (existsSync(npmRuntime)) {
            return npmRuntime;
        }
        throw new Error(`PATH 中的 bun 不是 bun.exe：${first}\n请安装官方 Bun (https://bun.sh) 或用 --bun-runtime 指定真实 bun.exe。`);
    }
    return first;
}

async function writePortableMeta(stageRoot, bunRuntime) {
    const pkg = JSON.parse(await readFile(join(REPO_ROOT, "package.json"), "utf8"));
    await writeFile(join(stageRoot, "desktop-release.json"), `${JSON.stringify({
        releaseTag: `v${pkg.version}`,
        runtimeKind: "bun",
        bunVersion: bunRuntime.version,
        runtimePath: bunRuntime.path,
        createdAt: new Date().toISOString(),
    }, null, 4)}\n`, "utf8");
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
