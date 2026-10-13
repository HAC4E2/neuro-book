import {onScopeDispose, ref, type Ref} from "vue";
import {ApiError, type ApiWarning, type Envelope} from "./api.js";
import type {UncommittedChanges, WriteData} from "./types.js";

/**
 * 页面（宿主）发写请求用：提交中禁用按钮、2 秒后提示“在等别的写入完成”（写事务串行，等锁最长 30 秒），
 * 失败按错误码分成界面动作（见 docs/panel.md 的“写入的界面”）。零件不发请求，只吃这里给出的状态。
 */

/** 界面怎么处理一次失败：`retry` 只给确定什么都没写的情形；`unknown` 是结果未知（不给重试，重新载入）。 */
export type WriteFailure = {
    code: string;
    message: string;
    details: Record<string, unknown>;
    data: unknown;
    warnings: ApiWarning[];
    action: "retry" | "reload" | "unknown" | "fix" | "confirm_uncommitted" | "show_diff" | "none";
    writtenPaths: string[];
};

const SLOW_MS = 2_000;
/** 拿到这些就重新取数：页面上的数据已经过时。 */
const RELOAD_CODES = new Set(["stale_version", "question_closed", "artifact_closed", "task_closed", "work_not_found", "task_not_found", "artifact_not_found", "question_not_found"]);

export function describeFailure(error: unknown): WriteFailure {
    if (!(error instanceof ApiError)) {
        return {code: "internal", message: error instanceof Error ? error.message : String(error), details: {}, data: null, warnings: [], action: "unknown", writtenPaths: []};
    }
    const base = {code: error.code, details: error.details, data: error.data, warnings: error.warnings};
    const written = Array.isArray(error.details.writtenPaths) ? error.details.writtenPaths.map(String) : [];
    // 各页面接着按自己的数据核对一次（重新取数、或锁住表单），并在提示里补上核对的结果。
    if (error.status === 0) return {...base, message: "连接中途断开了，这次写入可能已经生效，也可能没有。不要直接再提交一次", action: "unknown", writtenPaths: []};
    if (error.code === "lock_timeout") return {...base, message: "等别的写入超时（30 秒），这次什么都没写", action: "retry", writtenPaths: []};
    if (error.code === "warming_up") return {...base, message: "面板正在启动，稍后再试", action: "retry", writtenPaths: []};
    if (error.code === "commit_failed") return {...base, message: `已写入、没有提交：${written.join("、")}。在终端检查后手动提交这些路径`, action: "none", writtenPaths: written};
    if (error.code === "changed_after_write") return {...base, message: `你的改动已在工作区，没有提交：写完之后、提交之前有别的进程又改了 ${written.join("、")}。在终端检查后手动提交`, action: "none", writtenPaths: written};
    if (error.code === "uncommitted_changes") return {...base, message: error.message, action: "confirm_uncommitted", writtenPaths: []};
    if (error.code === "hash_mismatch") return {...base, message: "文件在你打开之后被改过", action: "show_diff", writtenPaths: []};
    if (RELOAD_CODES.has(error.code)) return {...base, message: `${error.message}（已重新载入）`, action: "reload", writtenPaths: []};
    if (error.status === 400) return {...base, message: error.message, action: "fix", writtenPaths: []};
    return {...base, message: error.message, action: "none", writtenPaths: written};
}

export type WriteRun = {
    pending: Ref<boolean>;
    /** 提交超过 2 秒还没回来。 */
    slow: Ref<boolean>;
    run<T>(send: () => Promise<Envelope<T>>): Promise<{ok: true; body: Envelope<T>} | {ok: false; failure: WriteFailure}>;
};

export function useWrite(): WriteRun {
    const pending = ref(false);
    const slow = ref(false);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = () => {
        if (timer) clearTimeout(timer);
        timer = null;
    };
    onScopeDispose(clear);
    return {
        pending,
        slow,
        async run(send) {
            pending.value = true;
            slow.value = false;
            timer = setTimeout(() => {
                slow.value = true;
            }, SLOW_MS);
            try {
                return {ok: true, body: await send()};
            } catch (error) {
                if (!(error instanceof ApiError)) console.error("写请求失败", error);
                return {ok: false, failure: describeFailure(error)};
            } finally {
                clear();
                pending.value = false;
                slow.value = false;
            }
        },
    };
}

/** 写入之后给开发者看的一条结果（`WriteNotice` 显示它）。 */
export type Notice = {tone: "success" | "warning" | "error" | "info"; title: string; message: string; items: string[]; retry: boolean};

export function successNotice(title: string, body: Envelope<WriteData>): Notice {
    const {commit, changed} = body.data;
    const message = !changed || (!commit.committed && commit.reason === "nothing_to_commit") ? "内容没变，没有提交" : commit.committed ? `已提交 ${commit.sha.slice(0, 9)}` : "";
    return {tone: body.warnings.length > 0 ? "warning" : "success", title, message, items: body.warnings.map((warning) => warning.message), retry: false};
}

export function failureNotice(title: string, failure: WriteFailure): Notice {
    const problems = Array.isArray(failure.details.problems) ? (failure.details.problems as Array<{reason?: string; questionId?: string; field?: string}>).map((problem) => [problem.questionId ?? problem.field, problem.reason].filter(Boolean).join("：")) : [];
    return {
        tone: failure.action === "unknown" || failure.action === "retry" ? "warning" : "error",
        title,
        message: failure.message,
        items: [...problems, ...failure.writtenPaths.map((path) => `已写入、未提交：${path}`)],
        retry: failure.action === "retry",
    };
}

/** `uncommitted_changes` 的 details 里给人看的那几项（服务端的 `UncommittedChanges`）。 */
export function uncommittedOf(details: Record<string, unknown>): UncommittedChanges {
    return {
        status: Array.isArray(details.status) ? details.status.map(String) : [],
        staged: typeof details.staged === "string" ? details.staged : null,
        unstaged: typeof details.unstaged === "string" ? details.unstaged : null,
        untracked: details.untracked === true,
    };
}
