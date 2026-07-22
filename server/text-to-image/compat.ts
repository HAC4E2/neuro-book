import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {normalizeProjectPath as np, resolveProjectWorkspaceRoot as resolveRoot} from "nbook/server/workspace-files/project-path";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";

export function resolveProjectAbsolutePath(projectPath: string): string {
    return resolveRoot(resolveRuntimeWorkspaceRoot(), np(projectPath));
}

export {absoluteFsPath};

export async function resolveWorkspaceRootInput(
    _input: {projectPath?: string; workspaceKind?: string},
): Promise<string> {
    return resolveRuntimeWorkspaceRoot();
}
