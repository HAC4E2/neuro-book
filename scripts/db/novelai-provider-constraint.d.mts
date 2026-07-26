import type {Client} from "@libsql/client";

/** 校验同名 SQLite 索引是否为目标 NovelAI owner partial unique。 */
export function isExpectedNovelAiProviderIndexSql(sql: string): boolean;

/** migration runner 的 NovelAI Provider partial unique 最终化入口。 */
export function finalizeNovelAiProviderConstraint(client: Client): Promise<"not_applicable" | "pending_duplicates" | "enforced">;
