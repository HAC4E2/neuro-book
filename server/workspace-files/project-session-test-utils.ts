import {closeProject, openProject} from "nbook/server/workspace-files/project-session";
import {isProjectLifecycleError} from "nbook/server/workspace-files/project-identity";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";

/**
 * 测试专用：按后台 job opener 打开 Project，会触发 openProject 的目录校验与一次性数据库初始化。
 */
export async function openProjectForTest(projectPath: string): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            await openProject(resolveRuntimeWorkspaceRoot(), projectPath, {kind: "job", source: "test"});
            return;
        } catch (error) {
            // 测试通常先直接搭建fixture再open；Workspace Root watcher可能仍在收敛这批已完成写入。
            if (!isProjectLifecycleError(error) || error.code !== "PROJECT_ROOT_REPLACED" || attempt === 4) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
}

/**
 * 测试专用：关闭 Project 会话并释放所有 Project 级资源。
 */
export async function closeProjectForTest(projectPath: string): Promise<void> {
    await closeProject(projectPath, "shutdown");
}
