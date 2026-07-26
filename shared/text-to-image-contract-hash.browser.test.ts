import path from "node:path";

import {build} from "esbuild";
import {describe, expect, it} from "vitest";

describe("text-to-image contract hash browser boundary", () => {
    it("bundles without Node built-in modules", async () => {
        const result = await build({
            entryPoints: [path.resolve("shared/text-to-image-contract-hash.ts")],
            bundle: true,
            format: "esm",
            platform: "browser",
            write: false,
            logLevel: "silent",
        });

        expect(result.outputFiles).toHaveLength(1);
    });
});
