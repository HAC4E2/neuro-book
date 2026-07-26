/** 将 migration SQL 分割为可逐条执行的完整 SQLite 语句。 */
export function splitSqlStatements(sql: string): string[];
