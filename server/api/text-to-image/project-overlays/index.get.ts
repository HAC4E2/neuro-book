import {getQuery} from "h3";
import {z} from "zod";
import {throwProjectOverlayHttpError} from "nbook/server/text-to-image/project-overlay-http-error";
import {ProjectOverlayService} from "nbook/server/text-to-image/project-overlay.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

const QuerySchema = z.object({projectPath: z.string().trim().min(1).max(500)}).strict();
const overlayService = new ProjectOverlayService();

/** 读取当前 Project 对 active global companion 的两类 overlay 编辑快照。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    const parsed = QuerySchema.safeParse(getQuery(event));
    if (!parsed.success) throw createError({statusCode: 400, message: "projectPath 不合法"});
    try {
        return await overlayService.read(parsed.data);
    } catch (error) {
        throwProjectOverlayHttpError(error);
    }
}));
