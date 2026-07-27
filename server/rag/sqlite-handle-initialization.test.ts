import {describe, expect, it, vi} from "vitest";
import {initializeSqliteHandle, openSqliteHandle, type SqliteRuntimeKind} from "nbook/server/rag/sqlite-handle-initialization";

describe("RAG SQLite handle 初始化", () => {
    it.each<SqliteRuntimeKind>(["bun", "node"])("%s 分支创建的 handle 在异步初始化失败后立即关闭", async (runtime) => {
        const bunDatabase = {close: vi.fn()};
        const nodeDatabase = {close: vi.fn()};
        const openBun = vi.fn(async () => bunDatabase);
        const openNode = vi.fn(async () => nodeDatabase);
        const failure = new Error("injected sqlite-vec import failure");

        await expect(openSqliteHandle({
            runtime,
            openBun,
            openNode,
            async initialize() {
                throw failure;
            },
        })).rejects.toBe(failure);

        const selected = runtime === "bun" ? bunDatabase : nodeDatabase;
        const unselected = runtime === "bun" ? nodeDatabase : bunDatabase;
        expect(selected.close).toHaveBeenCalledOnce();
        expect(unselected.close).not.toHaveBeenCalled();
        expect(openBun).toHaveBeenCalledTimes(runtime === "bun" ? 1 : 0);
        expect(openNode).toHaveBeenCalledTimes(runtime === "node" ? 1 : 0);
    });

    it.each(["sqlite-vec load", "schema"])("%s 同步初始化失败后立即关闭", async (stage) => {
        const close = vi.fn();
        const database = {close};
        const failure = new Error(`injected ${stage} failure`);

        await expect(initializeSqliteHandle(database, () => {
            throw failure;
        })).rejects.toBe(failure);

        expect(close).toHaveBeenCalledOnce();
    });

    it("初始化成功时不抢先关闭，由调用方继续持有并关闭", async () => {
        const close = vi.fn();
        const database = {close};

        await expect(initializeSqliteHandle(database, async () => undefined)).resolves.toBe(database);
        expect(close).not.toHaveBeenCalled();

        database.close();
        expect(close).toHaveBeenCalledOnce();
    });
});
