import {z} from "zod";
import {ILLUSTRATION_DIRECTOR_CONVERTER_VERSION} from "nbook/shared/agent/illustration-director";
import {SourceRelativeJsonPathSchema} from "nbook/shared/text-to-image-storyboard-import";
import {
    createStoryboardImportInspectPreview,
    inspectStoryboardImport,
} from "nbook/server/text-to-image/storyboard-import.service";
import {throwStoryboardImportHttpError} from "nbook/server/text-to-image/storyboard-import-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

const BodySchema = z.object({
    projectPath: z.string().trim().min(1).max(500),
    sourceRelativePath: SourceRelativeJsonPathSchema,
}).strict();

/** strict inspect 并写入脱敏 archive；响应不返回原 entry content。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    const body = await validateBody(event, BodySchema);
    try {
        const inspected = await inspectStoryboardImport({
            ...body,
            converterVersion: ILLUSTRATION_DIRECTOR_CONVERTER_VERSION,
        });
        return createStoryboardImportInspectPreview(inspected);
    } catch (error) {
        throwStoryboardImportHttpError(error);
    }
}));
