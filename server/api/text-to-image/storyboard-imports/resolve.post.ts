import {randomUUID} from "node:crypto";
import {z} from "zod";
import {loadEffectiveConfig} from "nbook/server/config/config-service";
import {TagIndexReader} from "nbook/server/text-to-image/tag-index/tag-index-reader";
import {isTagIndexError} from "nbook/server/text-to-image/tag-index/tag-index-error";
import {TagIndexStore} from "nbook/server/text-to-image/tag-index/tag-index-store";
import {TagPolicyRegistryService} from "nbook/server/text-to-image/tag-index/tag-policy-registry";
import {TagResolverService} from "nbook/server/text-to-image/tag-index/tag-resolver.service";
import {throwTagIndexHttpError} from "nbook/server/text-to-image/tag-index/tag-index-http-error";
import {resolveStoryboardImportTags} from "nbook/server/text-to-image/storyboard-import.service";
import {throwStoryboardImportHttpError} from "nbook/server/text-to-image/storyboard-import-http-error";
import {TAG_INDEX_CAPABILITY_VERSION} from "nbook/shared/text-to-image-tag-index";
import {StoryboardStableIdSchema} from "nbook/shared/text-to-image-storyboard-preset";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";

const BodySchema = z.object({
    projectPath: z.string().trim().min(1).max(500),
    importId: StoryboardStableIdSchema,
    expectedPreviewToken: TextToImageContractHashSchema,
    approvals: z.array(z.object({
        reviewRequestHash: TextToImageContractHashSchema,
        reason: z.string().trim().min(1).max(500),
    }).strict()).max(100000),
}).strict();

/** 显式解析 pending atoms；actor/approval identity 由服务端当前用户生成。 */
export default defineEventHandler((event) => withProjectHttpError(async () => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, BodySchema);
    try {
        const effective = await loadEffectiveConfig({workspaceKind: "novel", projectRoot: body.projectPath.replace(/^workspace\//, "")});
        const resolver = new TagResolverService({
            reader: new TagIndexReader({root: new TagIndexStore().root}),
            policyRegistry: new TagPolicyRegistryService(),
            capabilityVersion: TAG_INDEX_CAPABILITY_VERSION,
            resolveProjectPolicy: async () => effective.illustration.tagPolicy,
            idFactory: () => `tag-resolution-${randomUUID()}`,
        });
        return await resolveStoryboardImportTags({
            projectPath: body.projectPath,
            importId: body.importId,
            expectedPreviewToken: body.expectedPreviewToken,
            approvals: body.approvals.map((approval) => ({
                ...approval,
                approvalId: `approval-${randomUUID()}`,
                actorId: `user-${user.id}`,
            })),
        }, {resolver});
    } catch (error) {
        if (isTagIndexError(error)) throwTagIndexHttpError(error);
        throwStoryboardImportHttpError(error);
    }
}));
