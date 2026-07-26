import {Type, type Static} from "typebox";
import {Value} from "typebox/value";
import {z} from "zod";
import {
    ILLUSTRATION_DIRECTOR_CONVERTER_VERSION,
    ILLUSTRATION_DIRECTOR_OPERATION_POLICIES,
} from "nbook/shared/agent/illustration-director";
import {StoryboardConversionOutputSchema, type StoryboardConversionOutput} from "nbook/server/text-to-image/storyboard-candidate.service";
import {
    convertStoryboardImport,
    inspectStoryboardImport,
} from "nbook/server/text-to-image/storyboard-import.service";
import {defineAgentTool, type AgentToolDefinition, type NeuroAgentTool, type ToolExecutionContext} from "nbook/server/agent/tools/types";

export const StoryboardImportInspectToolSchema = Type.Object({
    sourceRelativePath: Type.String({
        pattern: "^upload/[^/\\\\]+\\.json$",
        description: "当前 Project upload/ 顶层的显式 JSON 路径。",
    }),
    chunkIndex: Type.Optional(Type.Integer({
        minimum: 0,
        maximum: 255,
        description: "省略时只返回 inspect 摘要；指定时返回该确定性脱敏 chunk。",
    })),
}, {additionalProperties: false});

const ConversionOutputToolSchema = Type.Unsafe<StoryboardConversionOutput>(
    z.toJSONSchema(StoryboardConversionOutputSchema, {reused: "inline"}),
);

export const StoryboardImportSubmitToolSchema = Type.Object({
    sourceRelativePath: Type.String({pattern: "^upload/[^/\\\\]+\\.json$"}),
    expectedImportId: Type.String({pattern: "^ttpi\\.[a-f0-9]{32}$"}),
    conversion: ConversionOutputToolSchema,
}, {additionalProperties: false});

type InspectToolInput = Static<typeof StoryboardImportInspectToolSchema>;
type SubmitToolInput = Static<typeof StoryboardImportSubmitToolSchema>;

const invocationBudgets = new Map<string, number>();

const inspectTool = defineAgentTool({
    key: "inspect_ttp_storyboard",
    name: "inspect_ttp_storyboard",
    label: "Inspect TTP Storyboard",
    description: "Strictly inspect one explicit upload/*.json. Without chunkIndex returns bounded metadata; with chunkIndex returns one sanitized deterministic conversion chunk.",
    parameters: StoryboardImportInspectToolSchema,
    validationSchema: StoryboardImportInspectToolSchema,
    mutatesWorkspace: true,
    executionMode: "sequential",
    async executeWithContext(context, _toolCallId, params: unknown) {
        consumeToolBudget(context);
        const input = Value.Parse(StoryboardImportInspectToolSchema, params) as InspectToolInput;
        const projectPath = requireProjectPath(context);
        const inspected = await inspectStoryboardImport({
            projectPath,
            sourceRelativePath: input.sourceRelativePath,
            workspaceRoot: context.workspaceFsRoot,
            converterVersion: ILLUSTRATION_DIRECTOR_CONVERTER_VERSION,
        });
        if (input.chunkIndex === undefined) {
            const summary = {
                importId: inspected.importId,
                presetId: inspected.presetId,
                state: "inspected",
                sourceShape: inspected.inspection.sourceShape,
                sourcePresetKey: inspected.inspection.sourcePresetKey,
                entryCount: inspected.inspection.entries.length,
                chunkCount: inspected.inspection.chunks.length,
                chunks: inspected.inspection.chunks.map((chunk) => ({
                    chunkIndex: chunk.chunkIndex,
                    entryCount: chunk.entryCount,
                    characterCount: chunk.characterCount,
                    chunkHash: chunk.chunkHash,
                })),
                macroTokens: inspected.inspection.macroTokens,
            };
            return toolJson(summary, {
                importId: inspected.importId,
                presetId: inspected.presetId,
                chunkCount: inspected.inspection.chunks.length,
            });
        }
        const chunk = inspected.inspection.chunks[input.chunkIndex];
        if (!chunk) throw new Error(`STORYBOARD_IMPORT_CHUNK_NOT_FOUND: ${String(input.chunkIndex)}`);
        const entriesById = new Map(inspected.inspection.entries.map((entry) => [entry.sourceIdentity.sourceEntryId, entry]));
        const payload = {
            importId: inspected.importId,
            presetId: inspected.presetId,
            chunkIndex: chunk.chunkIndex,
            chunkHash: chunk.chunkHash,
            segments: chunk.segments.map((segment) => {
                const entry = entriesById.get(segment.sourceEntryId);
                if (!entry) throw new Error(`STORYBOARD_IMPORT_CHUNK_ENTRY_MISSING: ${segment.sourceEntryId}`);
                return {
                    sourceIdentity: entry.sourceIdentity,
                    enabled: entry.enabled,
                    role: entry.role,
                    triggerMode: entry.triggerMode,
                    triggerWords: entry.triggerWords,
                    andTriggerWords: entry.andTriggerWords,
                    classifications: entry.classifications,
                    flags: entry.flags,
                    startOffset: segment.startOffset,
                    endOffset: segment.endOffset,
                    contentHash: segment.contentHash,
                    content: entry.content.slice(segment.startOffset, segment.endOffset),
                };
            }),
        };
        return toolJson(payload, {
            importId: inspected.importId,
            chunkIndex: chunk.chunkIndex,
            chunkHash: chunk.chunkHash,
        });
    },
    async execute() {
        throw new Error("inspect_ttp_storyboard 必须在 illustration.director session 内执行");
    },
});

