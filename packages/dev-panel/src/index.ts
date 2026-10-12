/**
 * @notnotype/dev-panel 的公开入口：nbdev 命令行与（后续）面板共用的核心库。
 * 本入口与它引用的 src/core 只用 Node 兼容 API：根脚本测试在 Node 下导入它。tsconfig.core.json 只带 Node 类型、把 bun 与 bun:* 指到空模块，
 * 在类型层拦住 Bun 全局与从 bun 模块取导出；Node 下的根测试在运行时再拦一次。
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
export {
    assertMainWritable,
    listCheckouts,
    locateRepository,
    MASTER_REF,
    WORKS_ROOT,
    type CheckoutInfo,
    type RepoContext,
} from "./core/repo.js";
export {
    TASK_STATUSES,
    WORK_STATUSES,
    listTaskIds,
    listWorkIds,
    readTaskRecord,
    readWorkRecord,
    type Recorded,
    type TaskRecord,
    type TaskStatus,
    type WorkRecord,
    type WorkStatus,
} from "./core/records.js";
export {
    REGISTRY_FILE,
    REGISTRY_SCHEMA,
    readRegistry,
    type Registry,
    type RegistryStatus,
    type RegistryTaskEntry,
    type RegistryWorkEntry,
} from "./core/registry.js";
export {findConflicts, nextTaskNumber, nextWorkNumber, scanNumbers, type ConflictId, type IdLocation, type NumberConflict, type NumberScan} from "./core/scan.js";
export {chooseExecutionCheckout, findBranchRecordChanges, type ExecutionCheckout} from "./core/sources.js";
export {readProjectStatus, type ProjectStatus, type RecordSource, type StatusFilter, type TaskView, type WorkView} from "./core/status.js";
export {acquireRecordsLock, DEFAULT_LOCK_WAIT_MS, type LockHolder, type RecordsLock} from "./core/lock.js";
export {
    DEFAULT_GIT_LOCK_WAIT_MS,
    recordDate,
    resolveCommitOutcome,
    runWriteTransaction,
    sha256,
    type CommitOutcome,
    type TransactionOptions,
    type TransactionResult,
    type WriteTx,
} from "./core/transaction.js";
export {
    createTask,
    createWork,
    importRegistry,
    setRecordStatus,
    type CreateResult,
    type ImportResult,
    type OperationResult,
    type SetStatusResult,
} from "./core/operations.js";
export {bootTime, processAlive, processStartTicks, readEnviron, readProcessTable, readProcStat, startTimeIso, systemdUnitOf, type ProcessEntry, type ProcStat} from "./core/procfs.js";
export {resolveCaller, type Caller, type CallerHerdr, type ProcessRef, type SessionCaller, type SessionRef} from "./core/identity.js";
export {
    createHerdrClient,
    HERDR_CLI_METHODS,
    HERDR_READ_METHODS,
    HerdrError,
    resolveHerdrSocket,
    type HerdrAgentSession,
    type HerdrAvailability,
    type HerdrClient,
    type HerdrPane,
    type HerdrProcessInfo,
    type HerdrStatus,
} from "./herdr/client.js";
