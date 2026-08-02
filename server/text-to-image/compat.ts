import path from "node:path";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {
    normalizeProjectRoot,
    projectWorkspaceRef,
    resolveProjectWorkspaceRoot,
    type ProjectWorkspaceRef,
} from "nbook/server/workspace-files/project-identity";
import {absoluteFsPath, resolveContainedFilePath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {PROJECT_FILE_INDEX_MODULE_TOKEN} from "nbook/server/workspace-files/project-file-index";
import {
    isProjectNotOpenError,
    requireReadyModuleHandle,
    requireReadyProject,
} from "nbook/server/workspace-files/project-session";
import {PROJECT_HISTORY_MODULE_TOKEN, type ProjectHistoryHandle} from "nbook/server/workspace-history/project-history";

/**
 * 把形如 `workspace/<slug>` 的文生图 projectPath 解析为上游 Project 生命周期接受的
 * `ProjectWorkspaceRef`。旧 `normalizeProjectPath`/`requireReadyProjectPath` 随上游
 * project-path 模块删除，text-to-image 统一经此适配上游 project-identity 架构。
 */
export function textToImageProjectRef(projectPath: string): ProjectWorkspaceRef {
    const normalized = projectPath.replaceAll("\\", "/");
    if (!normalized.startsWith("workspace/")) {
        throw new Error("projectPath 必须形如 workspace/<project>");
    }
    const slug = normalized.slice("workspace/".length);
    if (!slug || slug.includes("/")) {
        throw new Error("projectPath 必须形如 workspace/<project>");
    }
    return projectWorkspaceRef(normalizeProjectRoot(slug));
}

export function resolveProjectAbsolutePath(projectPath: string): string {
    return resolveProjectWorkspaceRoot(resolveRuntimeWorkspaceRoot(), textToImageProjectRef(projectPath));
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
        const ready = requireReadyProject(textToImageProjectRef(projectPath));
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
        const ready = requireReadyProject(textToImageProjectRef(projectPath));
        return requireReadyModuleHandle(ready, PROJECT_HISTORY_MODULE_TOKEN);
    } catch (error) {
        if (isProjectNotOpenError(error)) {
            return null;
        }
        throw error;
    }
}
