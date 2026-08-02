import {stat} from "node:fs/promises";

import LibsqlDatabase from "libsql";
import {load as loadSqliteVec} from "sqlite-vec";

import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";

/** RAG SQLite 允许绑定的领域值；Float32Array 会在 Adapter 边界转成 sqlite-vec JSON vector。 */
export type SqliteVecParameter = string | number | bigint | null | Float32Array;

/** RAG 模块共同消费的同步 SQLite 能力。返回值由外部驱动决定，因此保持 unknown。 */
export type SqliteVecDatabase = {
    run(sql: string, ...params: SqliteVecParameter[]): unknown;
    query(sql: string): {
        all(...params: SqliteVecParameter[]): unknown[];
        get(...params: SqliteVecParameter[]): unknown;
    };
    transaction<TArgs extends SqliteVecParameter[], TResult>(
        fn: (...args: TArgs) => TResult,
    ): (...args: TArgs) => TResult;
    close(): void;
};

/**
 * 打开跨平台 RAG SQLite 连接，并按需加载 sqlite-vec。
 *
 * Product 只使用 libsql native binding，避免 Bun macOS SQLite 禁止动态扩展加载。
 * libsql 0.5 的 readonly 构造参数没有真实生效，因此只读连接在打开前确认文件存在，
 * 并由 SQLite 自身的 query_only pragma 约束。
 */
export async function openSqliteVecDatabase(input: {
    path: string;
    readonly?: boolean;
    loadExtension: boolean;
    initialize?(database: SqliteVecDatabase): void | Promise<void>;
}): Promise<SqliteVecDatabase> {
    if (input.readonly) {
        const file = await stat(input.path);
        if (!file.isFile()) throw new Error(`RAG SQLite 路径不是文件：${input.path}`);
    }

    const database = new LibsqlVecDatabase(input.path);
    try {
        if (input.readonly) database.enableReadonly();
        if (input.loadExtension) database.loadExtension();
        await input.initialize?.(database);
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

/** 把 libsql native handle 收窄到 RAG 合同，并在 close 后切断唯一长期引用。 */
class LibsqlVecDatabase implements SqliteVecDatabase {
    private database: LibsqlDatabase.Database | null;

    /** 打开一个 libsql native handle。 */
    constructor(path: string) {
        this.database = new LibsqlDatabase(path);
    }

    /** 执行不返回结果集的 SQL。 */
    run(sql: string, ...params: SqliteVecParameter[]): unknown {
        const database = this.openDatabase;
        if (params.length === 0) {
            database.exec(sql);
            return undefined;
        }
        return database.prepare(sql).run(...params.map(normalizeParameter));
    }

    /** 创建只保留 SQL 文本的查询入口，statement 不跨调用存活。 */
    query(sql: string): ReturnType<SqliteVecDatabase["query"]> {
        return {
            all: (...params) => this.openDatabase.prepare(sql).all(...params.map(normalizeParameter)),
            get: (...params) => this.openDatabase.prepare(sql).get(...params.map(normalizeParameter)),
        };
    }

    /** 使用 IMMEDIATE 事务保持原有 RAG 单写者语义。 */
    transaction<TArgs extends SqliteVecParameter[], TResult>(
        fn: (...args: TArgs) => TResult,
    ): (...args: TArgs) => TResult {
        return (...args) => {
            const database = this.openDatabase;
            database.exec("BEGIN IMMEDIATE");
            try {
                const result = fn(...args);
                database.exec("COMMIT");
                return result;
            } catch (error) {
                database.exec("ROLLBACK");
                throw error;
            }
        };
    }

    /** 由 SQLite connection pragma 强制只读。 */
    enableReadonly(): void {
        this.openDatabase.exec("PRAGMA query_only = ON");
    }

    /** 在当前连接登记 sqlite-vec extension。 */
    loadExtension(): void {
        loadSqliteVec(this.openDatabase);
    }

    /** 关闭 native handle，并切断 wrapper 对它的引用。 */
    close(): void {
        this.openDatabase.close();
        this.database = null;
        collectReleasedSqliteHandles();
    }

    /** 返回仍由当前 Adapter 持有的 handle。 */
    private get openDatabase(): LibsqlDatabase.Database {
        if (!this.database) throw new Error("RAG SQLite 连接已经关闭。");
        return this.database;
    }
}

/** 避免 libsql native binding 接收 Float32Array 时 panic，并统一 64 位整数语义。 */
function normalizeParameter(value: SqliteVecParameter): string | number | bigint | null {
    if (value instanceof Float32Array) return JSON.stringify(Array.from(value));
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
    return value;
}
