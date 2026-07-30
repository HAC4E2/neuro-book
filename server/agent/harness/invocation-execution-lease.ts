import {randomUUID} from "node:crypto";
import {mkdir, open, readFile, rename, rm, stat} from "node:fs/promises";
import {dirname, join} from "node:path";
import {lock} from "proper-lockfile";

const STORE_VERSION = 1 as const;
const INITIALIZED_SENTINEL = "1\n";

type InvocationExecutionRecord = {
    sessionId: number;
    invocationId: string;
    clientMessageId: string;
    ownerId: string;
    fence: number;
    state: "live" | "orphaned";
    leaseUntil: string;
    providerStartedAt?: string;
};

type InvocationExecutionStore = {
    version: typeof STORE_VERSION;
    nextFence: number;
    providerStartedFences: number[];
    records: InvocationExecutionRecord[];
};

export type InvocationExecutionLease = {
    sessionId: number;
    invocationId: string;
    clientMessageId: string;
    ownerId: string;
    fence: number;
    leaseUntil: string;
};

export type InvocationExecutionSessionTruth =
    | {state: "terminal"}
    | {
        state: "nonterminal";
        /** null 表示 Session 中没有与 clientMessageId 对应的 durable admission。 */
        invocationId: string | null;
        executionLeaseEstablished: boolean;
    };

export type InvocationExecutionResolution =
    | {state: "terminal"}
    | {state: "missing"}
    | {
        state: "active";
        invocationId: string;
        lifecycle: "accepted" | "running";
        executionLeaseUntil: string;
    }
    | {
        state: "orphaned";
        invocationId: string;
        providerStartRecorded: boolean | null;
    };

type InvocationExecutionLeaseStoreOptions = {
    /** 测试注入单调推进的墙钟；生产默认使用 Date.now。 */
    now?: () => number;
    /** 测试注入稳定 owner；生产每次 execution 建立随机 owner。 */
    ownerId?: () => string;
    /** 每次 lease/renewal 的有效期。 */
    leaseDurationMs?: number;
};

/** execution sidecar 已初始化但证据丢失或格式损坏时的 fail-closed 错误。 */
export class InvocationExecutionEvidenceLostError extends Error {
    readonly code = "execution_evidence_lost" as const;

    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "InvocationExecutionEvidenceLostError";
    }
}

/**
 * Harness invocation 的跨进程 execution lease 真相源。
 *
 * 所有跨 Session store 的组合操作必须先进入本类的物理锁，再由 callback 获取
 * Session mutation lock，从类型和调用形态上固定 execution sidecar -> Session 顺序。
 */
export class HarnessInvocationExecutionLeaseStore {
    private readonly storePath: string;
    private readonly lockTarget: string;
    private readonly sentinelPath: string;
    private readonly now: () => number;
    private readonly ownerId: () => string;
    private readonly leaseDurationMs: number;

    constructor(
        workspaceRoot: string,
        options: InvocationExecutionLeaseStoreOptions = {},
    ) {
        const agentRoot = join(workspaceRoot, ".nbook", "agent");
        this.storePath = join(agentRoot, "invocation-execution.json");
        this.lockTarget = join(agentRoot, "invocation-execution.lock-target");
        this.sentinelPath = join(this.lockTarget, "initialized");
        this.now = options.now ?? Date.now;
        this.ownerId = options.ownerId ?? randomUUID;
        this.leaseDurationMs = options.leaseDurationMs ?? 30_000;
        if (!Number.isSafeInteger(this.leaseDurationMs) || this.leaseDurationMs <= 0) {
            throw new Error("execution lease duration 必须是正安全整数");
        }
    }

    /** Harness heartbeat 的建议周期，始终早于当前 lease deadline。 */
    get heartbeatIntervalMs(): number {
        return Math.max(10, Math.floor(this.leaseDurationMs / 3));
    }

