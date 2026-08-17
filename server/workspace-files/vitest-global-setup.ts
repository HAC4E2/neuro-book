import {mkdir} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import {resolve} from "node:path";
import {resolveAgentTempRoot, resolveAgentTestRoot, resolveSystemTempRoot} from "nbook/scripts/utils/agent-paths";
import {
    removeMarkedTmpRoot,
    sweepStaleTmpRoots,
    TMP_MARKER_FILE,
    TMP_MARKER_SCHEMA_VERSION,
    writeTmpMarker,
} from "nbook/server/workspace-files/test-tmp-sweep";

/**
 * 受控测试临时根的 run 级清理（仓库级 Vitest globalSetup）。
 *
 * setup 只回收 `<agent-root>/vitest/` 下带合法 marker、owner 已退出且超过 24 小时的 root；
 * teardown 只删除本次 run 的 marker-owned root。未知目录、symlink 和不完整 marker 一律保留。
 */
let runRoot: string | null = null;
export async function setup(): Promise<void> {
    const hostSystemTempRoot = resolveSystemTempRoot();
    const configuredAgentRoot = resolveAgentTempRoot();
    process.env.NBOOK_HOST_SYSTEM_TEMP_ROOT = hostSystemTempRoot;
    process.env.NBOOK_AGENT_TEMP_ROOT = configuredAgentRoot;
    const configuredRunId = process.env.NBOOK_TEST_RUN_ID?.trim();
    const runId = configuredRunId && /^[a-f0-9]{8}$/u.test(configuredRunId)
        ? configuredRunId
        : randomBytes(4).toString("hex");
    process.env.NBOOK_TEST_RUN_ID = runId;
    const agentRoot = resolveAgentTempRoot();
    const vitestRoot = resolve(agentRoot, "vitest");
    await mkdir(vitestRoot, {recursive: true});
    const report = await sweepStaleTmpRoots(vitestRoot);
    if (report.retained.length > 0 || report.failures.length > 0) {
        console.warn(`[vitest-tmp-sweep] ${JSON.stringify(report)}`);
    }
    runRoot = resolveAgentTestRoot(runId);
    await mkdir(runRoot, {recursive: true});
    await writeTmpMarker(runRoot, {
        schemaVersion: TMP_MARKER_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        pid: process.pid,
        runId,
        purpose: "vitest-run",
    });
}

export async function teardown(): Promise<void> {
    const currentRoot = runRoot;
    runRoot = null;
    if (!currentRoot) return;
    try {
        await removeMarkedTmpRoot(currentRoot, resolve(currentRoot, TMP_MARKER_FILE));
    } catch (error) {
        console.error(`[vitest-tmp-teardown] ${error instanceof Error ? error.message : String(error)}`);
    }
}
