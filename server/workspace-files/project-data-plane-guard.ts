import {isAbsolute} from "node:path";
import {
    assertProjectOpen,
    markProjectActivity,
    requireReadyProjectPath,
    runReadyProjectOperation,
} from "nbook/server/workspace-files/project-session";
import type {ResolvedFileAddress} from "nbook/server/workspace-files/file-scope";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import {WORKSPACE_NBOOK_ROOT} from "nbook/server/workspace-files/workspace-root-ref";

const MANAGED_PROJECT_PATH_PATTERN = /^workspace\/[^/]+$/u;

/**
 * 解析受 ProjectSession 管理的 Project Path。只有 workspace/<slug> 归一形纳入显式生命周期模型；
 * `workspace/.nbook` 是 user-assets（Workspace Root .nbook），属控制面资源而非 Project，恒排除。
 */
export function managedProjectPath(projectPathInput: string | undefined): string | null {
    const projectPath = projectPathInput?.trim().replaceAll("\\", "/").replace(/\/+$/u, "") ?? "";
    if (!projectPath || isAbsolute(projectPath) || !MANAGED_PROJECT_PATH_PATTERN.test(projectPath)) {
        return null;
    }
    if (projectPath === WORKSPACE_NBOOK_ROOT) {
        return null;
    }
    return projectPath;
}

/**
 * Project Workspace 数据面守卫。外部绝对路径、Workspace Root、user-assets 与旧式非 managed path 不属于当前 ProjectSession。
 */
export function assertManagedProjectDataPlaneOpen(projectPathInput: string | undefined): void {
    const projectPath = managedProjectPath(projectPathInput);
    if (!projectPath) {
        return;
    }
    assertProjectOpen(projectPath);
    markProjectActivity(projectPath);
}

/** 一次文件操作已经同步捕获并登记的全部 Project generation，key 为规范化 Project Path。 */
export type ProjectFileOperationProjects = ReadonlyMap<string, ReadyProjectSessionRef>;

/**
 * 在文件地址解析后、任何文件 I/O 前，为地址所属 Project generation 登记数据面操作。
 *
 * 多文件 patch 可以同时触及多个 Project；这里先同步捕获全部 exact ready，再按 Project
 * 去重嵌套登记。close 不会等待锁，而只等待这些 Promise settle，因此同 generation 重入也
 * 不会死锁。plain Workspace、user-assets 与外部绝对地址不属于 ProjectSession，直接执行。
 */
export function runProjectFileOperation<TResult>(
    addresses: readonly ResolvedFileAddress[],
    operation: (projects: ProjectFileOperationProjects) => Promise<TResult>,
): Promise<TResult> {
    const projects = new Map<string, ReadyProjectSessionRef>();
    for (const address of addresses) {
        const projectPath = address.projectPath;
        if (!projectPath || isAbsolute(projectPath) || projects.has(projectPath)) {
            continue;
        }
        projects.set(projectPath, requireReadyProjectPath(projectPath));
    }

    const readyProjects = [...projects.values()];
    const enter = (index: number): Promise<TResult> => {
        const ready = readyProjects[index];
        if (!ready) {
            return operation(projects);
        }
        return runReadyProjectOperation(ready, async () => enter(index + 1));
    };
    return enter(0);
}
