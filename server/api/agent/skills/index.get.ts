import {useAgentSystem} from "nbook/server/agent/http";
import type {AgentSkillCatalogItemDto} from "nbook/shared/dto/agent-chat.dto";

/**
 * 返回当前仓库可见的 skills catalog。
 */
export default defineEventHandler(async (): Promise<AgentSkillCatalogItemDto[]> => {
    const catalog = await useAgentSystem().skillCatalog.list();
    return catalog.map((skill) => ({
        name: skill.name,
        description: skill.description,
    }));
});
