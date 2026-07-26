/** SQLite handle 在初始化阶段需要提供的最小关闭能力。 */
export type InitializingSqliteHandle = {
    close(): void;
};

/** NeuroBook server 支持的 SQLite runtime。 */
export type SqliteRuntimeKind = "bun" | "node";

/** 按当前进程能力选择 SQLite runtime。 */
export function currentSqliteRuntime(): SqliteRuntimeKind {
    return "Bun" in globalThis ? "bun" : "node";
}

/**
 * 创建当前 runtime 的 SQLite handle，并完成取得 ownership 前的全部初始化。
 * 未选中的 runtime factory 不会执行。
 */
export async function openSqliteHandle<TDatabase extends InitializingSqliteHandle>(input: {
    runtime: SqliteRuntimeKind;
    openBun(): TDatabase | Promise<TDatabase>;
    openNode(): TDatabase | Promise<TDatabase>;
    initialize(database: TDatabase): void | Promise<void>;
}): Promise<TDatabase> {
    const database = input.runtime === "bun"
        ? await input.openBun()
        : await input.openNode();
    return initializeSqliteHandle(database, input.initialize);
}

/**
 * 对已经创建的 SQLite handle 执行后续初始化。
 *
 * 动态扩展导入、扩展加载或 schema 建立任一失败时，调用方尚未取得 handle，
 * 因此必须在这里同步关闭；成功时 ownership 原样转交给调用方。
 */
export async function initializeSqliteHandle<TDatabase extends InitializingSqliteHandle>(
    database: TDatabase,
    initialize: (database: TDatabase) => void | Promise<void>,
): Promise<TDatabase> {
    try {
        await initialize(database);
        return database;
    } catch (error) {
        try {
            database.close();
        } catch (closeError) {
            throw new AggregateError([error, closeError], "SQLite 初始化失败，且释放数据库 handle 时再次失败。");
        }
        throw error;
    }
}
