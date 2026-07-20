import type {AgentVisibleModelConfig, EffectiveConfig} from "nbook/server/config/types";

/** 归一化后的可见模型条目（modelKey 已验证可解析） */
export type AgentVisibleModel = {
    modelKey: string;
    note: string;
};

/** modelKey 是否指向配置中已启用的模型（"provider/model" 双段且 provider/model 均 enabled） */
function isResolvableModelKey(config: Pick<EffectiveConfig, "models">, modelKey: string): boolean {
    const [providerId, ...rest] = modelKey.split("/");
    const modelId = rest.join("/");
    if (!providerId || !modelId) return false;
    const provider = config.models.providers[providerId];
    const model = provider?.models[modelId];
    return Boolean(provider?.enabled && model?.enabled);
}

/**
 * agent 可见模型清单的唯一真相源（Task 111）。
 *
 * - 配置了 `agent.visibleModels`：过滤掉当前解析不了（provider/model 不存在或未启用）的条目；
 * - 未配置或全部失效：兜底为单条默认模型（models.defaultModelKey）；连默认都没有则返回空表。
 *
 * `run_workflow` 的 model 校验与 leader prompt 的清单渲染都必须消费这里，勿各自兜底。
 */
export function resolveAgentVisibleModels(config: Pick<EffectiveConfig, "agent" | "models">): AgentVisibleModel[] {
    const configured: AgentVisibleModelConfig[] = config.agent.visibleModels ?? [];
    const valid = configured.filter((entry) => isResolvableModelKey(config, entry.modelKey));
    if (valid.length > 0) return valid.map((entry) => ({modelKey: entry.modelKey, note: entry.note}));
    const fallback = config.models.defaultModelKey;
    if (fallback && isResolvableModelKey(config, fallback)) {
        return [{modelKey: fallback, note: "默认模型"}];
    }
    return [];
}

/** 校验 modelKey 在可见清单内；不在则抛错并列出可选项（工具面直接透出给 agent） */
export function assertVisibleModel(config: Pick<EffectiveConfig, "agent" | "models">, modelKey: string): void {
    const visible = resolveAgentVisibleModels(config);
    if (visible.some((entry) => entry.modelKey === modelKey)) return;
    const options = visible.map((entry) => entry.modelKey).join("、") || "（无可用模型）";
    throw new Error(`模型 ${modelKey} 不在 agent 可见模型清单内。可选：${options}`);
}
