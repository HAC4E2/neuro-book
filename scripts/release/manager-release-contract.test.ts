import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

import {describe, expect, it} from "vitest";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

type RootPackage = {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
};

type GeneratedTsConfig = {
    extends?: string;
    compilerOptions: {
        module: string;
        moduleResolution: string;
    };
};

describe("Manager release clean-checkout contract", () => {
    it("Runtime typecheck self-prepares Prisma and directly owns imported mdast types", async () => {
        const packageJson = JSON.parse(
            await readFile(resolve(ROOT, "package.json"), "utf8"),
        ) as RootPackage;
        const generatedTsConfig = JSON.parse(
            (await readFile(resolve(ROOT, "server", "generated", "tsconfig.json"), "utf8"))
                .replace(/^\s*\/\/.*$/gmu, ""),
        ) as GeneratedTsConfig;

        expect(packageJson.scripts["runtime:typecheck"]).toMatch(/^bun run generate && /u);
        expect(packageJson.scripts["manager:test"]).toContain("scripts/release/manager-release-contract.test.ts");
        expect(packageJson.devDependencies["@types/mdast"]).toBeTruthy();
        expect(generatedTsConfig.extends).toBeUndefined();
        expect(generatedTsConfig.compilerOptions).toMatchObject({
            module: "ESNext",
            moduleResolution: "Bundler",
        });
    });
});
