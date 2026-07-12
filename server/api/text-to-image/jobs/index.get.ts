import {createError, getQuery} from "h3";
import {createTextToImageQueueService} from "nbook/server/text-to-image/queue.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {assertProjectOpenForRoot} from "nbook/server/workspace-files/project-open-guard";
import type {TextToImageJobDto} from "nbook/shared/dto/text-to-image.dto";

const statuses: TextToImageJobDto["status"][] = ["queued", "running", "succeeded", "failed", "canceled", "interrupted"];

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const query = getQuery(event);
    const projectPath = typeof query.projectPath === "string" ? query.projectPath : "";
    if (!projectPath) {
        throw createError({statusCode: 400, message: "projectPath 不能为空"});
    }
    assertProjectOpenForRoot(projectPath);
    const status = typeof query.status === "string" && statuses.includes(query.status as TextToImageJobDto["status"])
        ? query.status as TextToImageJobDto["status"]
        : undefined;
    return createTextToImageQueueService(user.id).list({
        projectPath,
        status,
        page: numberQuery(query.page),
        pageSize: numberQuery(query.pageSize),
    });
});

function numberQuery(value: unknown): number | undefined {
    if (typeof value !== "string" || !/^\d+$/u.test(value)) {
        return undefined;
    }
    return Number(value);
}
