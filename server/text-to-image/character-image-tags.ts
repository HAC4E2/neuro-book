import {z} from "zod";
import {
    ILLUSTRATION_DIRECTOR_MODEL_NOT_CONFIGURED,
    ILLUSTRATION_DIRECTOR_PROFILE_KEY,
} from "nbook/shared/agent/illustration-director";
import {
    CharacterVisualDirectorGenerateRequestSchema,
    CharacterVisualDirectorGenerateResultSchema,
    CharacterVisualDirectorProposalSchema,
    type CharacterVisualDirectorGenerateResult,
    type CharacterVisualDirectorPreview,
    type CharacterVisualDirectorProposal,
} from "nbook/shared/text-to-image-character-source";
import {createTextToImageMarkdownFileHash} from "nbook/server/text-to-image/strict-frontmatter";
import {loadEffectiveConfigForAgentRuntime} from "nbook/server/config/config-service";
import {useAgentHarness} from "nbook/server/agent/http";
import {createCharacterVisualMigrationService} from "nbook/server/text-to-image/character-visual-migration.runtime";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";
import {readWorkspaceTextFile} from "nbook/server/workspace-files/workspace-files";

export {CharacterVisualDirectorGenerateRequestSchema};

export type CharacterVisualProposalErrorCode =
    | typeof ILLUSTRATION_DIRECTOR_MODEL_NOT_CONFIGURED
    | "CHARACTER_VISUAL_DIRECTOR_FAILED"
    | "CHARACTER_VISUAL_DIRECTOR_OUTPUT_INVALID";

/** 角色视觉 Director proposal 的稳定错误出口。 */
export class CharacterVisualProposalError extends Error {
    readonly code: CharacterVisualProposalErrorCode;

    constructor(code: CharacterVisualProposalErrorCode, message: string) {
        super(message);
        this.name = "CharacterVisualProposalError";
        this.code = code;
    }
}

type DirectorInvocationResult = {
    sessionId: number;
    invocationId: string;
    status: string;
    error?: string;
    /** Agent report_result 是外部运行时边界，必须立即交给 strict schema。 */
    data?: unknown;
};

export type CharacterVisualProposalRuntime = {
    readCharacter(input: {projectPath: string; characterPath: string}): Promise<string>;
    isDirectorConfigured(projectPath: string): Promise<boolean>;
    invoke(input: {
        projectPath: string;
        characterPath: string;
        characterMarkdown: string;
        sourceCharacterFileHash: string;
    }): Promise<DirectorInvocationResult>;
    save(input: {
        projectPath: string;
        sourceCharacterPath: string;
        sourceCharacterFileHash: string;
        sessionId: number;
        invocationId: string;
        proposal: CharacterVisualDirectorProposal;
    }): Promise<CharacterVisualDirectorPreview>;
};

/**
 * 角色详情生成只调用全局 illustration.director，并只返回/持久化不可执行 proposal。
 *
 * 该函数不接收 provider/model/Recipe/NovelAI 参数，也不直接写 image-tags 或 outfit。
 */
export async function generateCharacterVisualProposal(
    inputValue: z.input<typeof CharacterVisualDirectorGenerateRequestSchema>,
    runtime: CharacterVisualProposalRuntime = createRuntime(),
): Promise<CharacterVisualDirectorGenerateResult> {
    const input = CharacterVisualDirectorGenerateRequestSchema.parse(inputValue);
    if (!await runtime.isDirectorConfigured(input.projectPath)) {
        throw new CharacterVisualProposalError(
            ILLUSTRATION_DIRECTOR_MODEL_NOT_CONFIGURED,
            "请先在设置 → 模型配置中配置 illustration.director",
        );
    }
    const characterMarkdown = await runtime.readCharacter(input);
    const sourceCharacterFileHash = createTextToImageMarkdownFileHash(characterMarkdown);
    const invoked = await runtime.invoke({...input, characterMarkdown, sourceCharacterFileHash});
    if (invoked.status !== "completed") {
        throw new CharacterVisualProposalError(
            "CHARACTER_VISUAL_DIRECTOR_FAILED",
            invoked.error ?? `illustration.director 未完成：${invoked.status}`,
        );
    }
    const parsed = CharacterVisualDirectorProposalSchema.safeParse(invoked.data);
    if (!parsed.success) {
        throw new CharacterVisualProposalError(
            "CHARACTER_VISUAL_DIRECTOR_OUTPUT_INVALID",
            `illustration.director 输出不符合 proposal schema：${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
        );
    }
    if (parsed.data.sourceCharacterFileHash !== sourceCharacterFileHash) {
        throw new CharacterVisualProposalError(
            "CHARACTER_VISUAL_DIRECTOR_OUTPUT_INVALID",
            "illustration.director 输出未绑定当前角色详情 hash",
        );
    }
    if (parsed.data.state === "blocked") {
        return CharacterVisualDirectorGenerateResultSchema.parse({
            state: "blocked",
            sessionId: invoked.sessionId,
            invocationId: invoked.invocationId,
            summary: parsed.data.summary,
            diagnostics: parsed.data.diagnostics,
        });
    }
    const preview = await runtime.save({
        projectPath: input.projectPath,
        sourceCharacterPath: input.characterPath,
        sourceCharacterFileHash,
        sessionId: invoked.sessionId,
        invocationId: invoked.invocationId,
        proposal: parsed.data,
    });
    return CharacterVisualDirectorGenerateResultSchema.parse({
        state: "proposal_ready",
        sessionId: invoked.sessionId,
        invocationId: invoked.invocationId,
        preview,
    });
}

/** 生产运行时：唯一模型 binding 由 Agent Runtime 加载，proposal 写入统一 migration service。 */
function createRuntime(): CharacterVisualProposalRuntime {
    return {
        async readCharacter(input) {
            const root = await resolveWorkspaceRootInput({projectPath: input.projectPath});
            return readWorkspaceTextFile(root, input.characterPath);
        },
        async isDirectorConfigured(projectPath) {
            const effective = await loadEffectiveConfigForAgentRuntime({projectPath});
            return Boolean(effective.agent.profiles[ILLUSTRATION_DIRECTOR_PROFILE_KEY]?.model.modelKey);
        },
        async invoke(input) {
            const harness = useAgentHarness();
            const created = await harness.createAgent({
                profileKey: ILLUSTRATION_DIRECTOR_PROFILE_KEY,
                initial: {
                    operation: "propose-character-visual",
                    characterPath: input.characterPath,
                    characterMarkdown: input.characterMarkdown,
                    sourceCharacterFileHash: input.sourceCharacterFileHash,
                },
                workspaceRoot: "workspace",
                workspaceKey: input.projectPath,
                projectPath: input.projectPath,
                title: `角色视觉 proposal · ${input.characterPath}`,
            });
            const result = await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "为当前角色事实生成严格角色视觉 proposal；只提交 report_result，不写 Project 文件。"},
                title: `生成角色视觉 proposal · ${input.characterPath}`,
                caller: {kind: "system", profileKey: ILLUSTRATION_DIRECTOR_PROFILE_KEY},
            });
            return {
                sessionId: result.sessionId,
                invocationId: result.invocationId,
                status: result.status,
                error: result.error,
                data: result.reportResult?.data,
            };
        },
        async save(input) {
            return (await createCharacterVisualMigrationService(input.projectPath)).saveDirectorProposal(input);
        },
    };
}
