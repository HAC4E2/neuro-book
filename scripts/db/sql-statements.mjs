/**
 * 将 migration SQL 分割为可逐条事务执行的语句。
 * SQLite trigger 的 BEGIN...END body 允许内部分号，必须整体保留为一条 DDL。
 *
 * @param {string} sql
 * @returns {string[]}
 */
export function splitSqlStatements(sql) {
    const statements = [];
    let current = "";
    let index = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inLineComment = false;
    let inBlockComment = false;

    while (index < sql.length) {
        const char = sql[index] ?? "";
        const nextChar = sql[index + 1] ?? "";

        if (inLineComment) {
            current += char;
            if (char === "\n" || char === "\r") {
                inLineComment = false;
            }
            index++;
            continue;
        }
        if (inBlockComment) {
            current += char;
            if (char === "*" && nextChar === "/") {
                current += nextChar;
                inBlockComment = false;
                index += 2;
                continue;
            }
            index++;
            continue;
        }
        if (inSingleQuote) {
            current += char;
            if (char === "'" && nextChar === "'") {
                current += nextChar;
                index += 2;
                continue;
            }
            if (char === "'") {
                inSingleQuote = false;
            }
            index++;
            continue;
        }
        if (inDoubleQuote) {
            current += char;
            if (char === "\"" && nextChar === "\"") {
                current += nextChar;
                index += 2;
                continue;
            }
            if (char === "\"") {
                inDoubleQuote = false;
            }
            index++;
            continue;
        }
        if (char === "-" && nextChar === "-") {
            current += char + nextChar;
            inLineComment = true;
            index += 2;
            continue;
        }
        if (char === "/" && nextChar === "*") {
            current += char + nextChar;
            inBlockComment = true;
            index += 2;
            continue;
        }
        if (char === "'") {
            inSingleQuote = true;
            current += char;
            index++;
            continue;
        }
        if (char === "\"") {
            inDoubleQuote = true;
            current += char;
            index++;
            continue;
        }
        if (char === ";") {
            const statement = current.trim();
            const isTrigger = /\bCREATE\s+TRIGGER\b/iu.test(statement);
            if (isTrigger && !/\bEND\s*$/iu.test(statement)) {
                current += char;
                index++;
                continue;
            }
            if (statement) {
                statements.push(statement);
            }
            current = "";
            index++;
            continue;
        }
        current += char;
        index++;
    }

    const last = current.trim();
    if (last) {
        statements.push(last);
    }
    return statements;
}
