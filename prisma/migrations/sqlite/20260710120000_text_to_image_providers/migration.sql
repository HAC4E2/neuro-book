CREATE TABLE "TextToImageProvider" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ownerUserId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "credentialCiphertext" TEXT NOT NULL,
    "credentialIv" TEXT NOT NULL,
    "credentialTag" TEXT NOT NULL,
    "settings" JSON NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TextToImageProvider_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TextToImageProvider_ownerUserId_name_key" ON "TextToImageProvider"("ownerUserId", "name");
CREATE INDEX "TextToImageProvider_ownerUserId_kind_idx" ON "TextToImageProvider"("ownerUserId", "kind");