    /** 首次原子初始化 strict v1；sentinel 存在后任何 store 异常都只报错、不修复。 */
    async ensureHealthy(): Promise<void> {
        await this.withStoreLock(async () => {
            if (!await pathExists(this.sentinelPath)) {
                const existing = await this.readStoreBeforeInitialization();
                if (existing && existing.records.length > 0) {
                    throw new InvocationExecutionEvidenceLostError("execution store 有记录但 initialized sentinel 缺失");
                }
                await this.publishStore(emptyStore());
                await writeDurableFile(this.sentinelPath, INITIALIZED_SENTINEL);
                return;
            }
            await this.readInitializedStore();
        });
    }

    /**
     * 建立一个 live owner/fence，并在仍持有 execution lock 时提交 Session marker。
     * callback 失败时保留 live 记录，调用方必须走 withLiveExecutionFence 收口错误。
     */
    async establish(
        input: {sessionId: number; invocationId: string; clientMessageId: string},
        appendMarker: (lease: InvocationExecutionLease) => Promise<void>,
        commitFailure?: (error: unknown) => Promise<void>,
    ): Promise<InvocationExecutionLease> {
        return this.withStoreLock(async () => {
            let store: InvocationExecutionStore;
            try {
                store = await this.readInitializedStore();
            } catch (error) {
                await commitFailure?.(error);
                throw error;
            }
            if (store.records.some((record) => record.sessionId === input.sessionId
                || record.invocationId === input.invocationId
                || record.clientMessageId === input.clientMessageId)) {
                throw new Error("execution lease identity 已存在");
            }
            const lease: InvocationExecutionLease = {
                ...input,
                ownerId: this.ownerId(),
                fence: store.nextFence,
                leaseUntil: new Date(this.now() + this.leaseDurationMs).toISOString(),
            };
            store.nextFence += 1;
            store.records.push({...lease, state: "live"});
            await this.publishStore(store);
            try {
                await appendMarker(lease);
            } catch (error) {
                await commitFailure?.(error);
                store.records = store.records.filter((record) => record.invocationId !== lease.invocationId);
                await this.publishStore(store);
                throw error;
            }
            return lease;
        });
    }

    /** 在首次 Provider 调用前 CAS 记录 start fence；过期或旧 owner 一律拒绝。 */
    async recordProviderStarted(lease: InvocationExecutionLease): Promise<void> {
        await this.withStoreLock(async () => {
            const store = await this.readInitializedStore();
            const record = this.liveRecord(store, lease);
            if (!record) {
                throw new InvocationExecutionEvidenceLostError("execution lease 已失效，禁止启动 Provider");
            }
            if (!record.providerStartedAt) {
                record.providerStartedAt = new Date(this.now()).toISOString();
                store.providerStartedFences.push(record.fence);
                await this.publishStore(store);
            }
        });
    }

    /** 续租仍由精确 owner/fence 拥有的 live execution。 */
    async renew(lease: InvocationExecutionLease): Promise<InvocationExecutionLease> {
        return this.withStoreLock(async () => {
            const store = await this.readInitializedStore();
            const record = this.liveRecord(store, lease);
            if (!record) {
                throw new InvocationExecutionEvidenceLostError("execution lease 已失效，不能续租");
            }
            record.leaseUntil = new Date(this.now() + this.leaseDurationMs).toISOString();
            await this.publishStore(store);
            return {
                ...lease,
                leaseUntil: record.leaseUntil,
            };
        });
    }

    /**
     * 唯一 terminal boundary：持 execution lock 校验 live owner/fence，再调用 Session commit，
     * 最后删除 sidecar 记录。fence 失效时 callback 不会执行。
     */
    async withLiveExecutionFence<TResult>(
        lease: InvocationExecutionLease,
        commit: () => Promise<TResult>,
    ): Promise<{committed: false} | {committed: true; value: TResult}> {
        return this.withStoreLock(async () => {
            const store = await this.readInitializedStore();
            const record = this.liveRecord(store, lease);
            if (!record) {
                return {committed: false};
            }
            const value = await commit();
            store.records = store.records.filter((candidate) => candidate !== record);
            store.providerStartedFences = store.providerStartedFences.filter((fence) => fence !== record.fence);
            await this.publishStore(store);
            return {committed: true, value};
        });
    }

