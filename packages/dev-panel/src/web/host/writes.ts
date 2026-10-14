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
const RELOAD_CODES = new Set(["stale_version", "question_closed", "question_earlier", "artifact_closed", "task_closed", "work_not_found", "task_not_found", "artifact_not_found", "question_not_found"]);

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

/**
 * 写入（以及会话页的按键、文字、接管）之后给开发者看的一条结果，`WriteResult` 显示它（t15 阶段 3c）。
 * - `outcome` 决定颜色与图标：成功、失败（没有完成；是否已经写入看 `message` 与 `items`：`commit_failed`、`changed_after_write`
 *   已写进工作区、没有提交，也算失败）、冲突（状态在你操作期间变了，没生效）、结果未知、提示。能不能重试只看 `retry`，不看 `outcome`；
 * - `items` 是结果的明细（没锚到字段的问题、写入了没提交的路径），已与 `message` 去重；
 * - `notes` 是附注（服务端的警告），缩进、默认折叠，不改变结果的颜色：成功带警告仍是成功。
 */
export type NoticeOutcome = "success" | "failure" | "conflict" | "unknown" | "info";
export type Notice = {outcome: NoticeOutcome; title: string; message: string; items: string[]; notes: string[]; retry: boolean};

/** 只有标题与一句话的结果。 */
export function plainNotice(outcome: NoticeOutcome, title: string, message: string): Notice {
    return {outcome, title, message, items: [], notes: [], retry: false};
}

export function successNotice(title: string, body: Envelope<WriteData>): Notice {
    const {commit, changed} = body.data;
    const message = !changed || (!commit.committed && commit.reason === "nothing_to_commit") ? "内容没变，没有提交" : commit.committed ? `已提交 ${commit.sha.slice(0, 9)}` : "";
    return {outcome: "success", title, message, items: [], notes: body.warnings.map((warning) => warning.message), retry: false};
}

/** 失败里能锚到表单字段的问题：`details.problems[].field` 与 `details.field`（新建页交给表单显示，结果里不再列一遍）。 */
export function fieldProblems(failure: WriteFailure): Array<{field: string; message: string}> {
    const listed = Array.isArray(failure.details.problems) ? (failure.details.problems as Array<{field?: unknown; reason?: unknown; message?: unknown}>) : [];
    const found = listed.filter((problem) => typeof problem.field === "string").map((problem) => ({field: problem.field as string, message: String(problem.reason ?? problem.message ?? failure.message)}));
    if (typeof failure.details.field === "string" && !found.some((problem) => problem.field === failure.details.field)) found.push({field: failure.details.field, message: failure.message});
    return found;
}

type ListedProblem = {reason?: unknown; message?: unknown; questionId?: unknown; field?: unknown};
/** 问题锚在哪里：新建页、编辑页的表单按字段（`field`），产物页的答复表单按题号（`questionId`）。 */
const anchorOf = (problem: ListedProblem): string | null => (typeof problem.field === "string" ? problem.field : typeof problem.questionId === "string" ? problem.questionId : null);

/**
 * 失败的结果。`anchored` 是这一页的表单能显示问题的字段或题号：落在其中的问题只在表单里报一次，结果里写“表单里标出了 N 处”。
 * 其余问题进 `items`，与 `message` 相同的不再列；已写入未提交的路径若 `message` 里已经写了，也不再列。
 */
export function failureNotice(title: string, failure: WriteFailure, anchored: ReadonlySet<string> = new Set()): Notice {
    const listed = Array.isArray(failure.details.problems) ? (failure.details.problems as ListedProblem[]) : [];
    const isAnchored = (problem: ListedProblem) => {
        const anchor = anchorOf(problem);
        return anchor !== null && anchored.has(anchor);
    };
    const single = typeof failure.details.field === "string" ? failure.details.field : typeof failure.details.questionId === "string" ? failure.details.questionId : null;
    const anchoredCount = listed.filter(isAnchored).length + (single !== null && anchored.has(single) && !listed.some((problem) => anchorOf(problem) === single) ? 1 : 0);
    const items: string[] = [];
    for (const problem of listed) {
        if (isAnchored(problem)) continue;
        const reason = String(problem.reason ?? problem.message ?? "");
        if (reason === "" || reason === failure.message) continue;
        const where = typeof problem.questionId === "string" ? problem.questionId : typeof problem.field === "string" ? problem.field : null;
        items.push(where ? `${where}：${reason}` : reason);
    }
    for (const path of failure.writtenPaths) {
        if (!failure.message.includes(path)) items.push(`已写入、未提交：${path}`);
    }
    const outcome: NoticeOutcome = failure.action === "unknown" ? "unknown" : failure.action === "show_diff" || failure.action === "confirm_uncommitted" || failure.action === "reload" ? "conflict" : "failure";
    return {
        outcome,
        title,
        message: anchoredCount > 0 ? `表单里标出了 ${anchoredCount} 处要改的地方` : failure.message,
        items: [...new Set(items)],
        notes: failure.warnings.map((warning) => warning.message),
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
