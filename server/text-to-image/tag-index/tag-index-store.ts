import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
import {
    TagIndexActivePointerSchema,
    TagIndexOperationSchema,
    TagIndexSourcePageCacheSchema,
    TagIndexSourcePassSchema,
    TagIndexSourceResourceSchema,
    type TagIndexActivePointer,
    type TagIndexOperation,
    type TagIndexOperationLease,
    type TagIndexSourcePageCache,
} from "nbook/shared/text-to-image-tag-index";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";
import {resolveUserNbookRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {TagIndexError} from "nbook/server/text-to-image/tag-index/tag-index-error";
import {
    hashTagIndexActivePointer,
    verifyReadyTagIndexVersion,
} from "nbook/server/text-to-image/tag-index/tag-index-reader";

const FileLockSchema = z.object({
    schemaVersion: z.literal("nbook.tag-index-file-lock/v1"),
    ownerToken: z.string().uuid(),
    expiresAt: z.string().datetime(),
}).strict();

const ActiveOperationPointerSchema = z.object({
    schemaVersion: z.literal("nbook.tag-index-active-operation/v1"),
    operationId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/u),
}).strict();

const OperationIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/u);
const TERMINAL_OPERATION_STATES = new Set<TagIndexOperation["state"]>(["active", "failed", "canceled"]);
const DEFAULT_FILE_LOCK_LEASE_MS = 10_000;
const DEFAULT_FILE_LOCK_RETRY_DELAY_MS = 10;
const DEFAULT_FILE_LOCK_MAX_WAIT_MS = 5_000;

type TagIndexStoreOptions = {
    root?: string;
    now?: () => number;
    lockRetryDelayMs?: number;
    lockMaxWaitMs?: number;
};

/** Workspace Root Tag index 的唯一文件协议与短 CAS 锁。 */
export class TagIndexStore {
    readonly root: string;
    private readonly now: () => number;
    private readonly lockRetryDelayMs: number;
    private readonly lockMaxAttempts: number;

    constructor(options: TagIndexStoreOptions = {}) {
        this.root = path.resolve(options.root ?? path.join(resolveUserNbookRoot(), "cache", "text-to-image", "tags"));
        this.now = options.now ?? Date.now;
        this.lockRetryDelayMs = parseBoundedInteger(options.lockRetryDelayMs ?? DEFAULT_FILE_LOCK_RETRY_DELAY_MS, 1, 1000, "lockRetryDelayMs");
        const maxWait = parseBoundedInteger(options.lockMaxWaitMs ?? DEFAULT_FILE_LOCK_MAX_WAIT_MS, 1, 60_000, "lockMaxWaitMs");
        this.lockMaxAttempts = Math.max(1, Math.ceil(maxWait / this.lockRetryDelayMs));
    }

    /** 创建新 operation；若已有非终态 active operation，则确定性返回它。 */
    async startOperation(input: {operationId: string; termsConfirmationVersion: string}): Promise<TagIndexOperation> {
        const operationId = OperationIdSchema.parse(input.operationId);
        const termsConfirmationVersion = z.string().trim().min(1).max(160).parse(input.termsConfirmationVersion);
        return this.withOperationLock(async () => {
            const active = await this.readActiveOperationUnlocked();
            if (active && !TERMINAL_OPERATION_STATES.has(active.state)) return active;

            await fs.mkdir(this.operationsRoot(), {recursive: true});
            const operationRoot = this.operationRoot(operationId);
            try {
                await fs.mkdir(operationRoot, {recursive: false});
            } catch (error) {
                if (isFsError(error, "EEXIST")) {
                    throw syncError("新 Tag index operationId 已存在", error);
                }
                throw error;
            }
            const timestamp = new Date(this.now()).toISOString();
            const activePointer = await this.readActivePointerState();
            const operation = TagIndexOperationSchema.parse({
                schemaVersion: "nbook.tag-index-operation/v1",
                operationId,
                state: "fetching",
                requestedAt: timestamp,
                updatedAt: timestamp,
                termsConfirmationVersion,
                activeIndexVersionBeforeStart: activePointer.pointer?.indexVersion ?? null,
                activePointerHashBeforeStart: activePointer.pointerHash,
                candidateIndexVersion: null,
                cancelRequestedAt: null,
                retry: null,
                lease: null,
                source: {
                    watermarks: null,
                    pass: "source",
                    resource: "tags",
                    cursors: {
                        source: {tags: 0, aliases: 0, implications: 0},
                        reconciliation: {tags: 0, aliases: 0, implications: 0},
                    },
                    completedResources: {source: [], reconciliation: []},
                    verifiedHashes: null,
                },
                error: null,
            });
            await writeJsonAtomic(this.operationPath(operationId), operation, "create");
            await writeJsonAtomic(this.activeOperationPath(), {
                schemaVersion: "nbook.tag-index-active-operation/v1",
                operationId,
            }, "replace");
            return operation;
        });
    }

