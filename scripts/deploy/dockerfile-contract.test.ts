import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";

describe("Docker Product runtime contract", () => {
    it("最终 Product tsconfig 写入后重新编译 system assets", async () => {
        const [dockerfile, productRuntime] = await Promise.all([
            readFile(resolve("Dockerfile"), "utf8"),
            readFile(resolve("scripts", "deploy", "product-runtime.mjs"), "utf8"),
        ]);
        const tsconfigPatch = dockerfile.indexOf("fs.writeFileSync(\"tsconfig.json\"");
        const systemAssetsPrepare = dockerfile.indexOf("RUN bun .output/server/scripts/build/prepare-system-assets.ts --force --product-build");
        const entrypoint = dockerfile.indexOf("ENTRYPOINT");

        expect(tsconfigPatch).toBeGreaterThan(-1);
        expect(systemAssetsPrepare).toBeGreaterThan(tsconfigPatch);
        expect(entrypoint).toBeGreaterThan(systemAssetsPrepare);
        expect(productRuntime).toContain('"--force", "--product-build"');
    });
});
