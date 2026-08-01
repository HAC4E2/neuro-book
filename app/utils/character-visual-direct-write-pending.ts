import {z} from "zod";
import {CharacterVisualDirectWriteRequestSchema} from "nbook/shared/text-to-image-character-direct-write";
import {createTextToImageFileHash} from "nbook/shared/text-to-image-file-hash";

const PENDING_SCHEMA_VERSION = "nbook.character-visual-direct-write-pending/v1" as const;
const STORAGE_PREFIX = "nbook:character-visual-direct-write:";

const PendingScopeSchema = CharacterVisualDirectWriteRequestSchema.pick({
    projectPath: true,
    characterPath: true,
}).strict();

const PendingValueSchema = z.object({
    schemaVersion: z.literal(PENDING_SCHEMA_VERSION),
    sourceCharacterFileHash: CharacterVisualDirectWriteRequestSchema.shape.sourceCharacterFileHash,
    idempotencyKey: CharacterVisualDirectWriteRequestSchema.shape.idempotencyKey,
}).strict();

const PendingWriteSchema = PendingScopeSchema.extend({
    sourceCharacterFileHash: PendingValueSchema.shape.sourceCharacterFileHash,
    idempotencyKey: PendingValueSchema.shape.idempotencyKey,
}).strict();

const PendingClearSchema = PendingScopeSchema.extend({
    idempotencyKey: PendingValueSchema.shape.idempotencyKey,
}).strict();

export type PendingDirectWriteScope = z.infer<typeof PendingScopeSchema>;
export type PendingDirectWrite = z.infer<typeof PendingValueSchema>;

/** 以不泄漏原始 Project/角色路径的 scope hash 构造 localStorage key。 */
export function pendingDirectWriteStorageKey(input: PendingDirectWriteScope): string {
    const scope = PendingScopeSchema.parse(input);
    return `${STORAGE_PREFIX}${createTextToImageFileHash(`${scope.projectPath}\0${scope.characterPath}`)}`;
}

/** 读取当前 scope 的严格 pending identity；畸形或缺失条目均视为不可复用。 */
export function readPendingDirectWrite(input: PendingDirectWriteScope, storage?: Storage | null): PendingDirectWrite | null {
    const scope = PendingScopeSchema.parse(input);
    const activeStorage = resolveStorage(storage);
    if (!activeStorage) return null;
    const raw = activeStorage.getItem(pendingDirectWriteStorageKey(scope));
    if (raw === null) return null;
    try {
        const decoded: unknown = JSON.parse(raw);
        const parsed = PendingValueSchema.safeParse(decoded);
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

/** 原子替换当前 scope 的 pending identity；source hash 改变时不会保留旧 UUID。 */
export function writePendingDirectWrite(
    input: PendingDirectWriteScope & {sourceCharacterFileHash: string; idempotencyKey: string},
    storage?: Storage | null,
): void {
    const parsed = PendingWriteSchema.parse(input);
    const activeStorage = resolveStorage(storage);
    if (!activeStorage) return;
    const scope = {projectPath: parsed.projectPath, characterPath: parsed.characterPath};
    activeStorage.setItem(pendingDirectWriteStorageKey(scope), JSON.stringify({
        schemaVersion: PENDING_SCHEMA_VERSION,
        sourceCharacterFileHash: parsed.sourceCharacterFileHash,
        idempotencyKey: parsed.idempotencyKey,
    } satisfies PendingDirectWrite));
}

/** 仅在 idempotency key 仍相同时删除，避免旧响应擦除更新后的 pending identity。 */
export function clearPendingDirectWrite(
    input: PendingDirectWriteScope & {idempotencyKey: string},
    storage?: Storage | null,
): void {
    const parsed = PendingClearSchema.parse(input);
    const activeStorage = resolveStorage(storage);
    if (!activeStorage) return;
    const scope = {projectPath: parsed.projectPath, characterPath: parsed.characterPath};
    const storageKey = pendingDirectWriteStorageKey(scope);
    const current = readPendingDirectWrite(scope, activeStorage);
    if (current?.idempotencyKey === parsed.idempotencyKey) {
        activeStorage.removeItem(storageKey);
    }
}

/** 显式 Storage 优先；SSR 或浏览器禁用 localStorage 时安全退化为空。 */
function resolveStorage(storage: Storage | null | undefined): Storage | null {
    if (storage !== undefined) return storage;
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
        return null;
    }
}
