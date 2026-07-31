import {defineNitroPlugin} from "nitropack/runtime";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {
    ApplicationStateMigrationRequiredError,
    ApplicationStateSentinelCorruptError,
    assertApplicationStateReady,
} from "nbook/server/runtime/application-state";
import {
    AgentSessionMigrationRequiredError,
    AgentSessionRecoveryRequiredError,
    AgentSessionStoreCorruptError,
} from "nbook/server/agent/session/agent-session-store";
import {startAgentSessionStoreRuntime} from "nbook/server/agent/session/agent-session-store-runtime";

/** 在任何 Agent Harness 可创建前取得 Session Store lease 并验证 complete v2 sentinel。 */
export default defineNitroPlugin(async () => {
    const {workspaceRoot} = runtimePathsFromEnv();
    try {
        await assertApplicationStateReady(workspaceRoot);
        await startAgentSessionStoreRuntime(workspaceRoot);
    } catch (error) {
        if (error instanceof ApplicationStateMigrationRequiredError
            || error instanceof ApplicationStateSentinelCorruptError
            || error instanceof AgentSessionMigrationRequiredError
            || error instanceof AgentSessionRecoveryRequiredError
            || error instanceof AgentSessionStoreCorruptError) {
            throw new Error(
                `${error.message}\n非 Manager 启动请先执行：bun run migrate:application-state -- --apply`,
                {cause: error},
            );
        }
        throw error;
    }
});
