import {readFile} from "node:fs/promises";
import {defineEventHandler, getQuery, send} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {resolveTextToImageReferenceImagePath} from "nbook/server/text-to-image/reference-image.service";

const ContentQuerySchema = z.object({
    path: z.string().trim().min(1),
});

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const query = ContentQuerySchema.parse(getQuery(event));
    const absolutePath = await resolveTextToImageReferenceImagePath(query.path);
    const extension = query.path.split(".").pop()?.toLowerCase() ?? "";
    const mimeType = extension === "webp"
        ? "image/webp"
        : extension === "jpg" || extension === "jpeg"
            ? "image/jpeg"
            : "image/png";
    return await send(event, await readFile(absolutePath), mimeType);
});
