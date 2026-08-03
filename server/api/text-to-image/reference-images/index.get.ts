import {defineEventHandler} from "h3";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {listTextToImageReferenceImages} from "nbook/server/text-to-image/reference-image.service";

export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    return {
        items: await listTextToImageReferenceImages(),
    };
});
