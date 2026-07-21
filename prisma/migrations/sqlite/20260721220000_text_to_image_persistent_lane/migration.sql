-- Route B App-owned cross-Project dispatch preparation and persistent NovelAI lane.
CREATE TABLE "TextToImageDispatchPreparation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "manifestHash" TEXT NOT NULL,
    "ownerUserId" INTEGER NOT NULL,
    "providerId" INTEGER NOT NULL,
    "providerCredentialRevision" INTEGER NOT NULL CHECK ("providerCredentialRevision" >= 1),
    "projectId" TEXT NOT NULL,
    "projectPath" TEXT NOT NULL,
    "prepareAttemptId" TEXT NOT NULL,
    "prepareLeaseUntil" DATETIME NOT NULL,
    "prepareVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("prepareVersion" >= 1),
    "stateVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("stateVersion" >= 1),
    "state" TEXT NOT NULL DEFAULT 'prepared' CHECK ("state" IN ('prepared', 'project_committed', 'ready', 'abandoned', 'quarantined')),
    "jobIdsJson" TEXT NOT NULL,
    "dispatchKeysJson" TEXT NOT NULL,
    "quarantineCode" TEXT,
    "quarantineMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (("state" = 'quarantined' AND "quarantineCode" IS NOT NULL AND "quarantineMessage" IS NOT NULL)
        OR ("state" <> 'quarantined' AND "quarantineCode" IS NULL AND "quarantineMessage" IS NULL))
);

CREATE UNIQUE INDEX "TextToImageDispatchPreparation_manifestHash_key" ON "TextToImageDispatchPreparation"("manifestHash");
CREATE INDEX "TextToImageDispatchPreparation_state_prepareLeaseUntil_idx" ON "TextToImageDispatchPreparation"("state", "prepareLeaseUntil");
CREATE INDEX "TextToImageDispatchPreparation_ownerUserId_providerId_state_idx" ON "TextToImageDispatchPreparation"("ownerUserId", "providerId", "state");
CREATE INDEX "TextToImageDispatchPreparation_projectId_state_idx" ON "TextToImageDispatchPreparation"("projectId", "state");

