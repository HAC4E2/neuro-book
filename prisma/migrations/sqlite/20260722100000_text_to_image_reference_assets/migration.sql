-- P5 参考资产表：内容寻址的 Vibe/Character Reference/Inpaint 蒙版与派生 Vibe encoding。
CREATE TABLE "TextToImageReferenceAsset" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "parentAssetId" TEXT,
    "derivedModel" TEXT,
    "derivedInfoExtracted" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TextToImageReferenceAsset_contentHash_pkey" UNIQUE ("contentHash"),
    CONSTRAINT "TextToImageReferenceAsset_relativePath_pkey" UNIQUE ("relativePath")
);

CREATE INDEX "TextToImageReferenceAsset_kind_createdAt_idx" ON "TextToImageReferenceAsset" ("kind", "createdAt");
CREATE INDEX "TextToImageReferenceAsset_parentAssetId_idx" ON "TextToImageReferenceAsset" ("parentAssetId");
CREATE INDEX "TextToImageReferenceAsset_parentAssetId_derivedModel_derivedInfoExtracted_idx"
    ON "TextToImageReferenceAsset" ("parentAssetId", "derivedModel", "derivedInfoExtracted");
