import {execFile} from "node:child_process";
import {promisify} from "node:util";

import {describe, expect, it} from "vitest";

const execFileAsync = promisify(execFile);

describe("Product bundle plugins", () => {
    it("统一静态化pi-ai已知loader，只保留auth context opaque seam", async () => {
        const probe = await execFileAsync("bun", ["-e", BUN_PLUGIN_PROBE], {
            cwd: process.cwd(),
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
        });
        const result = JSON.parse(probe.stdout) as {opaqueImports: number; specifiers: string[]};

        expect(result.opaqueImports).toBe(1);
        expect(result.specifiers).toEqual(expect.arrayContaining([
            "fs",
            "os",
            "path",
            "./bedrock-converse-stream.js",
            "./anthropic.js",
            "./openai-codex.js",
            "./github-copilot.js",
        ]));
    });
});

const BUN_PLUGIN_PROBE = String.raw`
import {resolve} from "node:path";
import {init, parse} from "es-module-lexer";
import {productPiAiImportPlugin} from "nbook/scripts/build/product-bundle-plugins";
await init;
const result = await Bun.build({
    entrypoints: [
        resolve("node_modules/@earendil-works/pi-ai/dist/auth/context.js"),
        resolve("node_modules/@earendil-works/pi-ai/dist/env-api-keys.js"),
        resolve("node_modules/@earendil-works/pi-ai/dist/api/bedrock-converse-stream.lazy.js"),
        resolve("node_modules/@earendil-works/pi-ai/dist/utils/oauth/load.js"),
    ],
    target: "bun",
    format: "esm",
    minify: true,
    sourcemap: "none",
    plugins: [productPiAiImportPlugin()],
    external: ["*"],
});
if (!result.success) throw new Error(result.logs.map((log) => log.message).join("\\n"));
const imports = [];
for (const output of result.outputs) {
    const [outputImports] = parse(await output.text());
    imports.push(...outputImports);
}
console.log(JSON.stringify({
    opaqueImports: imports.filter((item) => !item.n && item.d >= 0).length,
    specifiers: imports.flatMap((item) => item.n ?? []),
}));
`;