CREATE TABLE "TextToImageProviderLaneItem" (
    "dispatchKey" TEXT NOT NULL PRIMARY KEY,
    "preparationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "ownerUserId" INTEGER NOT NULL,
    "providerId" INTEGER NOT NULL,
    "providerCredentialRevision" INTEGER NOT NULL CHECK ("providerCredentialRevision" >= 1),
    "projectId" TEXT NOT NULL,
    "projectPath" TEXT NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "prepareAttemptId" TEXT NOT NULL,
    "prepareVersion" INTEGER NOT NULL CHECK ("prepareVersion" >= 1),
    "state" TEXT NOT NULL DEFAULT 'prepared' CHECK ("state" IN ('prepared', 'ready', 'leased', 'retry_wait', 'retry_leased', 'attempt_started', 'completed', 'failed', 'outcome_unknown', 'quarantined')),
    "stateVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("stateVersion" >= 1),
    "claimId" TEXT,
    "claimLeaseUntil" DATETIME,
    "sendAttemptId" TEXT,
    "sendLeaseUntil" DATETIME,
    "sendFence" INTEGER,
    "attemptCount" INTEGER NOT NULL DEFAULT 0 CHECK ("attemptCount" >= 0),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (("claimId" IS NULL) = ("claimLeaseUntil" IS NULL)),
    CHECK (("sendAttemptId" IS NULL AND "sendLeaseUntil" IS NULL AND "sendFence" IS NULL)
        OR ("sendAttemptId" IS NOT NULL AND "sendLeaseUntil" IS NOT NULL AND "sendFence" >= 1)),
    CHECK (("errorCode" IS NULL) = ("errorMessage" IS NULL)),
    CHECK (
        ("state" IN ('prepared', 'ready') AND "claimId" IS NULL AND "sendAttemptId" IS NULL AND "errorCode" IS NULL AND "attemptCount" = 0)
        OR ("state" = 'leased' AND "claimId" IS NOT NULL AND "sendAttemptId" IS NULL AND "errorCode" IS NULL AND "attemptCount" = 0)
        OR ("state" = 'retry_wait' AND "claimId" IS NULL AND "sendAttemptId" IS NOT NULL AND "errorCode" IS NOT NULL AND "attemptCount" >= 1)
        OR ("state" = 'retry_leased' AND "claimId" IS NOT NULL AND "sendAttemptId" IS NOT NULL AND "errorCode" IS NOT NULL AND "attemptCount" >= 1)
        OR ("state" = 'attempt_started' AND "claimId" IS NOT NULL AND "sendAttemptId" IS NOT NULL AND "errorCode" IS NULL AND "attemptCount" >= 1)
        OR ("state" = 'completed' AND "claimId" IS NULL AND "sendAttemptId" IS NOT NULL AND "errorCode" IS NULL AND "attemptCount" >= 1)
        OR ("state" IN ('failed', 'outcome_unknown') AND "claimId" IS NULL AND "sendAttemptId" IS NOT NULL AND "errorCode" IS NOT NULL AND "attemptCount" >= 1)
        OR ("state" = 'quarantined' AND "claimId" IS NULL AND "errorCode" IS NOT NULL
            AND (("sendAttemptId" IS NULL AND "attemptCount" = 0) OR ("sendAttemptId" IS NOT NULL AND "attemptCount" >= 1)))
    ),
    CONSTRAINT "TextToImageProviderLaneItem_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "TextToImageDispatchPreparation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TextToImageProviderLaneItem_projectId_jobId_key" ON "TextToImageProviderLaneItem"("projectId", "jobId");
CREATE INDEX "TextToImageProviderLaneItem_ownerUserId_providerId_state_createdAt_idx" ON "TextToImageProviderLaneItem"("ownerUserId", "providerId", "state", "createdAt");
CREATE INDEX "TextToImageProviderLaneItem_state_claimLeaseUntil_idx" ON "TextToImageProviderLaneItem"("state", "claimLeaseUntil");
CREATE INDEX "TextToImageProviderLaneItem_state_sendLeaseUntil_idx" ON "TextToImageProviderLaneItem"("state", "sendLeaseUntil");
CREATE INDEX "TextToImageProviderLaneItem_preparationId_prepareVersion_idx" ON "TextToImageProviderLaneItem"("preparationId", "prepareVersion");

CREATE TABLE "TextToImageProviderThrottle" (
    "ownerUserId" INTEGER NOT NULL,
    "providerId" INTEGER NOT NULL,
    "nextAllowedAt" DATETIME NOT NULL,
    "activeAttemptId" TEXT,
    "leaseUntil" DATETIME,
    "fencingVersion" INTEGER NOT NULL DEFAULT 0 CHECK ("fencingVersion" >= 0),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (("activeAttemptId" IS NULL) = ("leaseUntil" IS NULL)),
    CHECK ("activeAttemptId" IS NULL OR "fencingVersion" >= 1),
    PRIMARY KEY ("ownerUserId", "providerId")
);

CREATE TABLE "TextToImageProviderRevisionInvalidation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" INTEGER NOT NULL,
    "providerId" INTEGER NOT NULL,
    "oldRevision" INTEGER NOT NULL,
    "newRevision" INTEGER NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectPath" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending' CHECK ("state" IN ('pending', 'completed')),
    "attemptCount" INTEGER NOT NULL DEFAULT 0 CHECK ("attemptCount" >= 0),
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ("oldRevision" >= 1 AND "newRevision" > "oldRevision")
);
CREATE UNIQUE INDEX "TextToImageProviderRevisionInvalidation_target_key" ON "TextToImageProviderRevisionInvalidation"("ownerUserId", "providerId", "oldRevision", "newRevision", "projectId");
CREATE INDEX "TextToImageProviderRevisionInvalidation_state_createdAt_idx" ON "TextToImageProviderRevisionInvalidation"("state", "createdAt");
