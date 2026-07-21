-- 在任何 Project 写入前持久化用户选择；跨库失败后只能恢复同一决定。
CREATE TABLE IF NOT EXISTS "TextToImageProviderReconciliation" (
    "ownerUserId" INTEGER NOT NULL PRIMARY KEY,
    "selectionToken" TEXT NOT NULL,
    "keepProviderId" INTEGER NOT NULL,
    "discardedProvidersJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TextToImageProviderReconciliation_ownerUserId_fkey"
        FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 过渡期允许既有重复数据继续启动到显式选择 UI，但数据库必须立即阻止产生新的重复。
CREATE TRIGGER IF NOT EXISTS "one_novelai_provider_per_owner_insert_transition"
BEFORE INSERT ON "TextToImageProvider"
WHEN NEW."kind" = 'novelai'
    AND EXISTS (
        SELECT 1
        FROM "TextToImageProvider"
        WHERE "ownerUserId" = NEW."ownerUserId" AND "kind" = 'novelai'
    )
BEGIN
    SELECT RAISE(ABORT, 'TEXT_TO_IMAGE_NOVELAI_PROVIDER_UNIQUE');
END;

CREATE TRIGGER IF NOT EXISTS "one_novelai_provider_per_owner_update_transition"
BEFORE UPDATE OF "ownerUserId", "kind" ON "TextToImageProvider"
WHEN NEW."kind" = 'novelai'
    AND EXISTS (
        SELECT 1
        FROM "TextToImageProvider"
        WHERE "ownerUserId" = NEW."ownerUserId"
            AND "kind" = 'novelai'
            AND "id" <> NEW."id"
    )
BEGIN
    SELECT RAISE(ABORT, 'TEXT_TO_IMAGE_NOVELAI_PROVIDER_UNIQUE');
END;
