import { defineAsyncComponent, markRaw, type Component } from "vue";
import type {AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import AgentEditFileBubble from "nbook/app/components/novel-ide/agent/AgentEditFileBubble.vue";
import AgentRequestUserInputBubble from "nbook/app/components/novel-ide/agent/AgentRequestUserInputBubble.vue";
import AgentExitPlanModeBubble from "nbook/app/components/novel-ide/agent/AgentExitPlanModeBubble.vue";
import AgentWriteFileBubble from "nbook/app/components/novel-ide/agent/AgentWriteFileBubble.vue";
import AgentApplyPatchBubble from "nbook/app/components/novel-ide/agent/AgentApplyPatchBubble.vue";
import AgentTaskBubble from "nbook/app/components/novel-ide/agent/AgentTaskBubble.vue";

/** Tool 节点渲染模式。 */
export type AgentToolRenderMode = "inline" | "block" | "message" | "hidden";

/** 单个 tool 的渲染配置。 */
export type AgentToolRenderConfig = {
    mode: AgentToolRenderMode;
    typeLabel: string;
    collapsedPreview?: string;
    collapsedPreviewKey?: string;
    component?: Component;
};

const DEFAULT_TOOL_RENDER_CONFIG: AgentToolRenderConfig = {
    mode: "inline",
    typeLabel: "Tool Call",
};

const TOOL_RENDER_REGISTRY: Record<string, AgentToolRenderConfig> = {
    request_user_input: {
        mode: "block",
        typeLabel: "Question",
        collapsedPreviewKey: "agent.tool.waitingUserAnswer",
        component: markRaw(AgentRequestUserInputBubble),
    },
    enter_plan_mode: {
        mode: "block",
        typeLabel: "Plan Mode",
        collapsedPreviewKey: "agent.tool.waitingApproval",
        component: markRaw(AgentRequestUserInputBubble),
    },
    exit_plan_mode: {
        mode: "message",
        typeLabel: "Plan Mode",
        collapsedPreviewKey: "agent.tool.planApproval",
        component: markRaw(AgentExitPlanModeBubble),
    },
    write: {
        mode: "block",
        typeLabel: "Write",
        collapsedPreviewKey: "agent.tool.writeFile",
        component: markRaw(AgentWriteFileBubble),
    },
    edit: {
        mode: "block",
        typeLabel: "Edit",
        collapsedPreviewKey: "agent.tool.editFile",
        component: markRaw(AgentEditFileBubble),
    },
    apply_patch: {
        mode: "block",
        typeLabel: "Patch",
        collapsedPreviewKey: "agent.tool.applyPatch",
        component: markRaw(AgentApplyPatchBubble),
    },
    task_create: {
        mode: "message",
        typeLabel: "Checklist",
        collapsedPreviewKey: "agent.tool.taskList",
        component: markRaw(AgentTaskBubble),
    },
    task_set_status: {
        mode: "message",
        typeLabel: "Checklist",
        collapsedPreviewKey: "agent.tool.taskStatusUpdate",
        component: markRaw(AgentTaskBubble),
    },
};

/**
 * 根据 tool 名字返回前端渲染配置。
 */
export const resolveToolRenderConfig = (toolCall: AgentToolCall): AgentToolRenderConfig => {
    return TOOL_RENDER_REGISTRY[toolCall.name] ?? DEFAULT_TOOL_RENDER_CONFIG;
};
