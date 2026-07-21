/** Tag index SQLite 只接受 SQLite 原生标量，不暴露任意对象参数。 */
export type TagIndexSqliteValue = null | number | bigint | string | Uint8Array;

/** SQLite 行是受控标量列集合；具体查询仍应在调用点做字段收窄。 */
export type TagIndexSqliteRow = {[column: string]: TagIndexSqliteValue};

export type TagIndexSqliteStatement = {
    all(...params: TagIndexSqliteValue[]): TagIndexSqliteRow[];
    get(...params: TagIndexSqliteValue[]): TagIndexSqliteRow | null;
    run(...params: TagIndexSqliteValue[]): void;
};

/** 不暴露 loadExtension，因此 Tag index runtime 无法加载 sqlite-vec 或任意 native extension。 */
export type TagIndexDatabase = {
    exec(sql: string): void;
    run(sql: string, ...params: TagIndexSqliteValue[]): void;
    query(sql: string): TagIndexSqliteStatement;
    close(): void;
};

type BunSqliteStatement = {
    all(...params: TagIndexSqliteValue[]): TagIndexSqliteRow[];
    get(...params: TagIndexSqliteValue[]): TagIndexSqliteRow | null;
    run(...params: TagIndexSqliteValue[]): void;
};

type BunSqliteDatabase = {
    exec(sql: string): void;
    run(sql: string, ...params: TagIndexSqliteValue[]): void;
    query(sql: string): BunSqliteStatement;
    close(): void;
};

type BunSqliteModule = {
    Database: new (path: string, options?: {readonly?: boolean; create?: boolean; strict?: boolean}) => BunSqliteDatabase;
};

type NodeSqliteStatement = {
    all(...params: TagIndexSqliteValue[]): TagIndexSqliteRow[];
    get(...params: TagIndexSqliteValue[]): TagIndexSqliteRow | undefined;
    run(...params: TagIndexSqliteValue[]): void;
};

type NodeSqliteDatabase = {
    exec(sql: string): void;
    prepare(sql: string): NodeSqliteStatement;
    close(): void;
};

type NodeSqliteModule = {
    DatabaseSync: new (path: string, options?: {readOnly?: boolean; allowExtension?: boolean}) => NodeSqliteDatabase;
};

/**
 * 打开 Tag index SQLite。
 *
 * Bun 与 Node 仅在这个外部 runtime 边界做 API 适配；`allowExtension=false` 是固定安全策略。
 */
export async function openTagIndexDatabase(
    databasePath: string,
    options: {readOnly: boolean},
): Promise<TagIndexDatabase> {
    if ("Bun" in globalThis) {
        const sqliteSpecifier = "bun:sqlite";
        const sqlite = await import(sqliteSpecifier) as BunSqliteModule;
        const database = new sqlite.Database(databasePath, {
            readonly: options.readOnly,
            create: !options.readOnly,
            strict: true,
        });
        return wrapBunDatabase(database);
    }
    const sqliteSpecifier = "node:sqlite";
    // Node 内置模块的类型在当前 Bun 主导的 tsconfig 中不可见，只在此处做结构收窄。
    const sqlite = await import(sqliteSpecifier) as unknown as NodeSqliteModule;
    const database = new sqlite.DatabaseSync(databasePath, {
        readOnly: options.readOnly,
        allowExtension: false,
    });
    return wrapNodeDatabase(database);
}

/** 把 Bun SQLite 显式收窄为禁止扩展的最小接口。 */
function wrapBunDatabase(database: BunSqliteDatabase): TagIndexDatabase {
    return {
        exec(sql) {
            database.exec(sql);
        },
        run(sql, ...params) {
            database.run(sql, ...params);
        },
        query(sql) {
            const statement = database.query(sql);
            return {
                all(...params) {
                    return statement.all(...params);
                },
                get(...params) {
                    return statement.get(...params) ?? null;
                },
                run(...params) {
                    statement.run(...params);
                },
            };
        },
        close() {
            database.close();
        },
    };
}

/** 把 Node SQLite prepare/exec API 适配为与 Bun 相同的最小接口。 */
function wrapNodeDatabase(database: NodeSqliteDatabase): TagIndexDatabase {
    return {
        exec(sql) {
            database.exec(sql);
        },
        run(sql, ...params) {
            if (params.length === 0) {
                database.exec(sql);
                return;
            }
            database.prepare(sql).run(...params);
        },
        query(sql) {
            const statement = database.prepare(sql);
            return {
                all(...params) {
                    return statement.all(...params);
                },
                get(...params) {
                    return statement.get(...params) ?? null;
                },
                run(...params) {
                    statement.run(...params);
                },
            };
        },
        close() {
            database.close();
        },
    };
}