    /**
     * 在 execution lock 内先读取 Session truth，再返回 active 或原子 fencing orphan。
     * terminal Session 永远优先；全局 store 损坏时绝不覆写。
     */
    async resolve(
        input: {sessionId: number; clientMessageId: string},
        readSessionTruth: () => Promise<InvocationExecutionSessionTruth>,
    ): Promise<InvocationExecutionResolution> {
        return this.withStoreLock(async () => {
            let store: InvocationExecutionStore | null = null;
            let evidenceLost = false;
            try {
                store = await this.readInitializedStore();
            } catch (error) {
                if (!(error instanceof InvocationExecutionEvidenceLostError)) {
                    throw error;
                }
                evidenceLost = true;
            }

            const truth = await readSessionTruth();
            if (truth.state === "terminal") {
                if (store) {
                    const previousLength = store.records.length;
                    store.records = store.records.filter((record) => !(
                        record.sessionId === input.sessionId
                        && record.clientMessageId === input.clientMessageId
                    ));
                    if (store.records.length !== previousLength) {
                        const liveFences = new Set(store.records.map((record) => record.fence));
                        store.providerStartedFences = store.providerStartedFences.filter((fence) => liveFences.has(fence));
                        await this.publishStore(store);
                    }
                }
                return {state: "terminal"};
            }
            if (truth.invocationId === null) {
                return {state: "missing"};
            }
            if (evidenceLost || !store) {
                return {
                    state: "orphaned",
                    invocationId: truth.invocationId,
                    providerStartRecorded: truth.executionLeaseEstablished ? null : false,
                };
            }

            const record = store.records.find((candidate) => candidate.sessionId === input.sessionId
                && candidate.clientMessageId === input.clientMessageId);
            if (!record) {
                if (!truth.executionLeaseEstablished) {
                    const fence = store.nextFence;
                    store.nextFence += 1;
                    store.records.push({
                        sessionId: input.sessionId,
                        invocationId: truth.invocationId,
                        clientMessageId: input.clientMessageId,
                        ownerId: `orphan-reader:${randomUUID()}`,
                        fence,
                        state: "orphaned",
                        leaseUntil: new Date(this.now()).toISOString(),
                    });
                    await this.publishStore(store);
                    return {
                        state: "orphaned",
                        invocationId: truth.invocationId,
                        providerStartRecorded: false,
                    };
                }
                return {
                    state: "orphaned",
                    invocationId: truth.invocationId,
                    providerStartRecorded: null,
                };
            }
            if (record.invocationId !== truth.invocationId) {
                return {
                    state: "orphaned",
                    invocationId: truth.invocationId,
                    providerStartRecorded: null,
                };
            }
            if (record.state === "orphaned") {
                return {
                    state: "orphaned",
                    invocationId: record.invocationId,
                    providerStartRecorded: Boolean(record.providerStartedAt),
                };
            }
            if (Date.parse(record.leaseUntil) > this.now()) {
                return {
                    state: "active",
                    invocationId: record.invocationId,
                    lifecycle: record.providerStartedAt ? "running" : "accepted",
                    executionLeaseUntil: record.leaseUntil,
                };
            }
            record.state = "orphaned";
            await this.publishStore(store);
            return {
                state: "orphaned",
                invocationId: record.invocationId,
                providerStartRecorded: Boolean(record.providerStartedAt),
            };
        });
    }

    /** 取得 stable sibling lock；绝不锁会被 rename 替换的 JSON 文件。 */
    private async withStoreLock<TResult>(task: () => Promise<TResult>): Promise<TResult> {
        await mkdir(this.lockTarget, {recursive: true});
        const release = await lock(this.lockTarget, {
            realpath: false,
            stale: 30_000,
            update: 10_000,
            retries: {
                retries: 20,
                minTimeout: 5,
                maxTimeout: 100,
                factor: 1.5,
            },
        });
        try {
            return await task();
        } finally {
            await release();
        }
    }

