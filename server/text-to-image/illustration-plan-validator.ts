import {hashTextToImageContract, type TextToImageContractValue} from "nbook/shared/text-to-image-contract-hash";
import {
    ILLUSTRATION_PLAN_VALIDATOR_VERSION,
    IllustrationPlanningOperationSchema,
    IllustrationPlanningProposalSchema,
    ValidatedIllustrationPlanSchema,
    type IllustrationPlanningOperation,
    type IllustrationPlanningProposal,
    type ShotIntentCore,
    type ValidatedIllustrationPlan,
} from "nbook/shared/text-to-image-illustration-planning";
import {
    SemanticTagResolutionSchema,
    type SemanticTagResolution,
} from "nbook/shared/text-to-image-tag-resolution";

export type IllustrationPlanClosure = {
    characterIds: string[];
    outfitRefs: string[];
    patternIds: string[];
    anchorIds: string[];
    terminalResolutions: Array<{resolutionId: string; resolution: SemanticTagResolution}>;
};

export type ValidatedIllustrationShot = ShotIntentCore & {
    anchorId: string;
    insertAfterAnchorId: string;
    tagResolutions: Record<string, SemanticTagResolution>;
    shotIntentHash: string;
};

/** 整份 proposal 的闭集硬校验错误；任何单项越权都使整次规划失败。 */
export class IllustrationPlanValidationError extends Error {
    readonly code = "ILLUSTRATION_PLAN_INVALID" as const;

    constructor(message: string, options?: {cause?: Error}) {
        super(`ILLUSTRATION_PLAN_INVALID: ${message}`, options);
        this.name = "IllustrationPlanValidationError";
    }
}

/**
 * 校验 Director Shot Intent，并由服务端注入可信锚点与 terminal Tag snapshots。
 *
 * 本函数纯计算，不写 `illustrations.md`、章节、Job 或 Provider 状态。
 */
