ALTER TABLE "TextToImageProvider"
ADD COLUMN "credentialRevision" INTEGER NOT NULL DEFAULT 1
CHECK ("credentialRevision" >= 1);
