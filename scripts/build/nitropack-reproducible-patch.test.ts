import {execFile} from "node:child_process";
import {readdir, readFile, realpath} from "node:fs/promises";
import {join, resolve} from "node:path";
import {promisify} from "node:util";
import {describe, expect, it} from "vitest";

const execFileAsync = promisify(execFile);
const corePath = resolve("node_modules", "nitropack", "dist", "core", "index.mjs");
const rollupPath = resolve("node_modules", "nitropack", "dist", "rollup", "index.mjs");
const patchPath = resolve("patches", "nitropack@2.13.4.patch");
const publicMtime = "mtime: process.env.SOURCE_DATE_EPOCH === void 0 ? stat.mtime.toJSON() : void 0";
const serverMtime = "const mtime = process.env.SOURCE_DATE_EPOCH === void 0 ? await promises.stat(fsPath).then((s) => s.mtime.toJSON()) : void 0;";
const stableOrder = "Object.entries(assets).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)";

describe("Nitro 可复现构建 patch", () => {
    it("使用与前序增量一致的 unified diff 坐标", async () => {
        const patch = await readFile(patchPath, "utf8");

        expect(patch).toContain("@@ -1280,7 +1280,10 @@ function publicAssets(nitro) {");
        expect(patch).toContain("@@ -1496,7 +1499,7 @@ function serverAssets(nitro) {");
    });

    it("安装后的发布模块保持为合法 JavaScript", async () => {
        const packageRoots = new Set([resolve("node_modules", "nitropack")]);
        const bunPackageStore = resolve("node_modules", ".bun");
        for (const name of await readdir(bunPackageStore)) {
            if (name.startsWith("@nuxt+nitro-server@")) {
                packageRoots.add(await realpath(join(bunPackageStore, name, "node_modules", "nitropack")));
            }
        }
        const patchedModules = [
            join("dist", "runtime", "internal", "error", "dev.mjs"),
            join("dist", "core", "index.mjs"),
            join("dist", "rollup", "index.mjs"),
        ];

        for (const packageRoot of packageRoots) {
            for (const modulePath of patchedModules) {
                const path = join(packageRoot, modulePath);
                const result = await execFileAsync(process.execPath, ["--check", path]);
                expect(result.stderr).toBe("");
            }
            const rollup = await readFile(join(packageRoot, "dist", "rollup", "index.mjs"), "utf8");
            expect(rollup).toContain(stableOrder);
            expect(rollup).toContain(serverMtime);
            expect(rollup).not.toContain("JSON.stringify(assets, null, 2)");
        }
    });

    it("使用 SOURCE_DATE_EPOCH 固定 production 与 dev build info 日期", async () => {
        const [core, patch] = await Promise.all([
            readFile(corePath, "utf8"),
            readFile(patchPath, "utf8"),
        ]);

        expect(core).toContain("const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;");
        expect(core).toContain("SOURCE_DATE_EPOCH must be a non-negative integer number of seconds");
        expect(core).toContain("SOURCE_DATE_EPOCH is outside the supported date range");
        expect(core.match(/date: buildDate\(\)/gu)).toHaveLength(2);

        expect(patch).toContain("+  const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;");
        expect(patch.match(/^\+\s+date: buildDate\(\),$/gmu)).toHaveLength(2);
    });

    it("可复现模式省略 public/server asset mtime，但继续按内容生成 etag", async () => {
        const [rollup, patch] = await Promise.all([
            readFile(rollupPath, "utf8"),
            readFile(patchPath, "utf8"),
        ]);
        expect(rollup).toContain(publicMtime);
        expect(rollup).toContain(serverMtime);
        expect(rollup).toContain("const etag = createEtag(assetData);");
        expect(rollup).toContain("const etag = createEtag(await promises.readFile(fsPath));");
        expect(rollup).toContain(`if (type.startsWith("text")) {
              type += "; charset=utf-8";
            }
            const etag = createEtag(await promises.readFile(fsPath));
            ${serverMtime}
            assets[id].meta = { type, etag, mtime };`);

        expect(patch).toContain(`+              ${publicMtime},`);
        expect(patch).toContain(`+            ${serverMtime}`);
    });

    it("并发读取 public assets 后按资源路径稳定序列化", async () => {
        const [rollup, patch] = await Promise.all([
            readFile(rollupPath, "utf8"),
            readFile(patchPath, "utf8"),
        ]);
        expect(rollup).toContain(stableOrder);
        expect(rollup.match(/JSON\.stringify\(sortedAssets, null, 2\)/gu)).toHaveLength(1);
        expect(rollup).not.toContain("JSON.stringify(assets, null, 2)");
        expect(patch).toContain(`+          ${stableOrder}`);
    });
});
