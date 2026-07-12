export type TextToImageProviderKind = "novelai" | "openai_compatible";

export type TextToImageProviderDto = {
    id: number;
    kind: TextToImageProviderKind;
    name: string;
    baseUrl: string;
    model: string;
    settings: {
        allowPrivateNetwork: boolean;
        requestIntervalMs: number;
    };
    hasCredential: boolean;
    createdAt: string;
    updatedAt: string;
};

export type TextToImageJobKind = "manual" | "body" | "character" | "reroll";

export type TextToImageJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";

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
