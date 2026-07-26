const EXPECTED_INDEX_SQL = `
    CREATE UNIQUE INDEX "one_novelai_provider_per_owner"
    ON "TextToImageProvider" ("ownerUserId")
    WHERE "kind" = 'novelai'
`;

/**
 * 校验保留索引名是否确实指向目标 partial unique，避免错误同名索引导致过渡 trigger 被误删。
 */
export function isExpectedNovelAiProviderIndexSql(sql) {
    return normalizeIndexSql(sql) === normalizeIndexSql(EXPECTED_INDEX_SQL);
}

/**
 * migration runner 使用的最终化入口：有旧重复时保留 transition trigger；无重复时切到精确 partial unique。
 */
export async function finalizeNovelAiProviderConstraint(client) {
    const table = await client.execute(`SELECT 1 FROM "sqlite_master" WHERE "type" = 'table' AND "name" = 'TextToImageProvider' LIMIT 1`);
    if (table.rows.length === 0) {
        return "not_applicable";
    }
    await client.execute("BEGIN IMMEDIATE");
    try {
        const installed = await client.execute(`
            SELECT "sql"
            FROM "sqlite_master"
            WHERE "type" = 'index' AND "name" = 'one_novelai_provider_per_owner'
            LIMIT 1
        `);
        if (installed.rows.length > 0) {
            if (!isExpectedNovelAiProviderIndexSql(String(installed.rows[0]?.sql ?? ""))) {
                throw new Error("NovelAI Provider singleton 索引名称已被非目标定义占用；已停止删除过渡 trigger");
            }
            await dropTransitionTriggers(client);
            await client.execute("COMMIT");
            return "enforced";
        }
        const duplicates = await client.execute(`
            SELECT "ownerUserId"
            FROM "TextToImageProvider"
            WHERE "kind" = 'novelai'
            GROUP BY "ownerUserId"
            HAVING COUNT(*) > 1
            LIMIT 1
        `);
        if (duplicates.rows.length > 0) {
            await client.execute("COMMIT");
            return "pending_duplicates";
        }
        await client.execute(EXPECTED_INDEX_SQL);
        await dropTransitionTriggers(client);
        await client.execute("COMMIT");
        return "enforced";
    } catch (error) {
        await client.execute("ROLLBACK");
        throw error;
    }
}

/** 只归一化 SQLite 不影响语义的格式差异。 */
function normalizeIndexSql(sql) {
    return String(sql ?? "")
        .toLowerCase()
        .replace(/\bif\s+not\s+exists\b/gu, "")
        .replace(/["`\[\]]/gu, "")
        .replace(/\s+/gu, "");
}

async function dropTransitionTriggers(client) {
    await client.execute(`DROP TRIGGER IF EXISTS "one_novelai_provider_per_owner_insert_transition"`);
    await client.execute(`DROP TRIGGER IF EXISTS "one_novelai_provider_per_owner_update_transition"`);
}
