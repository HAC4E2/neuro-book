import path from "node:path";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {normalizeProjectPath as np, resolveProjectWorkspaceRoot as resolveRoot} from "nbook/server/workspace-files/project-path";
import {absoluteFsPath, resolveContainedFilePath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {PROJECT_FILE_INDEX_MODULE_TOKEN} from "nbook/server/workspace-files/project-file-index";
import {
    isProjectNotOpenError,
    requireReadyModuleHandle,
    requireReadyProjectPath,
} from "nbook/server/workspace-files/project-session";
import {PROJECT_HISTORY_MODULE_TOKEN, type ProjectHistoryHandle} from "nbook/server/workspace-history/project-history";

export function resolveProjectAbsolutePath(projectPath: string): string {
    return resolveRoot(resolveRuntimeWorkspaceRoot(), np(projectPath));
}

export {absoluteFsPath};

export async function resolveWorkspaceRootInput(
    input: {projectPath?: string; workspaceKind?: string},
): Promise<string> {
    return input.projectPath
        ? resolveProjectAbsolutePath(input.projectPath)
        : resolveRuntimeWorkspaceRoot();
}

/** 解析全局 Agent Profile Home 使用的 Workspace Root `.nbook`。 */
export function resolveGlobalProfileNbookRoot(workspaceRoot?: string): AbsoluteFsPath {
    const root = workspaceRoot
        ? absoluteFsPath(path.resolve(workspaceRoot))
        : resolveRuntimeWorkspaceRoot();
    return resolveContainedFilePath(root, ".nbook");
}

/**
 * 失效当前已打开 Project 的 workspace 树索引。
 * Project 已关闭时静默跳过：没有活跃索引可失效，下次 open 会全量重建。
 */
export function invalidateProjectTreeIndex(projectPath: string): void {
    try {
        const ready = requireReadyProjectPath(np(projectPath));
        requireReadyModuleHandle(ready, PROJECT_FILE_INDEX_MODULE_TOKEN).invalidate();
    } catch (error) {
        if (isProjectNotOpenError(error)) {
            return;
        }
        throw error;
    }
}

/**
 * 取当前已打开 Project generation 的 History handle。
 * Project 已关闭时返回 null：后台落盘按记账 fail-open 语义跳过，由 watcher 对账收敛为 external。
 */
export function tryReadyProjectHistoryHandle(projectPath: string): ProjectHistoryHandle | null {
    try {
        const ready = requireReadyProjectPath(np(projectPath));
        return requireReadyModuleHandle(ready, PROJECT_HISTORY_MODULE_TOKEN);
    } catch (error) {
        if (isProjectNotOpenError(error)) {
            return null;
        }
        throw error;
    }
}
