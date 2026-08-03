import {defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {deleteTextToImageReferenceImage} from "nbook/server/text-to-image/reference-image.service";

const DeleteReferenceImageBodySchema = z.object({
    relativePath: z.string().trim().min(1),
});

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const body = await validateBody(event, DeleteReferenceImageBodySchema);
    await deleteTextToImageReferenceImage(body.relativePath);
    return {ok: true};
});
