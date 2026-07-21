#!/usr/bin/env bun
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

import {materializePublicManagerPackage} from "nbook/scripts/release/public-manager-package";
import {run, runCapture} from "nbook/scripts/utils/process.mjs";

const ROOT = resolve(import.meta.dir, "..", "..");
const PACKAGE_ROOT = resolve(ROOT, "packages", "neuro-book-manager");
const packageJson = await Bun.file(resolve(PACKAGE_ROOT, "package.json")).json() as {name: string; version: string};
const temporaryRoot = await mkdtemp(join(tmpdir(), "neuro-book-public-manager-"));

try {
    const publicPackage = await materializePublicManagerPackage(packageJson.version, temporaryRoot);
    // actions/checkout默认是单提交浅克隆；显式取回npm provenance指向的提交后才能比较构建输入。
    await run("git", ["fetch", "--no-tags", "--depth=1", "origin", publicPackage.gitHead], {cwd: ROOT});
    const changedInputs = (await runCapture("git", [
        "diff",
        "--name-only",
        publicPackage.gitHead,
        "--",
        "bun.lock",
        "packages/neuro-book-manager/package.json",
        "packages/neuro-book-manager/scripts/build.mjs",
        "packages/neuro-book-manager/src",
        "server/runtime",
    ], {cwd: ROOT})).trim();
    if (changedInputs) {
        throw new Error(`当前Manager构建输入晚于npm公开gitHead ${publicPackage.gitHead}：\n${changedInputs}`);
    }
    const reportedVersion = (await runCapture("bun", [publicPackage.executable, "--version"], {cwd: ROOT})).trim();
    if (reportedVersion !== packageJson.version) {
        throw new Error(`npm公开Manager --version错误：${reportedVersion}`);
    }
    console.log(`Manager ${packageJson.version}已由gitHead ${publicPackage.gitHead}公开，当前构建输入未漂移。`);
} finally {
    await rm(temporaryRoot, {recursive: true, force: true});
}
