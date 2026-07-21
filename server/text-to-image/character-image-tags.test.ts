import {describe, expect, it, vi} from "vitest";
import {ILLUSTRATION_DIRECTOR_MODEL_NOT_CONFIGURED} from "nbook/shared/agent/illustration-director";
import {CHARACTER_IMAGE_TAG_FIELDS} from "nbook/shared/text-to-image-character-visual";
import {createTextToImageMarkdownFileHash} from "nbook/server/text-to-image/strict-frontmatter";
import {
    CharacterVisualProposalError,
    generateCharacterVisualProposal,
    type CharacterVisualProposalRuntime,
} from "nbook/server/text-to-image/character-image-tags";

const characterMarkdown = "---\ntitle: 艾丽丝\naliases: [Alice]\n---\n\n外貌：金发碧眼。\n";
const sourceHash = createTextToImageMarkdownFileHash(characterMarkdown);

function completedProposal() {
    return {
        schemaVersion: "nbook.character-visual-director-proposal/v1" as const,
        operation: "propose-character-visual" as const,
        state: "completed" as const,
        summary: "已从角色事实生成视觉 proposal。",
        sourceCharacterFileHash: sourceHash,
        character: {
            names: {cn: "艾丽丝", en: "Alice"},
            fields: {
                profileTraits: "young woman",
                facialAppearance: "blonde hair, blue eyes",
                facialBack: "long blonde hair",
                upperSfw: "slender",
                upperBackSfw: "",
                lowerSfw: "",
                lowerBackSfw: "",
                upperNsfw: "",
                upperBackNsfw: "",
                lowerNsfw: "",
                lowerBackNsfw: "",
                negativePrompt: "",
            },
        },
        outfits: [],
        diagnostics: [],
    };
}

function runtime(patch: Partial<CharacterVisualProposalRuntime> = {}): CharacterVisualProposalRuntime {
    return {
        readCharacter: vi.fn(async () => characterMarkdown),
        isDirectorConfigured: vi.fn(async () => true),
        invoke: vi.fn(async () => ({
            sessionId: 12,
            invocationId: "invocation-12",
            status: "completed",
            data: completedProposal(),
        })),
        save: vi.fn(async (input) => ({
            schemaVersion: "nbook.character-visual-director-preview/v1",
            proposalId: "character-proposal-1234567890abcdef12345678",
            proposalFileHash: sourceHash,
            sourceCharacterPath: input.sourceCharacterPath,
            sourceCharacterFileHash: input.sourceCharacterFileHash,
            characterPath: "lorebook/character/alice/image-tags.md",
            targetStatus: "missing_visual",
            targetBaseSetHash: sourceHash,
            targetNames: {cn: "艾丽丝", aliasesCn: ["Alice"], en: "Alice"},
            rows: CHARACTER_IMAGE_TAG_FIELDS.map((field) => ({
                field,
                existingText: "",
                proposalText: input.proposal.character?.fields[field] ?? "",
                state: input.proposal.character?.fields[field] ? "proposal_only" as const : "empty" as const,
                decisionRequired: false,
            })),
            outfits: [],
            diagnostics: [],
            previewHash: sourceHash,
        })),
        ...patch,
    };
}

describe("character visual Director proposal", () => {
    it("binding 缺失时使用稳定错误出口且不调用 Agent", async () => {
        const testRuntime = runtime({isDirectorConfigured: vi.fn(async () => false)});
        await expect(generateCharacterVisualProposal({
            projectPath: "workspace/demo",
            characterPath: "lorebook/character/alice/index.md",
        }, testRuntime)).rejects.toMatchObject({code: ILLUSTRATION_DIRECTOR_MODEL_NOT_CONFIGURED});
        expect(testRuntime.invoke).not.toHaveBeenCalled();
    });

    it("只把 source bytes/hash 交给 illustration.director，并持久化 proposal preview", async () => {
        const testRuntime = runtime();
        const result = await generateCharacterVisualProposal({
            projectPath: "workspace/demo",
            characterPath: "lorebook/character/alice/index.md",
        }, testRuntime);
        expect(result.state).toBe("proposal_ready");
        expect(testRuntime.invoke).toHaveBeenCalledWith(expect.objectContaining({
            characterMarkdown,
            sourceCharacterFileHash: sourceHash,
        }));
        expect(testRuntime.save).toHaveBeenCalledWith(expect.objectContaining({
            proposal: expect.objectContaining({operation: "propose-character-visual"}),
        }));
    });

    it("blocked report 原样返回诊断，不创建 migration proposal", async () => {
        const testRuntime = runtime({
            invoke: vi.fn(async () => ({
                sessionId: 13,
                invocationId: "invocation-13",
                status: "completed",
                data: {
                    ...completedProposal(),
                    state: "blocked",
                    character: null,
                    outfits: [],
                    summary: "角色事实不足。",
                    diagnostics: [{code: "SOURCE_FACTS_INSUFFICIENT", message: "没有明确外貌字段。"}],
                },
            })),
        });
        const result = await generateCharacterVisualProposal({
            projectPath: "workspace/demo",
            characterPath: "lorebook/character/alice/index.md",
        }, testRuntime);
        expect(result).toMatchObject({state: "blocked", summary: "角色事实不足。"});
        expect(testRuntime.save).not.toHaveBeenCalled();
    });

    it("拒绝未绑定当前角色 source hash 的 Agent 输出", async () => {
        const testRuntime = runtime({
            invoke: vi.fn(async () => ({
                sessionId: 14,
                invocationId: "invocation-14",
                status: "completed",
                data: {...completedProposal(), sourceCharacterFileHash: `sha256:${"0".repeat(64)}`},
            })),
        });
        await expect(generateCharacterVisualProposal({
            projectPath: "workspace/demo",
            characterPath: "lorebook/character/alice/index.md",
        }, testRuntime)).rejects.toBeInstanceOf(CharacterVisualProposalError);
        expect(testRuntime.save).not.toHaveBeenCalled();
    });
});
