#!/usr/bin/env bun
/**
 * NeuroBook Setup 构建脚本。
 *
 * 流程：
 *   1. 把 dist/neuro-book-desktop-x64/ 复制到 C:\temp\nb-setup\source\（短路径，绕过 MAX_PATH）
 *   2. 调用 Inno Setup ISCC.exe 编译 setup.exe
 *   3. 输出 dist/NeuroBook-Setup.exe
 */
import {existsSync} from "node:fs";
import {cp, mkdir, readFile, rm} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {runCapture} from "../utils/process.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORTABLE_SOURCE = join(REPO_ROOT, "dist", "neuro-book-desktop-x64");
const STAGING_ROOT = "C:\\temp\\nb-setup";
const STAGING_SOURCE = join(STAGING_ROOT, "source");
const ISS_SCRIPT = join(REPO_ROOT, "scripts", "deploy", "neuro-book-setup.iss");
const ISCC_PATHS = [
    join(process.env.LOCALAPPDATA ?? "", "Programs", "Inno Setup 6", "ISCC.exe"),
    "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
    "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
];
const OUTPUT_EXE = join(REPO_ROOT, "dist", "NeuroBook-Setup.exe");

async function main() {
    process.chdir(REPO_ROOT);

    // 1. 校验 portable 产物
    if (!existsSync(join(PORTABLE_SOURCE, "NeuroBook.exe"))) {
        throw new Error(`缺少 portable 产物：${PORTABLE_SOURCE}\n请先运行 bun run desktop:assemble`);
    }

    // 2. 定位 ISCC
    const iscc = ISCC_PATHS.find((path) => existsSync(path));
    if (!iscc) {
        throw new Error("未找到 Inno Setup 6 ISCC.exe。\n请安装：winget install JRSoftware.InnoSetup");
    }
    console.log(`ISCC: ${iscc}`);

    // 3. 读取版本号
    const releaseMeta = JSON.parse(await readFile(join(PORTABLE_SOURCE, "desktop-release.json"), "utf8"));
    const version = releaseMeta.releaseTag.replace(/^v/u, "").split("-")[0];
    console.log(`Version: ${version}`);

    // 4. 暂存到短路径
    console.log("Staging to short path...");
    await rm(STAGING_ROOT, {recursive: true, force: true});
    await mkdir(STAGING_SOURCE, {recursive: true});
    await cp(PORTABLE_SOURCE, STAGING_SOURCE, {recursive: true});
    console.log("Staged.");

    // 5. 编译
    console.log("Compiling installer...");
    const env = {...process.env, NEURO_BOOK_VERSION: version};
    await runCapture(iscc, [ISS_SCRIPT], {env});
    console.log(`Installer built: ${basename(OUTPUT_EXE)}`);

    // 6. 清理暂存
    await rm(STAGING_ROOT, {recursive: true, force: true});

    // 7. 输出信息
    if (existsSync(OUTPUT_EXE)) {
        const size = (await import("node:fs/promises")).stat(OUTPUT_EXE).then((s) => s.size);
        console.log(`Output: dist/NeuroBook-Setup.exe (${((await size) / 1024 / 1024).toFixed(1)} MB)`);
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