    /** 读取 active operation；没有 selector 时返回 null。 */
    async readActiveOperation(): Promise<TagIndexOperation | null> {
        return this.readActiveOperationUnlocked();
    }

    /** 严格读取一个 operation。 */
    async readOperation(operationId: string): Promise<TagIndexOperation> {
        const parsedId = OperationIdSchema.parse(operationId);
        return readJsonStrict(this.operationPath(parsedId), TagIndexOperationSchema, "Tag index operation 损坏");
    }

    /** 领取或接管过期 operation lease，并递增 fencingVersion。 */
    async claimOperation(operationId: string, ownerId: string, leaseMs: number): Promise<TagIndexOperation> {
        const parsedId = OperationIdSchema.parse(operationId);
        const parsedOwner = OperationIdSchema.parse(ownerId);
        const parsedLeaseMs = parseBoundedInteger(leaseMs, 1000, 10 * 60_000, "leaseMs");
        return this.withOperationLock(async () => {
            const current = await this.readOperation(parsedId);
            if (TERMINAL_OPERATION_STATES.has(current.state)) return current;
            const now = this.now();
            if (current.lease && Date.parse(current.lease.leaseUntil) > now && current.lease.ownerId !== parsedOwner) {
                throw syncError("Tag index operation 已由其他 worker 领取");
            }
            const next = TagIndexOperationSchema.parse({
                ...current,
                updatedAt: new Date(now).toISOString(),
                lease: {
                    ownerId: parsedOwner,
                    fencingVersion: (current.lease?.fencingVersion ?? 0) + 1,
                    leaseUntil: new Date(now + parsedLeaseMs).toISOString(),
                },
            });
            await writeJsonAtomic(this.operationPath(parsedId), next, "replace");
            return next;
        });
    }

    /**
     * 以 lease owner/version 做 fenced checkpoint。
     *
     * 当 next 清空 lease 时，调用方必须显式传入写入前持有的 expectedLease。
     */
    async checkpoint(next: TagIndexOperation, expectedLease: TagIndexOperationLease | null = next.lease): Promise<TagIndexOperation> {
        const parsedNext = TagIndexOperationSchema.parse(next);
        return this.withOperationLock(async () => {
            const current = await this.readOperation(parsedNext.operationId);
            assertLease(current.lease, expectedLease, this.now());
            if (parsedNext.operationId !== current.operationId || parsedNext.requestedAt !== current.requestedAt) {
                throw syncError("Tag index checkpoint identity 漂移");
            }
            if (parsedNext.lease && expectedLease
                && (parsedNext.lease.ownerId !== expectedLease.ownerId
                    || parsedNext.lease.fencingVersion !== expectedLease.fencingVersion)) {
                throw syncError("Tag index checkpoint 不能修改 lease fence");
            }
            await writeJsonAtomic(this.operationPath(parsedNext.operationId), parsedNext, "replace");
            return parsedNext;
        });
    }

    /** 对当前 operation 请求取消；未运行时立即进入 canceled。 */
    async cancelOperation(operationId: string): Promise<TagIndexOperation> {
        const parsedId = OperationIdSchema.parse(operationId);
        return this.withOperationLock(async () => {
            const current = await this.readOperation(parsedId);
            if (TERMINAL_OPERATION_STATES.has(current.state)) return current;
            const now = this.now();
            const leaseActive = current.lease && Date.parse(current.lease.leaseUntil) > now;
            const next = TagIndexOperationSchema.parse({
                ...current,
                state: leaseActive ? current.state : "canceled",
                updatedAt: new Date(now).toISOString(),
                cancelRequestedAt: new Date(now).toISOString(),
                retry: null,
                lease: leaseActive ? current.lease : null,
            });
            await writeJsonAtomic(this.operationPath(parsedId), next, "replace");
            return next;
        });
    }

