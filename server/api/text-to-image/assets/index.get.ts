import {createError, getQuery} from "h3";
import {TextToImageAssetService} from "nbook/server/text-to-image/asset.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {assertProjectOpen} from "nbook/server/workspace-files/project-session";

const statuses = ["queued", "running", "completing", "succeeded", "failed", "canceled", "interrupted", "configuration_stale", "outcome_unknown"] as const;

export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    const query = getQuery(event);
    const projectPath = typeof query.projectPath === "string" ? query.projectPath : "";
    if (!projectPath) {
        throw createError({statusCode: 400, message: "projectPath 不能为空"});
    }
    assertProjectOpen(projectPath);
    return new TextToImageAssetService().list({
        projectPath,
        sourceKind: typeof query.sourceKind === "string" ? query.sourceKind : undefined,
        sourcePath: typeof query.sourcePath === "string" ? query.sourcePath : undefined,
        jobStatus: typeof query.status === "string" && statuses.includes(query.status as typeof statuses[number])
            ? query.status as typeof statuses[number]
            : undefined,
        page: numberQuery(query.page),
        pageSize: numberQuery(query.pageSize),
    });
});

function numberQuery(value: unknown): number | undefined {
    return typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : undefined;
}
