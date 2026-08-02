import {z} from "zod";
import {
    IllustrationExecutionAuthorizationSchema,
    type IllustrationExecutionAuthorization,
} from "nbook/shared/text-to-image-execution";
import {
    IllustrationExecutionPreviewSchema,
    type IllustrationExecutionPreview,
} from "nbook/shared/text-to-image-execution-ui";
import {StoryboardStableIdSchema} from "nbook/shared/text-to-image-storyboard-preset";

const ProjectPathSchema = z.string().regex(/^workspace\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u);

export type IllustrationGenerateBody = {
    projectPath: string;
    previewToken: string;
    manifestHash: string;
    authorization: IllustrationExecutionAuthorization;
};

export type IllustrationBatchGenerateBody = IllustrationGenerateBody & {
    placeholderIds: string[];
};

/** 用户授权严格等于 Preview 已展示的 output 与可得预算，不允许页面追加生成参数。 */
export function buildIllustrationAuthorization(previewInput: IllustrationExecutionPreview): IllustrationExecutionAuthorization {
    const preview = IllustrationExecutionPreviewSchema.parse(previewInput);
    return IllustrationExecutionAuthorizationSchema.parse({
        authorizedOutputCount: preview.outputCount,
        acceptedAdditionalCostLowerBound: preview.additionalCostLowerBound,
        acceptedTokenLowerBound: preview.tokenLowerBound,
    });
}

/** 单按钮 generate 的精确请求体；placeholderId 只能来自路由。 */
export function buildIllustrationGenerateBody(projectPathInput: string, previewInput: IllustrationExecutionPreview): IllustrationGenerateBody {
    const projectPath = ProjectPathSchema.parse(projectPathInput);
    const preview = IllustrationExecutionPreviewSchema.parse(previewInput);
    return {
        projectPath,
        previewToken: preview.previewToken,
        manifestHash: preview.manifestHash,
        authorization: buildIllustrationAuthorization(preview),
    };
}

/** Batch generate 只增加服务端发布的唯一 placeholder ID 集，不接受 CompiledRequest。 */
export function buildIllustrationBatchGenerateBody(
    projectPathInput: string,
    placeholderIdsInput: string[],
    previewInput: IllustrationExecutionPreview,
): IllustrationBatchGenerateBody {
    const placeholderIds = z.array(StoryboardStableIdSchema).min(1).max(32).parse(placeholderIdsInput);
    if (new Set(placeholderIds).size !== placeholderIds.length) throw new Error("批量 placeholderId 不能重复");
    return {
        ...buildIllustrationGenerateBody(projectPathInput, previewInput),
        placeholderIds,
    };
}

/** 生成用户授权前可见的安全摘要；不包含完整 Prompt 或凭据。 */
export function formatIllustrationPreviewSummary(previewInput: IllustrationExecutionPreview): string {
    const preview = IllustrationExecutionPreviewSchema.parse(previewInput);
    const dimensions = preview.requests.map((request) => `${request.width}×${request.height}`).join("、");
    const budget = preview.additionalCostLowerBound !== null
        ? `额外费用下限 ${preview.additionalCostLowerBound}`
        : preview.tokenLowerBound !== null ? `Token 下限 ${preview.tokenLowerBound}` : "费用由 Provider 结算";
    return `${preview.recipe.title} · ${preview.requests[0]?.model ?? "NovelAI"} · ${dimensions} · ${preview.outputCount} 张 · ${budget}`;
}