    /** 仅允许当前 leased worker 更新可观测退避状态；不改变同步事实或 cursor。 */
    async updateRetry(
        operationId: string,
        ownerId: string,
        retry: TagIndexOperation["retry"],
    ): Promise<TagIndexOperation> {
        const parsedId = OperationIdSchema.parse(operationId);
        const parsedOwnerId = OperationIdSchema.parse(ownerId);
        return this.withOperationLock(async () => {
            const current = await this.readOperation(parsedId);
            if (!current.lease || current.lease.ownerId !== parsedOwnerId || Date.parse(current.lease.leaseUntil) <= this.now()) {
                throw syncError("只有当前 leased worker 可以更新 Tag index retry 状态");
            }
            const next = TagIndexOperationSchema.parse({
                ...current,
                updatedAt: new Date(this.now()).toISOString(),
                retry,
            });
            await writeJsonAtomic(this.operationPath(parsedId), next, "replace");
            return next;
        });
    }

    /** 显式重试 failed/canceled operation，保留已完成 page/cursor。 */
    async retryOperation(operationId: string): Promise<TagIndexOperation> {
        const parsedId = OperationIdSchema.parse(operationId);
        return this.withOperationLock(async () => {
            const current = await this.readOperation(parsedId);
            if (current.state !== "failed" && current.state !== "canceled") {
                throw syncError("只有 failed/canceled Tag index operation 可以重试");
            }
            const next = TagIndexOperationSchema.parse({
                ...current,
                state: "fetching",
                updatedAt: new Date(this.now()).toISOString(),
                cancelRequestedAt: null,
                retry: null,
                lease: null,
                error: null,
            });
            await writeJsonAtomic(this.operationPath(parsedId), next, "replace");
            await writeJsonAtomic(this.activeOperationPath(), {
                schemaVersion: "nbook.tag-index-active-operation/v1",
                operationId: parsedId,
            }, "replace");
            return next;
        });
    }

    /** 在 fence 校验后 create-only 保存一个 source page；相同内容可幂等重放。 */
    async writeSourcePage(operation: TagIndexOperation, page: TagIndexSourcePageCache): Promise<void> {
        const parsedPage = TagIndexSourcePageCacheSchema.parse(page);
        if (parsedPage.operationId !== operation.operationId || !operation.lease) {
            throw syncError("source page 不属于当前 leased operation");
        }
        await this.withOperationLock(async () => {
            const current = await this.readOperation(operation.operationId);
            assertLease(current.lease, operation.lease, this.now());
            const pagePath = this.sourcePagePath(parsedPage);
            await fs.mkdir(path.dirname(pagePath), {recursive: true});
            const content = renderJson(parsedPage);
            try {
                await writeTextAtomic(pagePath, content, "create");
            } catch (error) {
                if (!isFsError(error, "EEXIST")) throw error;
                const existing = await fs.readFile(pagePath, "utf8");
                if (existing !== content) throw syncError("source page create-only 内容冲突", error);
            }
        });
    }

    /** 严格读取 operation 的全部 source pages，并稳定排序。 */
    async readSourcePages(operationId: string): Promise<TagIndexSourcePageCache[]> {
        const parsedId = OperationIdSchema.parse(operationId);
        const pages: TagIndexSourcePageCache[] = [];
        for (const pass of TagIndexSourcePassSchema.options) {
            for (const resource of TagIndexSourceResourceSchema.options) {
                const directory = path.join(this.operationRoot(parsedId), "source", pass, resource);
                let entries: string[];
                try {
                    entries = await fs.readdir(directory);
                } catch (error) {
                    if (isFsError(error, "ENOENT")) continue;
                    throw error;
                }
                for (const entry of entries.filter((name) => name.endsWith(".json"))) {
                    pages.push(await readJsonStrict(
                        path.join(directory, entry),
                        TagIndexSourcePageCacheSchema,
                        "Tag index source page 损坏",
                    ));
                }
            }
        }
        return pages.sort((left, right) => {
            const passOrder = TagIndexSourcePassSchema.options.indexOf(left.pass) - TagIndexSourcePassSchema.options.indexOf(right.pass);
            if (passOrder !== 0) return passOrder;
            const resourceOrder = TagIndexSourceResourceSchema.options.indexOf(left.resource) - TagIndexSourceResourceSchema.options.indexOf(right.resource);
            if (resourceOrder !== 0) return resourceOrder;
            return left.provenance.cursorStart - right.provenance.cursorStart;
        });
    }

    /** 读取严格 active pointer；损坏与缺失明确区分。 */
    async readActivePointer(): Promise<TagIndexActivePointer | null> {
        try {
            return await readJsonStrict(this.currentPath(), TagIndexActivePointerSchema, "Tag index current pointer 损坏");
        } catch (error) {
            if (isFsError(error, "ENOENT")) return null;
            throw error;
        }
    }

