import {isAbsolute} from "node:path";
import {
    requireReadyModuleHandle,
} from "nbook/server/workspace-files/project-session";
import type {ResolvedFileAddress} from "nbook/server/workspace-files/file-scope";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import {normalizeProjectPath, projectSlug} from "nbook/server/workspace-files/project-path";
import {
    PROJECT_FILE_INDEX_MODULE_TOKEN,
    type ProjectFileIndexHandle,
} from "nbook/server/workspace-files/project-file-index";
import {
    PROJECT_HISTORY_MODULE_TOKEN,
    recordProjectDelete,
    recordProjectWrite,
    type ProjectHistoryHandle,
} from "nbook/server/workspace-history/project-history";

/**
 * Agent 文件工具（write / edit / apply_patch）的文件历史归因记账（Task 95 S5）。
 *
 * 项目归属直接消费统一 File Address Resolver 的结构化结果。Project-bound
 * File Scope 通过显式 `workspace/<其他slug>/...` 跨项目写文件时，解析结果
 * 已携带目标 Project Path；历史层不得再从物理路径反推领域身份。
 * 非 managed Project 地址与未 open 项目一律静默跳过；
 * 记账本身 fail-open（record* 内部保证），绝不影响工具主流程。
 */

/** 归一 before/after 入参：string 按 UTF-8 编码为字节。 */
function toRecordBytes(content: string | Uint8Array | null): Uint8Array | null {
    if (content === null) {
        return null;
    }
    return typeof content === "string" ? new TextEncoder().encode(content) : content;
}

/**
 * 记一次 agent 工具写入。after = null 表示删除（此时 before 必须有内容才有账可记）。
 * before = null 表示写前文件不存在（file.create 语义）。
 */
export async function recordAgentWorkspaceWrite(input: {
    sessionId: number;
    capture: AgentWorkspaceWriteCapture | null;
    before: string | Uint8Array | null;
    after: string | Uint8Array | null;
}): Promise<void> {
    if (!input.capture) {
        return;
    }
    try {
        const {history, relativePath} = input.capture;
        // N5：sessionId number→string 集中在此转换，模块侧 actor 恒为 string
        const actor = {kind: "agent" as const, sessionId: String(input.sessionId)};
        const after = toRecordBytes(input.after);
        if (after === null) {
            const before = toRecordBytes(input.before);
            if (before !== null) {
                await recordProjectDelete(history, {
                    relativePath,
                    actor,
                    before,
                });
            }
        } else {
            await recordProjectWrite(history, {
                relativePath,
                actor,
                before: toRecordBytes(input.before),
                after,
            });
        }
    } catch {
        // History generation可能在文件落盘后、记账前关闭；记账永远不能反向破坏文件写入。
    }

    try {
        input.capture.fileIndex.invalidate();
    } catch {
        // 文件已经落盘；精确generation关闭导致的失效失败不能反向破坏主写入。
    }
}

/** 落盘前捕获的目标 Project generation 记账上下文。 */
export type AgentWorkspaceWriteCapture = Readonly<{
    history: ProjectHistoryHandle;
    fileIndex: ProjectFileIndexHandle;
    relativePath: string;
}>;

/**
 * 在文件 mutation 前按统一 File Address 捕获目标 Project 的精确 History handle。
 * 未打开/非 Project 地址返回 null；落盘后不得再次按地址查询当前 generation。
 */
export function captureAgentWorkspaceWrite(
    address: ResolvedFileAddress,
    exactProject: ReadyProjectSessionRef | undefined,
): AgentWorkspaceWriteCapture | null {
    const projectPath = address.projectPath;
    const relativePath = "relativePath" in address ? address.relativePath : null;
    if (!exactProject || !projectPath || isAbsolute(projectPath) || !relativePath || relativePath === ".") {
        return null;
    }
    try {
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        if (exactProject.workspace.ref.projectRoot !== projectSlug(normalizedProjectPath)) {
            return null;
        }
        const history = requireReadyModuleHandle(
            exactProject,
            PROJECT_HISTORY_MODULE_TOKEN,
        );
        const fileIndex = requireReadyModuleHandle(
            exactProject,
            PROJECT_FILE_INDEX_MODULE_TOKEN,
        );
        return Object.freeze({history, fileIndex, relativePath});
    } catch {
        return null;
    }
}
