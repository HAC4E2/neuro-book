import {defineEventHandler} from "h3";
import {z} from "zod";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {deleteTextToImageReferenceImage} from "nbook/server/text-to-image/reference-image.service";

const DeleteReferenceImageBodySchema = z.object({
    relativePath: z.string().trim().min(1),
});

export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    const body = await validateBody(event, DeleteReferenceImageBodySchema);
    await deleteTextToImageReferenceImage(body.relativePath);
    return {ok: true};
});
