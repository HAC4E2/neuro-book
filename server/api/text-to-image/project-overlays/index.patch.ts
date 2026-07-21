import {throwProjectOverlayHttpError} from "nbook/server/text-to-image/project-overlay-http-error";
import {ProjectOverlayService} from "nbook/server/text-to-image/project-overlay.service";
import {ProjectOverlaySaveRequestSchema} from "nbook/shared/text-to-image-project-overlays";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

const overlayService = new ProjectOverlayService();

/** CAS 保存 Project overlay draft 或由服务端校验并批准应用。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    const body = await validateBody(event, ProjectOverlaySaveRequestSchema);
    try {
        return await overlayService.save(body);
    } catch (error) {
        throwProjectOverlayHttpError(error);
    }
}));