    /** 读取 active pointer 及其 canonical expected-hash；absent 明确返回双 null。 */
    async readActivePointerState(): Promise<{
        pointer: TagIndexActivePointer | null;
        pointerHash: string | null;
    }> {
        const pointer = await this.readActivePointer();
        return pointer
            ? {pointer, pointerHash: hashTagIndexActivePointer(pointer)}
            : {pointer: null, pointerHash: null};
    }

    /**
     * 先验证 immutable ready version，再以 expected current hash 做短锁内 CAS。
     *
     * 同一 target 的重放保留原 activatedAt；stale expected hash 永不覆盖当前 active。
     */
    async activateVersion(input: {
        indexVersion: string;
        manifestHash: string;
        expectedCurrentHash: string | null;
    }): Promise<{pointer: TagIndexActivePointer; pointerHash: string}> {
        const provisional = TagIndexActivePointerSchema.parse({
            schemaVersion: "nbook.tag-index-current/v1",
            indexVersion: input.indexVersion,
            manifestHash: TextToImageContractHashSchema.parse(input.manifestHash),
            activatedAt: new Date(this.now()).toISOString(),
        });
        const expectedCurrentHash = input.expectedCurrentHash === null
            ? null
            : TextToImageContractHashSchema.parse(input.expectedCurrentHash);
        await verifyReadyTagIndexVersion(this.root, provisional, {verifyAllArtifacts: true});

        return this.withOperationLock(async () => {
            const current = await this.readActivePointerState();
            if (current.pointer?.indexVersion === provisional.indexVersion
                && current.pointer.manifestHash === provisional.manifestHash) {
                return {pointer: current.pointer, pointerHash: current.pointerHash!};
            }
            if (current.pointerHash !== expectedCurrentHash) {
                throw new TagIndexError({
                    code: "TAG_INDEX_ACTIVATION_CONFLICT",
                    message: "Tag index active pointer 已变化",
                });
            }
            await writeJsonAtomic(this.currentPath(), provisional, "replace");
            return {pointer: provisional, pointerHash: hashTagIndexActivePointer(provisional)};
        });
    }

    /** 不加锁读取 active operation selector。 */
    private async readActiveOperationUnlocked(): Promise<TagIndexOperation | null> {
        try {
            const pointer = await readJsonStrict(
                this.activeOperationPath(),
                ActiveOperationPointerSchema,
                "Tag index active operation pointer 损坏",
            );
            return this.readOperation(pointer.operationId);
        } catch (error) {
            if (isFsError(error, "ENOENT")) return null;
            throw error;
        }
    }

    /** 以 create-only 短锁串行化 operation 文件 CAS。 */
    private async withOperationLock<TResult>(task: () => Promise<TResult>): Promise<TResult> {
        await fs.mkdir(this.root, {recursive: true});
        const ownerToken = randomUUID();
        const lockPath = path.join(this.root, ".operation.lock");
        for (let attempt = 0; attempt < this.lockMaxAttempts; attempt += 1) {
            let acquired = false;
            try {
                // 锁文件必须以完整内容原子出现：create 模式先写 temp 再 link 发布，
                // 并发读端（reclaim/release）永远不会观察到半截 JSON。
                await writeTextAtomic(lockPath, renderJson({
                    schemaVersion: "nbook.tag-index-file-lock/v1",
                    ownerToken,
                    expiresAt: new Date(this.now() + DEFAULT_FILE_LOCK_LEASE_MS).toISOString(),
                }), "create");
                acquired = true;
            } catch (error) {
                if (!isFsError(error, "EEXIST")) throw error;
                if (await this.reclaimExpiredFileLock(lockPath)) continue;
                await new Promise((resolve) => setTimeout(resolve, this.lockRetryDelayMs));
            }
            if (acquired) {
                try {
                    return await task();
                } finally {
                    await this.releaseFileLock(lockPath, ownerToken);
                }
            }
        }
        throw syncError("等待 Tag index operation 文件锁超时");
    }