    /** sentinel 尚未存在时，只接受可严格解析的空残留 store。 */
    private async readStoreBeforeInitialization(): Promise<InvocationExecutionStore | null> {
        try {
            return parseStore(await readFile(this.storePath, "utf8"));
        } catch (error) {
            if (isNodeError(error, "ENOENT")) {
                return null;
            }
            if (error instanceof InvocationExecutionEvidenceLostError) {
                return null;
            }
            throw error;
        }
    }

    /** initialized 后任何缺失、损坏或未知版本都转换成稳定 evidence-lost 错误。 */
    private async readInitializedStore(): Promise<InvocationExecutionStore> {
        if (!await pathExists(this.sentinelPath)) {
            throw new InvocationExecutionEvidenceLostError("execution store initialized sentinel 缺失");
        }
        let text: string;
        try {
            text = await readFile(this.storePath, "utf8");
        } catch (error) {
            throw new InvocationExecutionEvidenceLostError("execution store 缺失或不可读", {cause: error});
        }
        return parseStore(text);
    }

    /** temp fsync + rename 发布完整 store。 */
    private async publishStore(store: InvocationExecutionStore): Promise<void> {
        await writeDurableFile(this.storePath, `${JSON.stringify(store)}\n`);
    }

    /** 查找并校验精确、未过期的 live owner/fence。 */
    private liveRecord(
        store: InvocationExecutionStore,
        lease: InvocationExecutionLease,
    ): InvocationExecutionRecord | null {
        const record = store.records.find((candidate) => candidate.sessionId === lease.sessionId
            && candidate.invocationId === lease.invocationId
            && candidate.clientMessageId === lease.clientMessageId
            && candidate.ownerId === lease.ownerId
            && candidate.fence === lease.fence);
        if (!record || record.state !== "live" || Date.parse(record.leaseUntil) <= this.now()) {
            return null;
        }
        return record;
    }
}

/** 构造首次发布的唯一空 v1 store。 */
function emptyStore(): InvocationExecutionStore {
    return {
        version: STORE_VERSION,
        nextFence: 1,
        providerStartedFences: [],
        records: [],
    };
}

/** 严格解析 sidecar；外部 JSON 必须在边界以 unknown 校验后才能进入领域类型。 */
function parseStore(text: string): InvocationExecutionStore {
    let value: unknown;
    try {
        value = JSON.parse(text) as unknown;
    } catch (error) {
        throw new InvocationExecutionEvidenceLostError("execution store 不是合法 JSON", {cause: error});
    }
    if (!isPlainObject(value)
        || !hasExactKeys(value, ["version", "nextFence", "providerStartedFences", "records"])
        || value.version !== STORE_VERSION
        || !Number.isSafeInteger(value.nextFence)
        || (value.nextFence as number) < 1
        || !Array.isArray(value.providerStartedFences)
        || !Array.isArray(value.records)) {
        throw new InvocationExecutionEvidenceLostError("execution store 不是 strict v1");
    }
    const records = value.records.map(parseRecord);
    const providerStartedFences = value.providerStartedFences;
    if (!providerStartedFences.every((fence) => Number.isSafeInteger(fence) && (fence as number) > 0)
        || new Set(providerStartedFences).size !== providerStartedFences.length) {
        throw new InvocationExecutionEvidenceLostError("execution store provider start fence 损坏");
    }
    const providerStartedFenceSet = new Set(providerStartedFences as number[]);
    if (records.some((record) => providerStartedFenceSet.has(record.fence) !== Boolean(record.providerStartedAt))) {
        throw new InvocationExecutionEvidenceLostError("execution store provider start 证据不一致");
    }
    const highestFence = Math.max(
        0,
        ...records.map((record) => record.fence),
        ...(providerStartedFences as number[]),
    );
    if ((value.nextFence as number) <= highestFence) {
        throw new InvocationExecutionEvidenceLostError("execution store nextFence 不是单调递增值");
    }
    const identities = new Set<string>();
    for (const record of records) {
        const identitiesForRecord = [
            `session:${record.sessionId}`,
            `invocation:${record.invocationId}`,
            `client:${record.clientMessageId}`,
            `fence:${record.fence}`,
        ];
        if (identitiesForRecord.some((identity) => identities.has(identity))) {
            throw new InvocationExecutionEvidenceLostError("execution store 存在重复 identity");
        }
        identitiesForRecord.forEach((identity) => identities.add(identity));
    }
    return {
        version: STORE_VERSION,
        nextFence: value.nextFence as number,
        providerStartedFences: providerStartedFences as number[],
        records,
    };
}

