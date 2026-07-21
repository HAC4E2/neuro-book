export type TextToImageProviderKind = "novelai";

type TextToImageProviderBaseDto = {
    id: number;
    name: string;
    baseUrl: string;
    settings: {
        allowPrivateNetwork: boolean;
        requestIntervalMs: number;
    };
    hasCredential: boolean;
    createdAt: string;
    updatedAt: string;
};

export type TextToImageProviderDto = TextToImageProviderBaseDto & {
    kind: "novelai";
};

export type TextToImageNovelAiInspectionDto = {
    state: "unconfigured" | "configured" | "selection_required";
    /** 仅当 state=configured 时为唯一 Provider。 */
    provider: Extract<TextToImageProviderDto, {kind: "novelai"}> | null;
    /** 供重复旧数据显式选择；所有项均不含 credential。 */
    candidates: Array<Extract<TextToImageProviderDto, {kind: "novelai"}>>;
    /** 迁移前旧 Provider 实际覆盖过的模型，仅用于生成 Project Recipe proposal，不参与运行时请求。 */
    recipeMigrationModels: Array<{
        providerId: number;
        model: string;
    }>;
    /** 仅在 state=selection_required 时存在；绑定当前 owner 的完整候选快照，防止陈旧选择覆盖新配置。 */
    selectionToken: string | null;
    /** 跨 Project 处理曾部分失败时非空；恢复流程只能继续保留这条 Provider。 */
    reconciliationKeepProviderId: number | null;
};

/** Job 创建时冻结的脱敏 Provider 证据；永不包含 API credential。 */
export type TextToImageProviderSnapshotDto = {
    ownerUserId: number;
    providerId: number;
    credentialRevision: number;
    kind: "novelai";
    name: string;
    baseUrl: string;
    settings: {
        allowPrivateNetwork: false;
        requestIntervalMs: number;
    };
    updatedAt: string;
};

export type TextToImageNovelAiReconciliationImpactDto = {
    projectPath: string;
    configurationStale: number;
    outcomeUnknown: number;
};

export type TextToImageNovelAiReconciliationRequestDto = {
    keepProviderId: number;
    selectionToken: string;
};

export type TextToImageNovelAiReconciliationDto = {
    inspection: TextToImageNovelAiInspectionDto;
    impacts: TextToImageNovelAiReconciliationImpactDto[];
    /** enforced 表示目标 partial unique 已安装；pending_other_owners 表示仍有其他 owner 待显式收敛。 */
    constraintState: "enforced" | "pending_other_owners";
};

export type TextToImageJobKind = "manual" | "body" | "character" | "reroll" | "illustration";

export type TextToImageJobStatus = "queued" | "running" | "completing" | "succeeded" | "failed" | "canceled" | "interrupted" | "configuration_stale" | "outcome_unknown";

export type TextToImageSourceInsertStatus = "not_applicable" | "pending" | "inserted" | "missing";

export type TextToImageAssetDto = {
    id: string;
    jobId: string;
    relativePath: string;
    fileName: string;
    mimeType: string;
    byteLength: number;
    width: number;
    height: number;
    model: string;
    seed: number;
    prompt: string;
    negativePrompt: string;
    sourceKind: string;
    sourcePath: string | null;
    sourceAnchorId: string | null;
    createdAt: string;
};

export type TextToImageAssetListItemDto = TextToImageAssetDto & {
    jobStatus: TextToImageJobStatus;
    sourceInsertStatus: TextToImageSourceInsertStatus;
};

export type TextToImageAssetPageDto = {
    items: TextToImageAssetListItemDto[];
    page: number;
    pageSize: number;
    hasMore: boolean;
};

export type TextToImageJobDto = {
    id: string;
    providerId: number;
    kind: TextToImageJobKind;
    status: TextToImageJobStatus;
    sourcePath: string | null;
    sourceAnchorId: string | null;
    sourceInsertStatus: TextToImageSourceInsertStatus;
    resultAssetIds: string[];
    errorMessage: string | null;
    attemptCount: number;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
};

export type TextToImageJobPageDto = {
    items: TextToImageJobDto[];
    page: number;
    pageSize: number;
    hasMore: boolean;
};
