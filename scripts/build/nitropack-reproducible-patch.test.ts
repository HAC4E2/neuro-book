import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";

const corePath = resolve("node_modules", "nitropack", "dist", "core", "index.mjs");
const rollupPath = resolve("node_modules", "nitropack", "dist", "rollup", "index.mjs");
const patchPath = resolve("patches", "nitropack@2.13.4.patch");

describe("Nitro 可复现构建 patch", () => {
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
        const publicMtime = "mtime: process.env.SOURCE_DATE_EPOCH === void 0 ? stat.mtime.toJSON() : void 0";
        const serverMtime = "const mtime = process.env.SOURCE_DATE_EPOCH === void 0 ? await promises.stat(fsPath).then((s) => s.mtime.toJSON()) : void 0;";

        expect(rollup).toContain(publicMtime);
        expect(rollup).toContain(serverMtime);
        expect(rollup).toContain("const etag = createEtag(assetData);");
        expect(rollup).toContain("const etag = createEtag(await promises.readFile(fsPath));");

        expect(patch).toContain(`+              ${publicMtime},`);
        expect(patch).toContain(`+            ${serverMtime}`);
    });

    it("并发读取 public assets 后按资源路径稳定序列化", async () => {
        const [rollup, patch] = await Promise.all([
            readFile(rollupPath, "utf8"),
            readFile(patchPath, "utf8"),
        ]);
        const stableOrder = "Object.entries(assets).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)";

        expect(rollup).toContain(stableOrder);
        expect(rollup).toContain("JSON.stringify(sortedAssets, null, 2)");
        expect(patch).toContain(`+          ${stableOrder}`);
    });
});
