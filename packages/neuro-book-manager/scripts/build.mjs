import {copyFile, mkdir, rm} from "node:fs/promises";
import {resolve} from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const outdir = resolve(packageRoot, "dist");

await rm(outdir, {recursive: true, force: true});
await mkdir(outdir, {recursive: true});
const result = await Bun.build({
    entrypoints: [
        resolve(packageRoot, "src", "neuro-book.ts"),
        resolve(packageRoot, "src", "schema.ts"),
        resolve(packageRoot, "src", "runtime-projection.ts"),
        resolve(packageRoot, "src", "desktop-installation-entry.ts"),
        resolve(packageRoot, "src", "desktop-uac-client-entry.ts"),
        resolve(packageRoot, "src", "product-runtime-verifier-entry.ts"),
        resolve(packageRoot, "src", "installation-entry.ts"),
        resolve(packageRoot, "src", "portable.ts"),
    ],
    outdir,
    target: "bun",
    format: "esm",
    naming: "[name].mjs",
    external: ["yaml", "semver"],
    minify: true,
});
if (!result.success) {
    for (const log of result.logs) {
        console.error(log);
    }
    process.exit(1);
}
await copyFile(resolve(packageRoot, "..", "..", "LICENSE"), resolve(outdir, "LICENSE"));
