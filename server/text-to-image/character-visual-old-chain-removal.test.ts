import {readdir, readFile, stat} from "node:fs/promises";
import path from "node:path";
import {describe, expect, it} from "vitest";

const FROZEN_DELETED_PATHS = [
    "shared/text-to-image-character-migration.ts",
    "shared/text-to-image-character-source.ts",
    "server/text-to-image/character-visual-migration.ts",
    "server/text-to-image/character-visual-migration.test.ts",
    "server/text-to-image/character-visual-migration.service.ts",
    "server/text-to-image/character-visual-migration.service.test.ts",
    "server/text-to-image/character-visual-migration.runtime.ts",
    "server/text-to-image/character-visual-migration-http-error.ts",
    "server/text-to-image/character-visual-migration-ui-contract.test.ts",
    "server/text-to-image/ttp-character-visual-source.ts",
    "server/text-to-image/ttp-character-visual-source.test.ts",
    "server/api/text-to-image/character-visual-migrations",
    "app/components/novel-ide/text-to-image/TextToImageCharacterMigrationPanel.vue",
    "app/components/novel-ide/text-to-image/TextToImageCharacterSourcePanel.vue",
    "app/utils/text-to-image-character-tags.ts",
    "app/utils/text-to-image-character-tags.test.ts",
    "app/utils/text-to-image-outfit-tags.ts",
    "app/utils/text-to-image-outfit-tags.test.ts",
    "app/utils/text-to-image-outfit-design.ts",
    "app/utils/text-to-image-outfit-design.test.ts",
] as const;

const OBSOLETE_TOKENS = [
    "character-visual-migrations",
    "CharacterVisualMigration",
    "CharacterVisualDirectorPreview",
    "CharacterVisualMergeDecision",
    "proposal_ready",
    "director-prepare",
    "source-prepare",
    "propose-character-visual",
    "character-visual-proposals",
    "CHARACTER_VISUAL_MIGRATION_REQUIRED",
] as const;

const PRODUCTION_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".vue"]);

describe("character visual old-chain removal", () => {
    it("removes every frozen old-chain path", async () => {
        const existing: string[] = [];
        for (const relativePath of FROZEN_DELETED_PATHS) {
            if (await pathExists(path.resolve(relativePath))) existing.push(relativePath);
        }
        expect(existing).toEqual([]);
    });

    it("leaves no obsolete production owner", async () => {
        const owners: string[] = [];
        for (const root of ["app", "shared", "server"] as const) {
            for (const filePath of await listProductionSources(path.resolve(root))) {
                const relativePath = normalizePath(path.relative(process.cwd(), filePath));
                const source = await readFile(filePath, "utf8");
                for (const token of OBSOLETE_TOKENS) {
                    if (relativePath.includes(token) || source.includes(token)) {
                        owners.push(`${token}: ${relativePath}`);
                    }
                }
                // `source-preview` 只匹配角色视觉旧 API/owner；Profile Template 的同名 CSS class 合法。
                if (relativePath.includes("character-visual-migrations/source-preview")
                    || (/character-visual-migrations/u.test(source) && /source-preview/u.test(source))) {
                    owners.push(`source-preview: ${relativePath}`);
                }
            }
        }
        expect([...new Set(owners)].sort()).toEqual([]);
    });
});

async function pathExists(targetPath: string): Promise<boolean> {
    return (await stat(targetPath).catch(() => null)) !== null;
}

async function listProductionSources(root: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(root, {withFileTypes: true})) {
        const entryPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "docs") continue;
            files.push(...await listProductionSources(entryPath));
            continue;
        }
        if (!entry.isFile() || !PRODUCTION_EXTENSIONS.has(path.extname(entry.name))) continue;
        if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name)) continue;
        files.push(entryPath);
    }
    return files;
}

function normalizePath(value: string): string {
    return value.replace(/\\/gu, "/");
}
