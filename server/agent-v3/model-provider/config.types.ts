/**
 * config.yaml 中 v3 当前需要的原始模型配置。
 */
export type RawAgentConfig = {
    models?: {
        default?: string | null;
        providers?: Record<string, {
            name?: string;
            adapter?: string;
            options?: {
                apiKey?: string | null;
                baseURL?: string | null;
                proxy?: string | null;
            };
            models?: Record<string, {
                name?: string;
                id?: string;
                group?: string | null;
                enabled?: boolean;
                contextWindowTokens?: number | null;
            }>;
        }>;
    };
};

/**
 * DeepSeek Flash 运行时配置。
 */
export type DeepSeekFlashConfig = {
    providerId: string;
    providerName: string;
    modelKey: string;
    modelId: string;
    apiKey: string;
    baseURL: string;
    proxy: string;
};
