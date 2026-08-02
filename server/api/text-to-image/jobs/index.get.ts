import {createError, getQuery} from "h3";
import {createTextToImageQueueService} from "nbook/server/text-to-image/queue.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {assertProjectOpen} from "nbook/server/workspace-files/project-session";
import type {TextToImageJobDto} from "nbook/shared/dto/text-to-image.dto";
import {textToImageProjectRef} from "nbook/server/text-to-image/compat";

const statuses: TextToImageJobDto["status"][] = ["queued", "running", "completing", "succeeded", "failed", "canceled", "interrupted", "configuration_stale", "outcome_unknown"];

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const query = getQuery(event);
    const projectPath = typeof query.projectPath === "string" ? query.projectPath : "";
    if (!projectPath) {
        throw createError({statusCode: 400, message: "projectPath 不能为空"});
    }
    assertProjectOpen(textToImageProjectRef(projectPath));
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
