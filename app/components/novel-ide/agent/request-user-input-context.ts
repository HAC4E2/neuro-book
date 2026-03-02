import type {InjectionKey, Ref} from "vue";
import type {AgentPendingUserInputSessionDto} from "nbook/shared/dto/agent-chat.dto";

export type AgentUserInputAnswerDraft = {
    selectedAnswers: Ref<Record<string, number[]>>;
    notes: Ref<Record<string, string>>;
};

export type AgentRequestUserInputContext = {
    pendingSession: Ref<AgentPendingUserInputSessionDto | null>;
    submitting: Ref<boolean>;
    draft: AgentUserInputAnswerDraft;
    submitAnswers: () => void;
};

export const AGENT_REQUEST_USER_INPUT_CONTEXT_KEY: InjectionKey<AgentRequestUserInputContext> = Symbol("agent-request-user-input-context");
