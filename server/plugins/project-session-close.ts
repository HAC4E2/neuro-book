import {defineNitroPlugin} from "nitropack/runtime";
import {closeAllProjects} from "nbook/server/workspace-files/project-session";
import {closeAllWorkspaceTreeIndexes} from "nbook/server/workspace-files/project-workspace-index";
import {disposeAgentHarness} from "nbook/server/agent/http";

/**
 * 服务关停时按所有权顺序关闭Agent、ProjectSession与最终File Index cache。
 * 即使前一步失败也继续尝试后续资源，最后统一报告全部关闭错误。
 */
export default defineNitroPlugin((nitroApp) => {
    nitroApp.hooks.hook("close", async () => {
        const failures: Error[] = [];
        const closeSteps: ReadonlyArray<() => Promise<void>> = [
            disposeAgentHarness,
            closeAllProjects,
            closeAllWorkspaceTreeIndexes,
        ];
        for (const close of closeSteps) {
            try {
                await close();
            } catch (error) {
                failures.push(error instanceof Error ? error : new Error(String(error)));
            }
        }
        if (failures.length > 0) {
            throw new AggregateError(failures, "Project runtime关闭不完整");
        }
    });
});
