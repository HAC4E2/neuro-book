import {createError} from "h3";
import {
    isProjectNotOpenError,
    ProjectNotOpenError,
    requireReadyModuleHandle,
    requireReadyProjectPath,
    runReadyProjectOperation,
    startReadyProjectOperation,
    type ProjectOperationStart,
} from "nbook/server/workspace-files/project-session";
import {
    projectWorkspaceRef,
    type ProjectWorkspaceRef,
} from "nbook/server/workspace-files/project-identity";
import {projectSlug} from "nbook/server/workspace-files/project-path";
import {
    PROJECT_FILE_INDEX_MODULE_TOKEN,
    type ProjectFileIndexHandle,
} from "nbook/server/workspace-files/project-file-index";
import {
    PROJECT_HISTORY_MODULE_TOKEN,
    type ProjectHistoryHandle,
} from "nbook/server/workspace-history/project-history";
import {assertManagedProjectDataPlaneOpen} from "nbook/server/workspace-files/project-data-plane-guard";
import type {WorkspaceFileTarget} from "nbook/server/workspace-files/workspace-file-target";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

/** HTTP Project数据面一次捕获的required handles，全部属于同一 ready generation。 */
export type ProjectDataPlaneHandles = Readonly<{
    ready: ReadyProjectSessionRef;
    fileIndex: ProjectFileIndexHandle;
    history: ProjectHistoryHandle;
}>;

/**
 * 路由层Project open守卫：只有明确的Project Workspace目标需要显式open。
 */
export function assertProjectOpenForTarget(target: WorkspaceFileTarget): void {
    try {
        if (target.kind === "project-workspace") {
            assertManagedProjectDataPlaneOpen(target.projectPath);
        }
    } catch (error) {
        if (isProjectNotOpenError(error)) {
            throw createProjectNotOpenHttpError(error);
        }
        throw error;
    }
}

/** Project target一次解析为结构化ref；plain Workspace返回null。 */
export function projectRefForTarget(target: WorkspaceFileTarget): ProjectWorkspaceRef | null {
    return target.kind === "project-workspace"
        ? projectWorkspaceRef(projectSlug(target.projectPath))
        : null;
}

/** Project mutation/read入口一次取得当前generation的required handles；plain target返回undefined。 */
export function projectHandlesForTarget(target: WorkspaceFileTarget): ProjectDataPlaneHandles | undefined {
    if (target.kind !== "project-workspace") {
        return undefined;
    }
    const ready = requireReadyProjectPath(target.projectPath);
    return Object.freeze({
        ready,
        fileIndex: requireReadyModuleHandle(ready, PROJECT_FILE_INDEX_MODULE_TOKEN),
        history: requireReadyModuleHandle(ready, PROJECT_HISTORY_MODULE_TOKEN),
    });
}

/**
 * Phase 7 前的旧 History HTTP seam：字符串 Project Path 只在这里解析一次，
 * 两个 required handle 都绑定到同一个 ready generation。
 */
export function requireProjectHandles(projectPath: string): ProjectDataPlaneHandles {
    try {
        const ready = requireReadyProjectPath(projectPath);
        return Object.freeze({
            ready,
            fileIndex: requireReadyModuleHandle(ready, PROJECT_FILE_INDEX_MODULE_TOKEN),
            history: requireReadyModuleHandle(ready, PROJECT_HISTORY_MODULE_TOKEN),
        });
    } catch (error) {
        if (isProjectNotOpenError(error)) {
            throw createProjectNotOpenHttpError(error);
        }
        throw error;
    }
}

/**
 * Workspace Files HTTP统一数据面边界。Project target从exact ready捕获到handler settle始终在场；
 * plain Workspace/user-assets不属于ProjectSession，直接执行同一个handler。
 */
export function withProjectTargetOperation<TResult>(
    target: WorkspaceFileTarget,
    handler: (handles: ProjectDataPlaneHandles | undefined) => Promise<TResult> | TResult,
): Promise<TResult> {
    return withProjectNotOpenHttpError(async () => {
        const handles = projectHandlesForTarget(target);
        if (!handles) {
            return handler(undefined);
        }
        return runReadyProjectOperation(handles.ready, async () => handler(handles));
    });
}

/** History HTTP统一数据面边界：解析一次Project Path并持有同一generation直到请求settle。 */
export function withProjectHandlesOperation<TResult>(
    projectPath: string,
    handler: (handles: ProjectDataPlaneHandles) => Promise<TResult> | TResult,
): Promise<TResult> {
    return withProjectNotOpenHttpError(async () => {
        const handles = requireProjectHandles(projectPath);
        return runReadyProjectOperation(handles.ready, async () => handler(handles));
    });
}

/**
 * SSE等流式响应的Project边界。result可立即交给H3，completion必须在连接真正关闭后settle；
 * Project close会通过signal要求流主动收尾，并等待completion释放。
 */
export function startProjectTargetOperation<TResult>(
    target: WorkspaceFileTarget,
    start: (
        handles: ProjectDataPlaneHandles | undefined,
        signal: AbortSignal,
    ) => ProjectOperationStart<TResult>,
): TResult {
    try {
        const handles = projectHandlesForTarget(target);
        if (!handles) {
            const started = start(undefined, new AbortController().signal);
            void started.completion.catch(() => undefined);
            return started.result;
        }
        return startReadyProjectOperation(handles.ready, (signal) => start(handles, signal));
    } catch (error) {
        if (isProjectNotOpenError(error)) {
            throw createProjectNotOpenHttpError(error);
        }
        throw error;
    }
}

/**
 * 将 ProjectSession typed error 映射为稳定 HTTP 409，供 Nitro route handler 返回给前端。
 */
export function createProjectNotOpenHttpError(error: ProjectNotOpenError): Error {
    return createError({
        statusCode: 409,
        statusMessage: "Project not open",
        message: error.message,
        data: {
            code: "PROJECT_NOT_OPEN",
            projectPath: error.projectPath,
        },
    });
}

/**
 * 路由层 typed error wrapper：业务层只抛 ProjectNotOpenError，HTTP 层统一映射为稳定 409。
 */
export async function withProjectNotOpenHttpError<T>(handler: () => Promise<T> | T): Promise<T> {
    try {
        return await handler();
    } catch (error) {
        if (isProjectNotOpenError(error)) {
            throw createProjectNotOpenHttpError(error);
        }
        throw error;
    }
}
