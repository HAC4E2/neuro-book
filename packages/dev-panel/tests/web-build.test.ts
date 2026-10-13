import {afterEach, expect, test} from "bun:test";
import {createRequire} from "node:module";
import {readdir, readFile, rm} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {run} from "./git-fixture.js";

/**
 * 前端构建的产物（L1 级的检查，但要真跑一次 vite build）：CSS 压缩不能丢掉 nb-ui 的不带前缀的 `backdrop-filter`。
 * Vite 8 缺省的 Lightning CSS 会把它与后写的 `-webkit-backdrop-filter` 合并成只剩后者，Chrome 不认，对话框背后的字就透出来（t10 实现审查第 1 条）。
 */

const PACKAGE_ROOT = resolve(import.meta.dirname, "..");
const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

test("构建产物里每条 -webkit-backdrop-filter 都有同值的不带前缀的 backdrop-filter", async () => {
    const root = await createTestTmpRoot("dev-panel-web-build", "dev-panel web build");
    roots.push(root);
    const outDir = join(root, "web");
    const vite = join(dirname(createRequire(join(PACKAGE_ROOT, "package.json")).resolve("vite/package.json")), "bin", "vite.js");
    const built = await run(process.execPath, [vite, "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "warn"], PACKAGE_ROOT, undefined, 120_000);
    expect([built.exitCode, built.stderr]).toEqual([0, ""]);
    const assets = join(outDir, "assets");
    const css = (await Promise.all((await readdir(assets)).filter((name) => name.endsWith(".css")).map((name) => readFile(join(assets, name), "utf8")))).join("\n");
    const values = (pattern: RegExp) => new Set([...css.matchAll(pattern)].map((match) => match[1]!.trim()));
    const prefixed = values(/-webkit-backdrop-filter:([^;}]+)/gu);
    const standard = values(/(?<![-\w])backdrop-filter:([^;}]+)/gu);
    // nb-ui 浮层的模糊：主题里的 `--overlay-blur`。
    expect(prefixed.has("var(--overlay-blur)")).toBe(true);
    expect([...prefixed].filter((value) => !standard.has(value))).toEqual([]);
}, 180_000);