const submitTool = defineAgentTool({
    key: "submit_ttp_storyboard_conversion",
    name: "submit_ttp_storyboard_conversion",
    label: "Submit TTP Storyboard Conversion",
    description: "Submit one strict convert-preset DTO. The server assigns final IDs, revalidates source bytes and writes only a pending_unresolved companion package.",
    parameters: StoryboardImportSubmitToolSchema,
    validationSchema: StoryboardImportSubmitToolSchema,
    mutatesWorkspace: true,
    executionMode: "sequential",
    async executeWithContext(context, _toolCallId, params: unknown) {
        consumeToolBudget(context);
        const input = Value.Parse(StoryboardImportSubmitToolSchema, params) as SubmitToolInput;
        const projectPath = requireProjectPath(context);
        const result = await convertStoryboardImport({
            projectPath,
            sourceRelativePath: input.sourceRelativePath,
            workspaceRoot: context.workspaceFsRoot,
            converterVersion: ILLUSTRATION_DIRECTOR_CONVERTER_VERSION,
            expectedImportId: input.expectedImportId,
            conversion: StoryboardConversionOutputSchema.parse(input.conversion),
        });
        releaseToolBudget(context);
        return toolJson({
            importId: result.package.importId,
            state: result.package.state,
            candidatePackageHash: result.package.candidatePackageHash,
            diagnosticHash: result.package.diagnosticHash,
            storyboard: result.package.storyboard,
            patterns: {
                candidatePath: result.package.patterns.candidatePath,
                planningHash: result.package.patterns.planningHash,
                renderHash: result.package.patterns.renderHash,
                patternCount: result.package.patterns.patternCount,
                unresolvedAtomCount: result.package.patterns.unresolvedAtoms.length,
            },
            recipeProposalCount: result.package.recipeProposals.length,
            diagnostics: result.package.report.diagnostics,
        }, {
            importId: result.package.importId,
            state: result.package.state,
            candidatePackageHash: result.package.candidatePackageHash,
        });
    },
    async execute() {
        throw new Error("submit_ttp_storyboard_conversion 必须在 illustration.director session 内执行");
    },
});

/** 全局 registry definitions；只有显式 pluginTool 绑定的 Profile 才会获得这些工具。 */
export const storyboardImportAgentTools = {
    inspect: inspectTool,
    submit: submitTool,
} as const satisfies {
    inspect: AgentToolDefinition<"inspect_ttp_storyboard">;
    submit: AgentToolDefinition<"submit_ttp_storyboard_conversion">;
};

/** 测试/诊断用 runtime 构造入口。 */
export function createStoryboardImportAgentTools(): NeuroAgentTool[] {
    return [inspectTool.runtime(), submitTool.runtime()];
}

function requireProjectPath(context: ToolExecutionContext): string {
    if (!context.projectPath) throw new Error("STORYBOARD_IMPORT_PROJECT_REQUIRED");
    return context.projectPath;
}

/** 同一 invocation 的 convert-preset 工具调用总数受 operation policy 硬限制。 */
function consumeToolBudget(context: ToolExecutionContext): void {
    const key = context.invocationId ?? `session:${String(context.sessionId)}`;
    const count = (invocationBudgets.get(key) ?? 0) + 1;
    if (count > ILLUSTRATION_DIRECTOR_OPERATION_POLICIES["convert-preset"].maxToolCalls) {
        invocationBudgets.delete(key);
        throw new Error("STORYBOARD_IMPORT_TOOL_BUDGET_EXCEEDED");
    }
    invocationBudgets.set(key, count);
    if (invocationBudgets.size > 1024) {
        const oldest = invocationBudgets.keys().next().value;
        if (oldest) invocationBudgets.delete(oldest);
    }
}

function releaseToolBudget(context: ToolExecutionContext): void {
    invocationBudgets.delete(context.invocationId ?? `session:${String(context.sessionId)}`);
}

function toolJson(value: Record<string, unknown>, details: Record<string, unknown>) {
    return {
        content: [{type: "text" as const, text: JSON.stringify(value, null, 2)}],
        details: details as never,
    };
}
