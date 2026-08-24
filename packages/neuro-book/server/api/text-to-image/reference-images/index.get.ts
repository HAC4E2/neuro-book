import {defineEventHandler} from "h3";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {listTextToImageReferenceImages} from "nbook/server/text-to-image/reference-image.service";

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    return {
        items: await listTextToImageReferenceImages(),
    };
});
