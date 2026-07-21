-- Route B App-owned cross-Project dispatch preparation and persistent NovelAI lane.
CREATE TABLE `TextToImageDispatchPreparation` (
    `id` VARCHAR(200) NOT NULL,
    `manifestHash` VARCHAR(80) NOT NULL,
    `ownerUserId` INTEGER NOT NULL,
    `providerId` INTEGER NOT NULL,
    `providerCredentialRevision` INTEGER NOT NULL CHECK (`providerCredentialRevision` >= 1),
    `projectId` VARCHAR(200) NOT NULL,
    `projectPath` VARCHAR(1000) NOT NULL,
    `prepareAttemptId` VARCHAR(200) NOT NULL,
    `prepareLeaseUntil` DATETIME(3) NOT NULL,
    `prepareVersion` INTEGER NOT NULL DEFAULT 1 CHECK (`prepareVersion` >= 1),
    `stateVersion` INTEGER NOT NULL DEFAULT 1 CHECK (`stateVersion` >= 1),
    `state` VARCHAR(32) NOT NULL DEFAULT 'prepared' CHECK (`state` IN ('prepared', 'project_committed', 'ready', 'abandoned', 'quarantined')),
    `jobIdsJson` LONGTEXT NOT NULL,
    `dispatchKeysJson` LONGTEXT NOT NULL,
    `quarantineCode` VARCHAR(120),
    `quarantineMessage` VARCHAR(1000),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CHECK ((`state` = 'quarantined' AND `quarantineCode` IS NOT NULL AND `quarantineMessage` IS NOT NULL)
        OR (`state` <> 'quarantined' AND `quarantineCode` IS NULL AND `quarantineMessage` IS NULL)),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `TextToImageDispatchPreparation_manifestHash_key` (`manifestHash`),
    INDEX `TextToImageDispatchPreparation_state_prepareLeaseUntil_idx` (`state`, `prepareLeaseUntil`),
    INDEX `TextToImageDispatchPreparation_ownerUserId_providerId_state_idx` (`ownerUserId`, `providerId`, `state`),
    INDEX `TextToImageDispatchPreparation_projectId_state_idx` (`projectId`, `state`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TextToImageProviderLaneItem` (
    `dispatchKey` VARCHAR(80) NOT NULL,
    `preparationId` VARCHAR(200) NOT NULL,
    `jobId` VARCHAR(200) NOT NULL,
    `ownerUserId` INTEGER NOT NULL,
    `providerId` INTEGER NOT NULL,
    `providerCredentialRevision` INTEGER NOT NULL CHECK (`providerCredentialRevision` >= 1),
    `projectId` VARCHAR(200) NOT NULL,
    `projectPath` VARCHAR(1000) NOT NULL,
    `manifestHash` VARCHAR(80) NOT NULL,
    `prepareAttemptId` VARCHAR(200) NOT NULL,
    `prepareVersion` INTEGER NOT NULL CHECK (`prepareVersion` >= 1),
    `state` VARCHAR(32) NOT NULL DEFAULT 'prepared' CHECK (`state` IN ('prepared', 'ready', 'leased', 'retry_wait', 'retry_leased', 'attempt_started', 'completed', 'failed', 'outcome_unknown', 'quarantined')),
    `stateVersion` INTEGER NOT NULL DEFAULT 1 CHECK (`stateVersion` >= 1),
    `claimId` VARCHAR(200),
    `claimLeaseUntil` DATETIME(3),
    `sendAttemptId` VARCHAR(200),
    `sendLeaseUntil` DATETIME(3),
    `sendFence` INTEGER,
    `attemptCount` INTEGER NOT NULL DEFAULT 0 CHECK (`attemptCount` >= 0),
    `errorCode` VARCHAR(120),
    `errorMessage` VARCHAR(1000),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CHECK ((`claimId` IS NULL) = (`claimLeaseUntil` IS NULL)),
    CHECK ((`sendAttemptId` IS NULL AND `sendLeaseUntil` IS NULL AND `sendFence` IS NULL)
        OR (`sendAttemptId` IS NOT NULL AND `sendLeaseUntil` IS NOT NULL AND `sendFence` >= 1)),
    CHECK ((`errorCode` IS NULL) = (`errorMessage` IS NULL)),
    CHECK (
        (`state` IN ('prepared', 'ready') AND `claimId` IS NULL AND `sendAttemptId` IS NULL AND `errorCode` IS NULL AND `attemptCount` = 0)
        OR (`state` = 'leased' AND `claimId` IS NOT NULL AND `sendAttemptId` IS NULL AND `errorCode` IS NULL AND `attemptCount` = 0)
        OR (`state` = 'retry_wait' AND `claimId` IS NULL AND `sendAttemptId` IS NOT NULL AND `errorCode` IS NOT NULL AND `attemptCount` >= 1)
        OR (`state` = 'retry_leased' AND `claimId` IS NOT NULL AND `sendAttemptId` IS NOT NULL AND `errorCode` IS NOT NULL AND `attemptCount` >= 1)
        OR (`state` = 'attempt_started' AND `claimId` IS NOT NULL AND `sendAttemptId` IS NOT NULL AND `errorCode` IS NULL AND `attemptCount` >= 1)
        OR (`state` = 'completed' AND `claimId` IS NULL AND `sendAttemptId` IS NOT NULL AND `errorCode` IS NULL AND `attemptCount` >= 1)
        OR (`state` IN ('failed', 'outcome_unknown') AND `claimId` IS NULL AND `sendAttemptId` IS NOT NULL AND `errorCode` IS NOT NULL AND `attemptCount` >= 1)
        OR (`state` = 'quarantined' AND `claimId` IS NULL AND `errorCode` IS NOT NULL
            AND ((`sendAttemptId` IS NULL AND `attemptCount` = 0) OR (`sendAttemptId` IS NOT NULL AND `attemptCount` >= 1)))
    ),
    PRIMARY KEY (`dispatchKey`),
    UNIQUE INDEX `TextToImageProviderLaneItem_projectId_jobId_key` (`projectId`, `jobId`),
    INDEX `TextToImageProviderLaneItem_ownerUserId_providerId_state_createdAt_idx` (`ownerUserId`, `providerId`, `state`, `createdAt`),
    INDEX `TextToImageProviderLaneItem_state_claimLeaseUntil_idx` (`state`, `claimLeaseUntil`),
    INDEX `TextToImageProviderLaneItem_state_sendLeaseUntil_idx` (`state`, `sendLeaseUntil`),
    INDEX `TextToImageProviderLaneItem_preparationId_prepareVersion_idx` (`preparationId`, `prepareVersion`),
    CONSTRAINT `TextToImageProviderLaneItem_preparationId_fkey` FOREIGN KEY (`preparationId`) REFERENCES `TextToImageDispatchPreparation` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TextToImageProviderThrottle` (
    `ownerUserId` INTEGER NOT NULL,
    `providerId` INTEGER NOT NULL,
    `nextAllowedAt` DATETIME(3) NOT NULL,
    `activeAttemptId` VARCHAR(200),
    `leaseUntil` DATETIME(3),
    `fencingVersion` INTEGER NOT NULL DEFAULT 0 CHECK (`fencingVersion` >= 0),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CHECK ((`activeAttemptId` IS NULL) = (`leaseUntil` IS NULL)),
    CHECK (`activeAttemptId` IS NULL OR `fencingVersion` >= 1),
    PRIMARY KEY (`ownerUserId`, `providerId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TextToImageProviderRevisionInvalidation` (
    `id` VARCHAR(200) NOT NULL,
    `ownerUserId` INTEGER NOT NULL,
    `providerId` INTEGER NOT NULL,
    `oldRevision` INTEGER NOT NULL,
    `newRevision` INTEGER NOT NULL,
    `projectId` VARCHAR(200) NOT NULL,
    `projectPath` VARCHAR(1000) NOT NULL,
    `state` VARCHAR(32) NOT NULL DEFAULT 'pending',
    `attemptCount` INTEGER NOT NULL DEFAULT 0,
    `lastError` VARCHAR(1000),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    CHECK (`state` IN ('pending', 'completed')),
    CHECK (`attemptCount` >= 0),
    CHECK (`oldRevision` >= 1 AND `newRevision` > `oldRevision`),
    UNIQUE INDEX `TextToImageProviderRevisionInvalidation_target_key` (`ownerUserId`, `providerId`, `oldRevision`, `newRevision`, `projectId`),
    INDEX `TextToImageProviderRevisionInvalidation_state_createdAt_idx` (`state`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
