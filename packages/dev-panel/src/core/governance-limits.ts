import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {systemErrorCode} from "./errors.js";

export {countNonEmptyLines} from "./text-rules.js";

/**
 * 根级治理入口的非空行上限：面板编辑这几份文件时提醒，改超了 master 当场过不了 `governance:check`。
 * 上限的真相源是仓库的治理检查；这里按文本解析那一段常量，不执行仓库脚本（它依赖根上的包），
 * 根测试 `scripts/ci/dev-panel-records.test.ts` 核对解析结果与治理检查导出的常量一致。
 */
export const GOVERNANCE_CONTRACT_PATH = "scripts/ci/agent-governance-contract.ts";

export function parseGovernanceLineLimits(text: string): Record<string, number> | null {
    const block = /GOVERNANCE_NON_EMPTY_LINE_LIMITS\s*=\s*\{([^}]*)\}/u.exec(text);
    if (!block) return null;
    const limits: Record<string, number> = {};
    for (const entry of block[1]!.matchAll(/["']([^"']+)["']\s*:\s*(\d+)/gu)) limits[entry[1]!] = Number(entry[2]);
    return Object.keys(limits).length > 0 ? limits : null;
}

/** 仓库里没有这份治理检查（例如测试用的临时仓库）时为 null，界面就不提醒。 */
export async function readGovernanceLineLimits(mainRoot: string): Promise<Record<string, number> | null> {
    try {
        return parseGovernanceLineLimits(await readFile(resolve(mainRoot, GOVERNANCE_CONTRACT_PATH), "utf8"));
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return null;
        throw error;
    }
}