export function validateIllustrationPlan(input: {
    operation: IllustrationPlanningOperation;
    proposal: IllustrationPlanningProposal;
    closure: IllustrationPlanClosure;
    /** 仅 plan-selection 必须提供；模型输出完全不含该字段。 */
    selectionAnchor?: {anchorId: string; insertAfterAnchorId: string};
}): ValidatedIllustrationPlan {
    try {
        const operation = IllustrationPlanningOperationSchema.parse(input.operation);
        const proposal = IllustrationPlanningProposalSchema.parse(input.proposal);
        if (proposal.operation !== operation) throw invalid("proposal operation 与 Workflow 不一致");

        /** P6：review-candidates 不走 shot 校验，只做 schema parse + 注入验证。 */
        if (proposal.operation === "review-candidates") {
            return ValidatedIllustrationPlanSchema.parse({
                schemaVersion: "nbook.validated-illustration-plan/v1",
                validatorVersion: ILLUSTRATION_PLAN_VALIDATOR_VERSION,
                operation: "review-candidates",
                shots: [],
                reviews: proposal.reviews.map((review) => ({
                    placeholderId: review.placeholderId,
                    assessment: review.assessment,
                    reason: review.reason,
                    suggestedAdjustments: review.suggestedAdjustments,
                })),
                reviewSummary: proposal.summary,
            });
        }

        const characters = strictSet(input.closure.characterIds, "characterId");
        const outfits = strictSet(input.closure.outfitRefs, "outfitRef");
        const patterns = strictSet(input.closure.patternIds, "patternId");
        const anchors = strictSet(input.closure.anchorIds, "anchorId");
        const terminal = new Map(input.closure.terminalResolutions.map((item) => [
            item.resolutionId,
            SemanticTagResolutionSchema.parse(item.resolution),
        ]));
        if (terminal.size !== input.closure.terminalResolutions.length) throw invalid("terminal resolutionId 重复");

        const proposals: Array<ShotIntentCore & {anchorCandidateId?: string}> = proposal.operation === "plan-chapter"
            ? proposal.shots
            : [proposal.shot];
        if (operation === "plan-selection" && !input.selectionAnchor) throw invalid("plan-selection 缺少服务端可信锚点");
        if (operation === "plan-chapter" && input.selectionAnchor) throw invalid("plan-chapter 不能携带 selection anchor");
        const usedChapterAnchors = new Set<string>();
        const shots = proposals.map((shot): ValidatedIllustrationShot => {
            const modelAnchor = shot.anchorCandidateId ?? null;
            const anchorId = operation === "plan-selection" ? input.selectionAnchor!.anchorId : modelAnchor;
            const insertAfterAnchorId = operation === "plan-selection" ? input.selectionAnchor!.insertAfterAnchorId : modelAnchor;
            if (!anchorId || !insertAfterAnchorId || !anchors.has(anchorId) || !anchors.has(insertAfterAnchorId)) {
                throw invalid("镜头引用了未曝光或已漂移的锚点");
            }
            if (operation === "plan-chapter") {
                if (usedChapterAnchors.has(anchorId)) throw invalid("整章规划不能重复使用同一锚点");
                usedChapterAnchors.add(anchorId);
            }
            for (const characterId of shot.characterIds) {
                if (!characters.has(characterId)) throw invalid(`未知角色：${characterId}`);
            }
            for (const actionCharacterId of Object.keys(shot.action)) {
                if (!characters.has(actionCharacterId) || !shot.characterIds.includes(actionCharacterId)) {
                    throw invalid(`action 引用了镜头闭集外角色：${actionCharacterId}`);
                }
            }
            for (const outfitRef of shot.outfitRefs) {
                if (!outfits.has(outfitRef)) throw invalid(`未知服装：${outfitRef}`);
                const owner = /^lorebook\/character\/([^/]+)\/outfits\//u.exec(outfitRef)?.[1];
                if (!owner || !shot.characterIds.includes(owner)) throw invalid(`服装 owner 不属于镜头角色：${outfitRef}`);
            }
            for (const patternId of shot.tagPatternRefs) {
                if (!patterns.has(patternId)) throw invalid(`Pattern 未在 Planning Input 闭集中曝光：${patternId}`);
            }
            const resolutionIds = [...shot.tagDelta.prefer, ...shot.tagDelta.avoid].map((item) => item.resolutionId);
            const tagResolutions = Object.fromEntries(resolutionIds.map((resolutionId) => {
                const resolution = terminal.get(resolutionId);
                if (!resolution) throw invalid(`Tag ref 不是当前 run 的 terminal resolution：${resolutionId}`);
                return [resolutionId, resolution];
            }));
            const core = createShotCoreValue(shot);
            const shotIntentHash = hashTextToImageContract({
                schemaVersion: "nbook.shot-intent/v1",
                validatorVersion: ILLUSTRATION_PLAN_VALIDATOR_VERSION,
                operation,
                anchorId,
                insertAfterAnchorId,
                shot: core,
                tagResolutionIds: [...resolutionIds].sort(compareText),
            });
            return {
                purpose: shot.purpose,
                characterIds: [...shot.characterIds],
                outfitRefs: [...shot.outfitRefs],
                action: {...shot.action},
                composition: {...shot.composition},
                continuity: {...shot.continuity},
                tagPatternRefs: [...shot.tagPatternRefs],
                tagDelta: {
                    prefer: shot.tagDelta.prefer.map((item) => ({...item})),
                    avoid: shot.tagDelta.avoid.map((item) => ({...item})),
                },
                anchorId,
                insertAfterAnchorId,
                tagResolutions,
                shotIntentHash,
            };
        });
        return ValidatedIllustrationPlanSchema.parse({
            schemaVersion: "nbook.validated-illustration-plan/v1",
            validatorVersion: ILLUSTRATION_PLAN_VALIDATOR_VERSION,
            operation,
            shots,
        });
    } catch (error) {
        if (error instanceof IllustrationPlanValidationError) throw error;
        throw new IllustrationPlanValidationError(error instanceof Error ? error.message : "proposal 无法解析", {
            ...(error instanceof Error ? {cause: error} : {}),
        });
    }
}

/** 排除 anchorCandidateId，保证模型无法把服务端位置塞进语义 core。 */
function createShotCoreValue(shot: ShotIntentCore & {anchorCandidateId?: string}): TextToImageContractValue {
    return {
        purpose: shot.purpose,
        characterIds: [...shot.characterIds],
        outfitRefs: [...shot.outfitRefs],
        action: {...shot.action},
        composition: {...shot.composition},
        continuity: {...shot.continuity},
        tagPatternRefs: [...shot.tagPatternRefs],
        tagDelta: {
            prefer: shot.tagDelta.prefer.map((item) => ({resolutionId: item.resolutionId})),
            avoid: shot.tagDelta.avoid.map((item) => ({resolutionId: item.resolutionId})),
        },
    };
}

function strictSet(values: string[], label: string): Set<string> {
    const result = new Set(values);
    if (result.size !== values.length) throw invalid(`${label} 闭集包含重复项`);
    return result;
}

function invalid(message: string): IllustrationPlanValidationError {
    return new IllustrationPlanValidationError(message);
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
