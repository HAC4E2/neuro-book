/**
 * @notnotype/dev-panel 的公开入口：nbdev 命令行与（后续）面板共用的核心库。
 * 本入口与它引用的 src/core 只用 Node 兼容 API：根脚本测试在 Node 下导入它（tsconfig.core.json 在类型层守住这一点）。
 */
export {
    ERROR_EXIT_CODES,
    NbdevError,
    isNbdevError,
    type ExitCode,
    type NbdevErrorCode,
    type Warning,
} from "./core/errors.js";
export {
    MAX_TASK_NUMBER,
    MAX_WORK_NUMBER,
    SLUG_PATTERN,
    TASK_ID_PATTERN,
    WORK_ID_PATTERN,
    formatTaskId,
    formatWorkId,
    parseTaskId,
    parseWorkId,
    taskNumberLabel,
    workNumberLabel,
    type ParsedId,
} from "./core/ids.js";
