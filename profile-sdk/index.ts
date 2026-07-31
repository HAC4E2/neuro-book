/**
 * Profile authoring 的稳定入口。
 *
 * Profile 源码只依赖这个 Module；`server/**` 下的实现路径可以在不改 Profile 的
 * 前提下继续演进。Product Authoring Kit 也只需要投影这一入口及其编译所需实现。
 */
export {Type} from "typebox";
export type {Static, TSchema} from "typebox";
export {
    DirectorInitialSchema,
    DirectorOutputSchema,
    InlineEditorInitialSchema,
    InlineEditorOutputSchema,
    InlineEditorPayloadSchema,
    LeaderDefaultInitialSchema,
    LeaderDefaultOutputSchema,
    MemoryCuratorInitialSchema,
    MemoryCuratorOutputSchema,
    ResearcherInitialSchema,
    RetrievalInitialSchema,
    RetrievalOutputSchema,
    RpLeaderInitialSchema,
    RpLeaderOutputSchema,
    RpWriterInitialSchema,
    RpWriterOutputSchema,
    SessionSummarizerInitialSchema,
    SessionSummarizerOutputSchema,
    SimulatorLeaderInitialSchema,
    SimulatorLeaderOutputSchema,
    SubjectSimulatorInitialSchema,
    SubjectSimulatorOutputSchema,
    WriterInitialSchema,
    WriterOutputSchema,
    WriterPayloadSchema,
} from "nbook/server/agent/profiles/builtin-contracts";
export {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
export {
    agentRuntimeBuiltins,
    defineAgentRuntime,
} from "nbook/server/agent/profiles/define-agent-runtime";
export type {
    AgentRuntimeBuiltin,
    AgentRuntimeDefinition,
    AgentRuntimeHook,
    AgentRuntimeHookContext,
    AgentRuntimeHookResult,
    AgentRuntimeHookStage,
    AgentRuntimeItem,
    NormalizedAgentRuntimeDefinition,
    RuntimeAgentDialogueContentInput,
    RuntimeSessionFacade,
    RuntimeSessionReadResult,
} from "nbook/server/agent/profiles/define-agent-runtime";
export {
    ActivatedSkills,
    AgentCatalog,
    AIMessage,
    AppendingSet,
    FileChangeNotice,
    Fragment,
    HistorySet,
    If,
    Import,
    LinkedAgentsReminder,
    LinkedAgentsSummary,
    MentionedSkillsReminder,
    Message,
    ModeAvailabilityReminder,
    ModeReminder,
    ModeSlot,
    ModelContext,
    ProfilePrompt,
    Reminder,
    SkillCatalog,
    SqlSchemaSummary,
    System,
    SystemReminder,
    TaskReminder,
    ToolCall,
    ToolResult,
    Watch,
    WorkflowCatalog,
    WorkspaceFocusReminder,
} from "nbook/server/agent/profiles/profile-dsl";
export type {
    ModeSlotKind,
    ProfileDslChild,
    ProfileDslNode,
    ProfileFileChangeNoticeNode,
    ProfileFragmentNode,
    ProfileIfNode,
    ProfileImportAs,
    ProfileImportProps,
    ProfileMessageNode,
    ProfileModeSlotNode,
    ProfilePromptNode,
    ProfileReminderNode,
    ProfileRuntimeState,
    ProfileSetNode,
    ProfileStringFragmentNode,
    ProfileToolCallNode,
    ProfileWatchNode,
    ReminderChange,
    ReminderState,
    WatchChange,
    WatchState,
} from "nbook/server/agent/profiles/profile-dsl";
export {defineProfileHome} from "nbook/server/agent/profiles/profile-home";
export type {
    ProfileHomeContext,
    ProfileHomeDefinition,
    ProfileHomeFacade,
    ProfileHomeListItem,
    ProfileHomeScope,
    ProfileHomeWriteMode,
    ProfileHomeWriteResult,
} from "nbook/server/agent/profiles/profile-home";
export {profileText} from "nbook/server/agent/profiles/profile-text";
export {
    builtin,
    defineProfileTool,
    plotReadBindings,
    plotWriteBindings,
    pluginTool,
    toolset,
} from "nbook/server/agent/profiles/profile-tools";
export type {
    AgentToolDefinition,
    ProfileTools,
    ReportResultToolBinding,
    ToolBinding,
} from "nbook/server/agent/profiles/profile-tools";
export type {
    AgentCatalogItem,
    AgentCatalogSnapshot,
    AgentProfile,
    AgentProfileCreationMode,
    AgentProfileDefinition,
    AgentProfileIssue,
    AgentProfileIssueCode,
    AgentProfileLoadStatus,
    AgentProfileManifest,
    AgentProfileRuntimeDefaults,
    AgentProfileSourceKind,
    ProfilePrepareContext,
    ProfileTurnPlan,
} from "nbook/server/agent/profiles/types";
export {defineSessionVariable} from "nbook/server/agent/variables/registry";
export {
    buildWritingReference,
    DEFAULT_WRITING_REFERENCE_PRESET,
    homeReferenceKeyToLegacyKey,
    legacyReferenceKeyToHomeKey,
    loadWritingReferencePresets,
    normalizeReferenceHomeKey,
} from "nbook/server/agent/profiles/writer-writing-reference";
export type {
    WritingReferenceDefinition,
    WritingReferencePreset,
} from "nbook/server/agent/profiles/writer-writing-reference";
export {
    buildWritingStyle,
    DEFAULT_WRITING_STYLE_PRESET,
    homeStyleKeyToLegacyKey,
    legacyStyleKeyToHomeKey,
    loadWritingStylePresets,
    normalizeStyleHomeKey,
} from "nbook/server/agent/profiles/writer-writing-style";
export type {
    WritingStyleDefinition,
    WritingStylePreset,
} from "nbook/server/agent/profiles/writer-writing-style";
export {
    defineLowCodeForm,
    defineResourcePreset,
    profileHomeResource,
} from "nbook/server/low-code-form";
export type {
    LowCodeFieldDefinition,
    LowCodeFieldOptionsProvider,
    LowCodeFormDefinition,
    LowCodeFormResolveContext,
} from "nbook/server/low-code-form";
export type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