/** 严格解析单条 execution record，拒绝删除/添加字段形成的降级证据。 */
function parseRecord(value: unknown): InvocationExecutionRecord {
    if (!isPlainObject(value)) {
        throw new InvocationExecutionEvidenceLostError("execution record 不是对象");
    }
    const required = [
        "sessionId",
        "invocationId",
        "clientMessageId",
        "ownerId",
        "fence",
        "state",
        "leaseUntil",
    ];
    const allowed = value.providerStartedAt === undefined
        ? required
        : [...required, "providerStartedAt"];
    if (!hasExactKeys(value, allowed)
        || !Number.isSafeInteger(value.sessionId)
        || (value.sessionId as number) <= 0
        || typeof value.invocationId !== "string"
        || value.invocationId.length === 0
        || typeof value.clientMessageId !== "string"
        || value.clientMessageId.length === 0
        || typeof value.ownerId !== "string"
        || value.ownerId.length === 0
        || !Number.isSafeInteger(value.fence)
        || (value.fence as number) <= 0
        || (value.state !== "live" && value.state !== "orphaned")
        || !isIsoTimestamp(value.leaseUntil)
        || (value.providerStartedAt !== undefined && !isIsoTimestamp(value.providerStartedAt))) {
        throw new InvocationExecutionEvidenceLostError("execution record 格式损坏");
    }
    return {
        sessionId: value.sessionId as number,
        invocationId: value.invocationId,
        clientMessageId: value.clientMessageId,
        ownerId: value.ownerId,
        fence: value.fence as number,
        state: value.state,
        leaseUntil: value.leaseUntil,
        ...(value.providerStartedAt === undefined ? {} : {providerStartedAt: value.providerStartedAt}),
    };
}

/** 只接受无原型歧义的 JSON object。 */
function isPlainObject(value: unknown): value is {[key: string]: unknown} {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** strict schema 不允许静默接受未知字段。 */
function hasExactKeys(value: {[key: string]: unknown}, expected: readonly string[]): boolean {
    const actual = Object.keys(value).sort();
    const normalizedExpected = [...expected].sort();
    return actual.length === normalizedExpected.length
        && actual.every((key, index) => key === normalizedExpected[index]);
}

/** 校验可往返的 ISO 时间戳，避免 Date.parse 宽松接受损坏值。 */
function isIsoTimestamp(value: unknown): value is string {
    if (typeof value !== "string") {
        return false;
    }
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

/** 判断路径是否存在，不吞掉权限或 I/O 错误。 */
async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch (error) {
        if (isNodeError(error, "ENOENT")) {
            return false;
        }
        throw error;
    }
}

/** 同目录 temp 写入、文件 fsync、rename，并在平台允许时 fsync 父目录。 */
async function writeDurableFile(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "wx");
    try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }
    try {
        await rename(temporaryPath, path);
    } catch (error) {
        await rm(temporaryPath, {force: true}).catch(() => undefined);
        throw error;
    }
    try {
        const directory = await open(dirname(path), "r");
        try {
            await directory.sync();
        } finally {
            await directory.close();
        }
    } catch (error) {
        if (!isNodeError(error, "EINVAL") && !isNodeError(error, "EPERM") && !isNodeError(error, "EISDIR")) {
            throw error;
        }
    }
}

/** 从 Node I/O 边界读取稳定 error code。 */
function isNodeError(error: unknown, code: string): boolean {
    return error instanceof Error && "code" in error && error.code === code;
}
