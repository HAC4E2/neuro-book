import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 正常运行路径中禁止出现的逗号拆分触发词实现形态。 */
const FORBIDDEN_PATTERNS: RegExp[] = [
    /\.split\(\s*["'`]?\s*[,，]/u,
    /\.split\(\s*\/[^/]*[,，]/u,
];

/** 运行时模块：正常保存、解析、扫描与 API 路径。 */
const RUNTIME_FILES = [
    "server/text-to-image/character-trigger-words.ts",
    "server/text-to-image/body-character-scanner.ts",
    "server/text-to-image/body-prompt-compiler.ts",
    "server/text-to-image/character-visual.codec.ts",
    "server/text-to-image/character-visual.service.ts",
    "server/text-to-image/character-visual-library.service.ts",
    "server/text-to-image/character-visual-llm.ts",
    "server/api/text-to-image/body-prompts.post.ts",
    "server/api/text-to-image/character-library/visual.put.ts",
    "server/api/text-to-image/character-visual.put.ts",
];

/** 一次性迁移模块：旧逗号拆分只允许存在于该文件内，且不得导出。 */
const MIGRATION_FILE = "server/text-to-image/trigger-words-migration.ts";

describe("触发词源码门禁", () => {
    it("运行时模块不存在逗号拆分或宽松分隔符解析", async () => {
        for (const file of RUNTIME_FILES) {
            const source = await fs.readFile(path.join(ROOT, file), "utf8");
            for (const pattern of FORBIDDEN_PATTERNS) {
                expect(pattern.test(source), `${file} 不得出现逗号触发词拆分`).toBe(false);
            }
        }
    });

    it("旧逗号迁移逻辑只存在于一次性迁移模块且未导出", async () => {
        const source = await fs.readFile(path.join(ROOT, MIGRATION_FILE), "utf8");
        expect(FORBIDDEN_PATTERNS.some((pattern) => pattern.test(source))).toBe(true);

        const moduleExports = await import("nbook/server/text-to-image/trigger-words-migration");
        const exportedNames = Object.keys(moduleExports).filter((name) => /[Ll]egacy|[Cc]omma/u.test(name));
        expect(exportedNames).toEqual([]);
        // 迁移模块只公开迁移与恢复入口，不提供可被保存/扫描路径导入的解析函数。
        expect(Object.keys(moduleExports).sort()).toEqual([
            "migrateProjectTriggerWords",
            "recoverTriggerWordsMigrationJournal",
        ]);
    });
});
