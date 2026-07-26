import path from "node:path";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {normalizeProjectPath as np, resolveProjectWorkspaceRoot as resolveRoot} from "nbook/server/workspace-files/project-path";
import {absoluteFsPath, resolveContainedFilePath} from "nbook/server/runtime/paths/file-path";

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
export function resolveGlobalProfileNbookRoot(workspaceRoot?: string): string {
    const root = workspaceRoot
        ? absoluteFsPath(path.resolve(workspaceRoot))
        : resolveRuntimeWorkspaceRoot();
    return resolveContainedFilePath(root, ".nbook");
}
