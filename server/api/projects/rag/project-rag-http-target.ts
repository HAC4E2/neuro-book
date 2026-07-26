import type {H3Event} from "h3";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import type {ProjectRagTarget} from "nbook/server/rag/project-rag-visualization";
import {requireProjectPathQuery} from "nbook/server/utils/novel-chapter";
import {
    requireReadyProjectPath,
    runReadyProjectOperation,
} from "nbook/server/workspace-files/project-session";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/**
 * Phase 7 前的 RAG HTTP seam：旧 projectPath query 在请求入口只解析一次，
 * 下游只传播同一个 ReadyProjectSessionRef 与显式 Workspace Root。
 */
export function requireProjectRagTarget(event: H3Event): ProjectRagTarget {
    const workspaceRoot = runtimePathsFromEnv().workspaceRoot;
    return Object.freeze({
        workspaceRoot,
        project: requireReadyProjectPath(requireProjectPathQuery(event)),
    });
}

/** RAG HTTP唯一Project边界：同一个target与generation覆盖业务调用的完整Promise生命周期。 */
export function withProjectRagTarget<TResult>(
    event: H3Event,
    handler: (target: ProjectRagTarget) => Promise<TResult> | TResult,
): Promise<TResult> {
    return withProjectNotOpenHttpError(async () => {
        const target = requireProjectRagTarget(event);
        return runReadyProjectOperation(target.project, async () => handler(target));
    });
}
