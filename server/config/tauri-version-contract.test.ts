import {readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";

type PackageManifest = {version: string};
type TauriManifest = {version: string};

describe("Tauri Windows 版本合同", () => {
    it("应用、Tauri 配置与 Cargo 使用同一版本，且不保留旧的 0.4.2", async () => {
        const [packageText, tauriText, cargoText] = await Promise.all([
            readFile("package.json", "utf8"),
            readFile("src-tauri/tauri.conf.json", "utf8"),
            readFile("src-tauri/Cargo.toml", "utf8"),
        ]);
        const packageVersion = (JSON.parse(packageText) as PackageManifest).version;
        const tauriVersion = (JSON.parse(tauriText) as TauriManifest).version;
        const cargoVersion = /^version\s*=\s*"([^"]+)"/mu.exec(cargoText)?.[1] ?? "";

        expect(packageVersion).not.toBe("0.4.2");
        expect(tauriVersion).toBe(packageVersion);
        expect(cargoVersion).toBe(packageVersion);
    });

    it("Portable 组装在删除 Product 前只移除运行时 workspace junction 本身", async () => {
        const source = await readFile("scripts/deploy/tauri-portable.mjs", "utf8");
        const removeWorkspace = 'await rmdir(join(stageRoot, "product", "workspace"));';
        const removeProduct = 'await rm(join(stageRoot, "product"), {recursive: true, force: true});';

        expect(source.indexOf(removeWorkspace)).toBeGreaterThanOrEqual(0);
        expect(source.indexOf(removeWorkspace)).toBeLessThan(source.indexOf(removeProduct));
    });
});
