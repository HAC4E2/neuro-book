import {Pool} from "pg";

type GlobalAgentSqlPool = {
    agentSqlPool?: Pool;
};

const globalForAgentSqlPool = globalThis as typeof globalThis & GlobalAgentSqlPool;

/**
 * 获取 Agent 专用 PostgreSQL 连接池。
 */
export const useAgentSqlPool = (): Pool => {
    if (globalForAgentSqlPool.agentSqlPool) {
        return globalForAgentSqlPool.agentSqlPool;
    }

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error("DATABASE_URL 未配置，无法初始化 Agent SQL 连接");
    }

    globalForAgentSqlPool.agentSqlPool = new Pool({
        connectionString: databaseUrl,
    });
    return globalForAgentSqlPool.agentSqlPool;
};