    /** 原子重命名过期短锁；未过期不抢占，读不到完整锁内容时按短锁争用退避。 */
    private async reclaimExpiredFileLock(lockPath: string): Promise<boolean> {
        let lockText: string;
        try {
            lockText = await fs.readFile(lockPath, "utf8");
        } catch (error) {
            if (isFsError(error, "ENOENT")) return true;
            if (isFsError(error, "EPERM") || isFsError(error, "EACCES") || isFsError(error, "EBUSY")) return false;
            throw error;
        }
        let lock: z.infer<typeof FileLockSchema>;
        try {
            lock = FileLockSchema.parse(JSON.parse(lockText) as unknown);
        } catch {
            // Windows 下 rename/link 与读取交错仍可能读到瞬时不完整内容；
            // 视为持锁方尚在争用，交给外层有界等待重试，不判定为永久损坏。
            return false;
        }
        if (Date.parse(lock.expiresAt) > this.now()) return false;
        const stalePath = `${lockPath}.stale.${randomUUID()}`;
        try {
            await fs.rename(lockPath, stalePath);
        } catch (error) {
            if (isFsError(error, "ENOENT")) return true;
            return false;
        }
        await fs.unlink(stalePath).catch(() => undefined);
        return true;
    }

    /** 只删除仍属于当前 owner 的短锁。 */
    private async releaseFileLock(lockPath: string, ownerToken: string): Promise<void> {
        try {
            const lock = FileLockSchema.parse(JSON.parse(await fs.readFile(lockPath, "utf8")) as unknown);
            if (lock.ownerToken === ownerToken) await fs.unlink(lockPath);
        } catch (error) {
            if (!isFsError(error, "ENOENT")) throw error;
        }
    }

    private operationsRoot(): string {
        return path.join(this.root, "operations");
    }

    private operationRoot(operationId: string): string {
        return path.join(this.operationsRoot(), OperationIdSchema.parse(operationId));
    }

    private operationPath(operationId: string): string {
        return path.join(this.operationRoot(operationId), "operation.json");
    }

    private activeOperationPath(): string {
        return path.join(this.operationsRoot(), "active.json");
    }

    private currentPath(): string {
        return path.join(this.root, "current.json");
    }

    private sourcePagePath(page: TagIndexSourcePageCache): string {
        return path.join(
            this.operationRoot(page.operationId),
            "source",
            page.pass,
            page.resource,
            `${page.provenance.cursorStart}-${page.provenance.cursorEnd}.json`,
        );
    }
}

/** fenced writer 必须持有当前、未过期的 owner/version。 */
function assertLease(current: TagIndexOperationLease | null, expected: TagIndexOperationLease | null, now: number): void {
    if (!current || !expected || current.ownerId !== expected.ownerId
        || current.fencingVersion !== expected.fencingVersion || Date.parse(current.leaseUntil) <= now) {
        throw syncError("Tag index operation lease/fence 已失效");
    }
}

/** 严格读取 JSON 外部边界。 */
async function readJsonStrict<TOutput>(filePath: string, schema: z.ZodType<TOutput>, message: string): Promise<TOutput> {
    const text = await fs.readFile(filePath, "utf8");
    try {
        const value: unknown = JSON.parse(text);
        return schema.parse(value);
    } catch (error) {
        throw syncError(message, error);
    }
}

/** canonical pretty JSON。 */
function renderJson(value: object): string {
    return `${JSON.stringify(value, null, 4)}\n`;
}

/** 同目录 temp + fsync 后原子 create/replace。 */
async function writeJsonAtomic(filePath: string, value: object, mode: "create" | "replace"): Promise<void> {
    await writeTextAtomic(filePath, renderJson(value), mode);
}

/** 同目录 temp + fsync 后原子 create/replace。 */
async function writeTextAtomic(filePath: string, content: string, mode: "create" | "replace"): Promise<void> {
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
    const handle = await fs.open(temporaryPath, "wx", 0o600);
    try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }
    try {
        if (mode === "create") {
            await fs.link(temporaryPath, filePath);
        } else {
            await fs.rename(temporaryPath, filePath);
        }
    } finally {
        await fs.unlink(temporaryPath).catch(() => undefined);
    }
}

/** 解析有界整数 option。 */
function parseBoundedInteger(value: number, minimum: number, maximum: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${name} 必须是 ${minimum}..${maximum} 的安全整数`);
    }
    return value;
}

/** 创建持久 operation 的 fail-closed 错误。 */
function syncError(message: string, cause?: unknown): TagIndexError {
    return new TagIndexError({
        code: "TAG_INDEX_SYNC_INCOMPLETE",
        message,
        ...(cause instanceof Error ? {cause} : {}),
    });
}

/** 判断 Node fs error code。 */
function isFsError(error: unknown, code: string): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
