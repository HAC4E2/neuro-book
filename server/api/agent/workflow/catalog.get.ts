import {useAgentHarness} from "nbook/server/agent/http";
import {loadEffectiveConfigForAgentRuntime} from "nbook/server/config/config-service";
import {resolveAgentVisibleModels} from "nbook/server/agent/harness/agent-visible-models";

/** 正式 workflow 面：catalog 列表 + agent 可见模型清单（前端触发表单用） */
export default defineEventHandler(async () => {
    const items = await useAgentHarness().workflows.list();
    const config = await loadEffectiveConfigForAgentRuntime({});
    return {
        workflows: items.map((item) => ({
            key: item.key,
            title: item.title,
            description: item.description,
            whenToUse: item.whenToUse ?? null,
            argsHint: item.argsHint,
            source: item.source,
        })),
        models: resolveAgentVisibleModels(config),
    };
});
