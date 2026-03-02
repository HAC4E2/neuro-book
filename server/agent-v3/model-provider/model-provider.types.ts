/**
 * 模型 usage 摘要。
 */
export type AgentModelUsage = {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
};

/**
 * 真实模型连通性测试结果。
 */
export type ModelProviderSmokeResult = {
    text: string;
    thinkingText: string;
    usage: AgentModelUsage;
};
