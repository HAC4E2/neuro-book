PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_TextToImageProvider" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ownerUserId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "model" TEXT,
    "recipeMigrationModel" TEXT,
    "credentialCiphertext" TEXT NOT NULL,
    "credentialIv" TEXT NOT NULL,
    "credentialTag" TEXT NOT NULL,
    "settings" JSON NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TextToImageProvider_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_TextToImageProvider" (
    "id", "ownerUserId", "kind", "name", "baseUrl", "model", "recipeMigrationModel",
    "credentialCiphertext", "credentialIv", "credentialTag", "settings", "createdAt", "updatedAt"
)
SELECT
    "id", "ownerUserId", "kind", "name", "baseUrl",
    CASE WHEN "kind" = 'novelai' THEN NULL ELSE "model" END,
    CASE WHEN "kind" = 'novelai' THEN "model" ELSE NULL END,
    "credentialCiphertext", "credentialIv", "credentialTag", "settings", "createdAt", "updatedAt"
FROM "TextToImageProvider";

DROP TABLE "TextToImageProvider";
ALTER TABLE "new_TextToImageProvider" RENAME TO "TextToImageProvider";
CREATE UNIQUE INDEX "TextToImageProvider_ownerUserId_name_key" ON "TextToImageProvider"("ownerUserId", "name");
CREATE INDEX "TextToImageProvider_ownerUserId_kind_idx" ON "TextToImageProvider"("ownerUserId", "kind");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
