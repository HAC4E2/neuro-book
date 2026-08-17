import {mkdirSync} from "node:fs";
import {randomBytes} from "node:crypto";
import {resolveAgentScratchPath, resolveAgentTempRoot, resolveAgentTestRoot, resolveSystemTempRoot} from "nbook/scripts/utils/agent-paths";

/**
 * 受控测试临时根（仓库级 Vitest setup）。
 *
 * setup 必须是各 Vitest 配置的第一项：先解析 Agent 根，再把 Node/Bun 的临时
 * 环境变量收敛到本次 run。这样测试内的 `os.tmpdir()` 和 `mkdtemp(tmpdir())`
 * 都不会写回仓库或系统 Temp 顶层。
 */
const hostSystemTempRoot = resolveSystemTempRoot();
const configuredAgentRoot = resolveAgentTempRoot();
process.env.NBOOK_HOST_SYSTEM_TEMP_ROOT = hostSystemTempRoot;
process.env.NBOOK_AGENT_TEMP_ROOT = configuredAgentRoot;
const configuredRunId = process.env.NBOOK_TEST_RUN_ID;
const RUN_ID = configuredRunId && /^[a-f0-9]{8}$/u.test(configuredRunId)
    ? configuredRunId
    : randomBytes(4).toString("hex");
const CONTROLLED_TMP_ROOT = resolveAgentTestRoot(RUN_ID);
mkdirSync(CONTROLLED_TMP_ROOT, {recursive: true});
mkdirSync(resolveAgentScratchPath("test-paths"), {recursive: true});

process.env.NBOOK_TEST_RUN_ID = RUN_ID;
process.env.TMPDIR = CONTROLLED_TMP_ROOT;
process.env.TEMP = CONTROLLED_TMP_ROOT;
process.env.TMP = CONTROLLED_TMP_ROOT;
process.env.NBOOK_TEST_TMPDIR = CONTROLLED_TMP_ROOT;
