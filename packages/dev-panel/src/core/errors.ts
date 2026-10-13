/**
 * nbdev 的错误码与退出码。命令行与面板都按 `code` 分支，不看 `message` 的文案。
 * 退出码遵循 Proposal 第十一节：1 运行失败、2 用法错误、3 需要人决定的冲突、4 等待超时（含被信号打断）、5 找不到对象。
 */
export const ERROR_EXIT_CODES = {
    usage: 2,
    invalid_slug: 2,
    invalid_status: 2,
    invalid_title: 2,
    caller_unknown: 2,
    invalid_artifact_id: 2,
    invalid_questions: 2,
    invalid_answer: 2,
    unsafe_host: 2,
    invalid_text: 2,
    invalid_record_edit: 2,
    payload_too_large: 2,
    unsupported_media_type: 2,
    key_not_allowed: 2,
    repository_not_found: 5,
    records_root_not_found: 5,
    work_not_found: 5,
    master_not_found: 5,
    task_not_found: 5,
    artifact_not_found: 5,
    question_not_found: 5,
    entry_missing: 5,
    no_answers: 5,
    panel_not_running: 5,
    shim_target_not_found: 5,
    main_not_on_master: 3,
    main_busy: 3,
    branch_maintained_record: 3,
    ambiguous_work: 3,
    ambiguous_task: 3,
    work_not_committed: 3,
    target_exists: 3,
    target_missing: 3,
    task_closed: 3,
    task_not_committed: 3,
    duplicate_question: 3,
    artifact_closed: 3,
    question_closed: 3,
    hash_mismatch: 3,
    uncommitted_changes: 3,
    unsafe_path: 3,
    shim_exists: 3,
    panel_running: 3,
    port_in_use: 3,
    stale_version: 3,
    not_editable: 3,
    staged_rename: 3,
    changed_after_write: 3,
    audit_unavailable: 3,
    session_changed: 3,
    not_deliverable: 3,
    agent_busy: 3,
    not_in_repository: 3,
    key_rate_limited: 3,
    service_exists: 3,
    wait_timeout: 4,
    wait_interrupted: 4,
    lock_timeout: 1,
    lock_failed: 1,
    lock_compromised: 1,
    cross_device: 1,
    git_failed: 1,
    git_identity_missing: 1,
    commit_failed: 1,
    write_failed: 1,
    schema_unsupported: 1,
    invalid_record: 1,
    number_exhausted: 1,
    build_failed: 1,
    request_aborted: 1,
    herdr_unavailable: 1,
    internal: 1,
} as const;

export type NbdevErrorCode = keyof typeof ERROR_EXIT_CODES;
export type ExitCode = 0 | (typeof ERROR_EXIT_CODES)[NbdevErrorCode];

/** nbdev 的所有预期失败；`details` 进入 `--json` 外壳的 `errors[].details`。 */
export class NbdevError extends Error {
    readonly code: NbdevErrorCode;
    readonly details: Record<string, unknown> | undefined;

    constructor(code: NbdevErrorCode, message: string, options: {details?: Record<string, unknown>; cause?: unknown} = {}) {
        super(message, options.cause === undefined ? undefined : {cause: options.cause});
        this.name = "NbdevError";
        this.code = code;
        this.details = options.details;
    }

    get exitCode(): ExitCode {
        return ERROR_EXIT_CODES[this.code];
    }
}

/** 不中断操作的提示；调用方按 `code` 判断。 */
export type Warning = {code: string; message: string; details?: Record<string, unknown>};

export function isNbdevError(error: unknown): error is NbdevError {
    return error instanceof NbdevError;
}

/** 取 Node 系统错误的 `code`（ENOENT、EEXIST 等）；不是系统错误时返回 undefined。 */
export function systemErrorCode(error: unknown): string | undefined {
    if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
    return undefined;
}
