/**
 * `dist/nb-ui.css` 是入库的构建产物（AGENTS.md）：组件类名、图标、token 或 `src/styles.css` 改了要重跑 `build:css`。
 * 忘了的时候新应用的 UnoCSS 会补出大部分工具类，截图看不出来（design-language.md 坑 #27）。这里用 `build:css`
 * 同一条命令编译到临时目录，与入库的产物逐字节比较。
 */
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {rm} from "node:fs/promises";
import {delimiter, join} from "node:path";
import {afterAll, describe, expect, it} from "vitest";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

const packageRoot = join(import.meta.dirname, "..");
const repoRoot = join(packageRoot, "..", "..");
const DIST = "./dist/nb-ui.css";

let tmp = "";

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("dist/nb-ui.css", () => {
    it("与源码现编的产物一致；不一致时运行 bun run build:css 并提交产物", async () => {
        tmp = await createTestTmpRoot("nb-ui", "dist-css");
        const scripts = (JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {scripts: Record<string, string>}).scripts;
        const [command = "", ...args] = (scripts["build:css"] ?? "").split(/\s+/u);
        const output = args.indexOf("-o") + 1;
        expect(args[output]).toBe(DIST);
        const fresh = join(tmp, "nb-ui.css");
        args[output] = fresh;
        // 和 `bun run` 一样从包与仓库根的 node_modules/.bin 找命令，不经 bun x（找不到时会去网上下载）。
        const path = [join(packageRoot, "node_modules", ".bin"), join(repoRoot, "node_modules", ".bin"), process.env.PATH ?? ""].join(delimiter);
        const built = spawnSync(command, args, {cwd: packageRoot, encoding: "utf8", env: {...process.env, PATH: path}});
        expect(built.status, built.stderr).toBe(0);
        // 只比相等：产物有 100 多 KB，不让失败时把整份差异打出来。
        expect(readFileSync(fresh, "utf8") === readFileSync(join(packageRoot, DIST), "utf8"), "dist/nb-ui.css 过期：运行 bun run build:css 并提交").toBe(true);
    }, 60_000);
});
