import {defineEventHandler} from "h3";
import {z} from "zod";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {TextToImageQueueService} from "nbook/server/text-to-image/queue.service";

const EnqueueBodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    providerId: z.number().int().positive(),
    kind: z.enum(["manual", "body", "character", "reroll", "inpaint"]),
    requestJson: z.string(),
    sourcePath: z.string().trim().nullable().optional(),
    sourceAnchorId: z.string().trim().nullable().optional(),
});

export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    const body = await validateBody(event, EnqueueBodySchema);
    const providers = await new TextToImageProviderService().list(user.id);
    const provider = providers.find((item) => item.id === body.providerId);
    if (!provider) {
        throw new Error("Provider 不存在");
    }
    return await new TextToImageQueueService().enqueue({
        projectPath: `workspace/${body.projectRoot}`,
        providerId: body.providerId,
        providerOwnerUserId: user.id,
        providerCredentialRevision: provider.credentialRevision,
        kind: body.kind,
        requestJson: body.requestJson,
        providerSnapshotJson: JSON.stringify({
            providerId: provider.id,
            credentialRevision: provider.credentialRevision,
        }),
        sourcePath: body.sourcePath,
        sourceAnchorId: body.sourceAnchorId,
    });
});
