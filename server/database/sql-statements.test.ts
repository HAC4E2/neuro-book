import {readFile} from "node:fs/promises";
import {createClient} from "@libsql/client";
import {describe, expect, it} from "vitest";
import {splitSqlStatements} from "nbook/scripts/db/sql-statements.mjs";
import {
    finalizeNovelAiProviderConstraint,
    isExpectedNovelAiProviderIndexSql,
} from "nbook/scripts/db/novelai-provider-constraint.mjs";

describe("SQLite migration statement splitter", () => {
    it("keeps each singleton transition trigger intact and executable", async () => {
        const sql = await readFile("prisma/migrations/sqlite/20260719140000_novelai_provider_singleton_transition/migration.sql", "utf8");
        const statements = splitSqlStatements(sql);
        expect(statements).toHaveLength(3);
        expect(statements.filter((statement) => /\bCREATE TRIGGER\b/iu.test(statement))).toHaveLength(2);
        expect(statements.filter((statement) => /\bCREATE TRIGGER\b/iu.test(statement)).every((statement) => /\bEND$/iu.test(statement))).toBe(true);

        const client = createClient({url: ":memory:"});
        try {
            await client.execute(`CREATE TABLE "TextToImageProvider" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "ownerUserId" INTEGER NOT NULL, "kind" TEXT NOT NULL)`);
            await client.execute(`INSERT INTO "TextToImageProvider" ("ownerUserId", "kind") VALUES (1, 'novelai'), (1, 'novelai')`);
            for (const statement of statements) {
                await client.execute(statement);
            }
            await expect(client.execute(`INSERT INTO "TextToImageProvider" ("ownerUserId", "kind") VALUES (2, 'novelai')`)).resolves.toBeDefined();
            await expect(client.execute(`INSERT INTO "TextToImageProvider" ("ownerUserId", "kind") VALUES (2, 'novelai')`)).rejects.toThrow("TEXT_TO_IMAGE_NOVELAI_PROVIDER_UNIQUE");
            await client.execute(`INSERT INTO "TextToImageProvider" ("ownerUserId", "kind") VALUES (3, 'openai_compatible'), (3, 'openai_compatible')`);
            await client.execute(`UPDATE "TextToImageProvider" SET "kind" = 'novelai' WHERE "id" = (SELECT MIN("id") FROM "TextToImageProvider" WHERE "ownerUserId" = 3)`);
            await expect(client.execute(`UPDATE "TextToImageProvider" SET "kind" = 'novelai' WHERE "id" = (SELECT MAX("id") FROM "TextToImageProvider" WHERE "ownerUserId" = 3)`)).rejects.toThrow("TEXT_TO_IMAGE_NOVELAI_PROVIDER_UNIQUE");
            await client.execute(`DELETE FROM "TextToImageProvider" WHERE "id" = (SELECT MAX("id") FROM "TextToImageProvider" WHERE "ownerUserId" = 1 AND "kind" = 'novelai')`);
            await expect(finalizeNovelAiProviderConstraint(client)).resolves.toBe("enforced");
            const index = await client.execute(`SELECT "sql" FROM "sqlite_master" WHERE "type" = 'index' AND "name" = 'one_novelai_provider_per_owner'`);
            expect(String(index.rows[0]?.sql ?? "")).toContain(`WHERE "kind" = 'novelai'`);
            expect(isExpectedNovelAiProviderIndexSql(String(index.rows[0]?.sql ?? ""))).toBe(true);
            await expect(client.execute(`INSERT INTO "TextToImageProvider" ("ownerUserId", "kind") VALUES (2, 'novelai')`)).rejects.toThrow(/UNIQUE constraint failed/iu);
        } finally {
            await client.close();
        }
    });

    it("fails closed when the reserved index name points to a different definition", async () => {
        expect(isExpectedNovelAiProviderIndexSql(`CREATE INDEX "one_novelai_provider_per_owner" ON "TextToImageProvider" ("ownerUserId")`)).toBe(false);
        expect(isExpectedNovelAiProviderIndexSql(`CREATE UNIQUE INDEX "one_novelai_provider_per_owner" ON "TextToImageProvider" ("ownerUserId") WHERE "kind" = 'openai_compatible'`)).toBe(false);

        const client = createClient({url: ":memory:"});
        try {
            await client.execute(`CREATE TABLE "TextToImageProvider" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "ownerUserId" INTEGER NOT NULL, "kind" TEXT NOT NULL)`);
            await client.execute(`CREATE INDEX "one_novelai_provider_per_owner" ON "TextToImageProvider" ("ownerUserId")`);
            await expect(finalizeNovelAiProviderConstraint(client)).rejects.toThrow("非目标定义占用");
        } finally {
            await client.close();
        }
    });

    it("adds a positive credentialRevision with a deterministic default", async () => {
        const sql = await readFile("prisma/migrations/sqlite/20260721190000_novelai_provider_credential_revision/migration.sql", "utf8");
        const statements = splitSqlStatements(sql);
        expect(statements).toHaveLength(1);

        const client = createClient({url: ":memory:"});
        try {
            await client.execute(`CREATE TABLE "TextToImageProvider" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "ownerUserId" INTEGER NOT NULL, "kind" TEXT NOT NULL)`);
            await client.execute(`INSERT INTO "TextToImageProvider" ("ownerUserId", "kind") VALUES (1, 'novelai')`);
            await client.execute(statements[0] ?? "");
            const row = await client.execute(`SELECT "credentialRevision" FROM "TextToImageProvider" WHERE "id" = 1`);
            expect(Number(row.rows[0]?.credentialRevision)).toBe(1);
            await expect(client.execute(`UPDATE "TextToImageProvider" SET "credentialRevision" = 0 WHERE "id" = 1`)).rejects.toThrow();
        } finally {
            await client.close();
        }
    });
});
