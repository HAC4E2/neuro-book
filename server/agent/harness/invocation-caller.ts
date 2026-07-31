/** Agent invocation 的调用方类别。 */
export type AgentInvokeCallerKind = "user" | "agent" | "system";

/**
 * Agent invocation 的稳定调用方身份。
 *
 * 该合同被 Profile authoring 直接消费，因此保持为不依赖 Harness、HTTP DTO
 * 或运行时实现的纯类型 Module。
 */
export type AgentInvokeCaller = {
    kind: AgentInvokeCallerKind;
    sessionId?: number;
    profileKey?: string;
    toolCallId?: string;
};
