import type {AgentToolSettingsDto} from "nbook/shared/dto/app-settings.dto";
import {useAgentSystem} from "nbook/server/agent/http";
import {loadAppConfig} from "nbook/server/utils/app-config";

/**
 * 读取 Agent tools 设定。
 */
export default defineEventHandler(async (): Promise<AgentToolSettingsDto> => {
    const agentSystem = useAgentSystem();
    const appConfig = await loadAppConfig();

    return {
        allow: appConfig.agent.tools.allow,
        deny: appConfig.agent.tools.deny,
        allTools: agentSystem.toolRegistry.listToolKeys().sort((left, right) => left.localeCompare(right)),
    };
});
