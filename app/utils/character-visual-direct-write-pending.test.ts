import {describe, expect, it} from "vitest";
import {
    clearPendingDirectWrite,
    pendingDirectWriteStorageKey,
    readPendingDirectWrite,
    writePendingDirectWrite,
} from "nbook/app/utils/character-visual-direct-write-pending";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const KEY_A = "9aa9105b-0c1c-4ad3-9032-20b2aafc7e5f";
const KEY_B = "625932ca-4822-4a3a-9d55-6e7d37ebadcf";
const scope = {projectPath: "workspace/私密小说", characterPath: "lorebook/character/林雪/index.md"};

class MemoryStorage implements Storage {
    private readonly values = new Map<string, string>();

    get length(): number {
        return this.values.size;
    }

    clear(): void {
        this.values.clear();
    }

    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    key(index: number): string | null {
        return [...this.values.keys()][index] ?? null;
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }
}

describe("character visual pending localStorage codec", () => {
    it("只用 scope hash 构造 storage key，不泄漏原始 Project 或角色路径", () => {
        const key = pendingDirectWriteStorageKey(scope);
        expect(key).toMatch(/^nbook:character-visual-direct-write:sha256:[a-f0-9]{64}$/u);
        expect(key).not.toContain(scope.projectPath);
        expect(key).not.toContain(scope.characterPath);
        expect(pendingDirectWriteStorageKey(scope)).toBe(key);
        expect(pendingDirectWriteStorageKey({...scope, characterPath: "lorebook/character/other/index.md"})).not.toBe(key);
    });

    it("只保存 schema、source hash 与 UUID，不保存路径、时间或过期字段", () => {
        const storage = new MemoryStorage();
        writePendingDirectWrite({...scope, sourceCharacterFileHash: HASH_A, idempotencyKey: KEY_A}, storage);

        const raw = storage.getItem(pendingDirectWriteStorageKey(scope));
        expect(JSON.parse(raw ?? "null")).toEqual({
            schemaVersion: "nbook.character-visual-direct-write-pending/v1",
            sourceCharacterFileHash: HASH_A,
            idempotencyKey: KEY_A,
        });
        expect(raw).not.toContain(scope.projectPath);
        expect(raw).not.toContain(scope.characterPath);
        expect(readPendingDirectWrite(scope, storage)).toEqual({
            schemaVersion: "nbook.character-visual-direct-write-pending/v1",
            sourceCharacterFileHash: HASH_A,
            idempotencyKey: KEY_A,
        });
    });

    it("拒绝畸形 JSON、额外字段、错误 hash/UUID 与畸形 scope", () => {
        const storage = new MemoryStorage();
        const storageKey = pendingDirectWriteStorageKey(scope);
        for (const raw of [
            "{bad",
            JSON.stringify({schemaVersion: "nbook.character-visual-direct-write-pending/v1", sourceCharacterFileHash: HASH_A, idempotencyKey: KEY_A, createdAt: 1}),
            JSON.stringify({schemaVersion: "nbook.character-visual-direct-write-pending/v1", sourceCharacterFileHash: "sha256:bad", idempotencyKey: KEY_A}),
            JSON.stringify({schemaVersion: "nbook.character-visual-direct-write-pending/v1", sourceCharacterFileHash: HASH_A, idempotencyKey: "bad"}),
        ]) {
            storage.setItem(storageKey, raw);
            expect(readPendingDirectWrite(scope, storage)).toBeNull();
        }
        expect(() => pendingDirectWriteStorageKey({...scope, characterPath: "../secret"})).toThrow();
        expect(() => writePendingDirectWrite({...scope, projectPath: "", sourceCharacterFileHash: HASH_A, idempotencyKey: KEY_A}, storage)).toThrow();
    });

    it("source hash 改变时原子替换旧 pending identity", () => {
        const storage = new MemoryStorage();
        writePendingDirectWrite({...scope, sourceCharacterFileHash: HASH_A, idempotencyKey: KEY_A}, storage);
        writePendingDirectWrite({...scope, sourceCharacterFileHash: HASH_B, idempotencyKey: KEY_B}, storage);
        expect(storage.length).toBe(1);
        expect(readPendingDirectWrite(scope, storage)).toMatchObject({sourceCharacterFileHash: HASH_B, idempotencyKey: KEY_B});
    });

    it("只删除 idempotency key 仍匹配的 pending identity", () => {
        const storage = new MemoryStorage();
        writePendingDirectWrite({...scope, sourceCharacterFileHash: HASH_B, idempotencyKey: KEY_B}, storage);
        clearPendingDirectWrite({...scope, idempotencyKey: KEY_A}, storage);
        expect(readPendingDirectWrite(scope, storage)?.idempotencyKey).toBe(KEY_B);
        clearPendingDirectWrite({...scope, idempotencyKey: KEY_B}, storage);
        expect(readPendingDirectWrite(scope, storage)).toBeNull();
    });

    it("SSR 无 Storage 时安全返回且不写入", () => {
        expect(readPendingDirectWrite(scope, null)).toBeNull();
        expect(() => writePendingDirectWrite({...scope, sourceCharacterFileHash: HASH_A, idempotencyKey: KEY_A}, null)).not.toThrow();
        expect(() => clearPendingDirectWrite({...scope, idempotencyKey: KEY_A}, null)).not.toThrow();
    });
});
