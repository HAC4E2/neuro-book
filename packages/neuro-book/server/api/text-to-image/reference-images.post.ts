import {defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {saveTextToImageReferenceImage} from "nbook/server/text-to-image/reference-image.service";

const SaveReferenceImageBodySchema = z.object({
    fileName: z.string().trim().min(1),
    dataBase64: z.string().min(1),
});

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const body = await validateBody(event, SaveReferenceImageBodySchema);
    return await saveTextToImageReferenceImage({
        fileName: body.fileName,
        bytes: Uint8Array.from(Buffer.from(body.dataBase64, "base64")),
    });
});
