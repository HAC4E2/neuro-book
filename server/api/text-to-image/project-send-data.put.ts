import {defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";
import {
    TextToImageProjectSendDataSchema,
} from "nbook/shared/dto/text-to-image.dto";
import {writeProjectSendData} from "nbook/server/text-to-image/project-send-data.service";

const ProjectSendDataBodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    sendData: TextToImageProjectSendDataSchema,
}).strict();

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const body = await validateBody(event, ProjectSendDataBodySchema);
    const projectRoot = resolveTextToImageProjectRoot(body.projectRoot);
    return {sendData: await writeProjectSendData(projectRoot, body.sendData)};
});
