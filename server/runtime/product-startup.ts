import {mkdir} from "node:fs/promises";

import {appLogger} from "nbook/server/app-logs/logger";
import {
    AgentSessionMigrationRequiredError,
    AgentSessionRecoveryRequiredError,
    AgentSessionStoreCorruptError,
} from "nbook/server/agent/session/agent-session-store";
import {startAgentSessionStoreRuntime} from "nbook/server/agent/session/agent-session-store-runtime";
import {assertProductMigrationsReady} from "nbook/server/runtime/product-migration-gate";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {
    inspectStateRootIntegrity,
    stateRootIntegrityFailed,
} from "nbook/server/runtime/state-root-integrity";

let startup: Promise<void> | null = null;

/**
 * 完成 Product 的异步启动门禁。
 *
 * 顺序是合同的一部分：Workspace Root 必须先存在，migration 必须先于任何
 * Session Store lease，最终 ready 才能表示 Agent HTTP 能力可用。
 */
export async function prepareProductRuntime(): Promise<void> {
    const runtimePaths = runtimePathsFromEnv();
    await mkdir(runtimePaths.workspaceRoot, {recursive: true});

    const stateIntegrity = await inspectStateRootIntegrity({
        installationRoot: runtimePaths.applicationRoot,
        stateRoot: runtimePaths.stateRoot,
    });
    if (stateRootIntegrityFailed(stateIntegrity)) {
        void appLogger.warn(
            "runtime.stateRoot.integrityFailed",
            {stateIntegrity},
            stateIntegrity.kind === "shadow-workspace"
                ? "检测到Installation Root与State Root存在Workspace Root数据分叉；应用不会自动处理用户数据"
                : "无法验证Installation Root与State Root的Workspace Root关系；应用不会自动处理用户数据",
        );
    }

    await assertProductMigrationsReady();
    try {
        await startAgentSessionStoreRuntime(runtimePaths.workspaceRoot);
    } catch (error) {
        if (error instanceof AgentSessionMigrationRequiredError
            || error instanceof AgentSessionRecoveryRequiredError
            || error instanceof AgentSessionStoreCorruptError) {
            throw new Error(
                `${error.message}\n非 Manager 启动请先执行：bun run migrate:application-state -- --apply`,
                {cause: error},
            );
        }
        throw error;
    }
}

/**
 * 返回进程级唯一启动结果；Nitro middleware 与并发首批请求共享同一个 Promise。
 */
export function productRuntimeReady(): Promise<void> {
    if (!startup) startup = prepareProductRuntime();
    return startup;
}
