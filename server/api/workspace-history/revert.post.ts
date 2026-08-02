import {z} from "zod";
import {createError} from "h3";
import {ProjectRootDtoSchema} from "nbook/shared/dto/project.dto";
import {withProjectHandlesOperation} from "nbook/server/workspace-files/project-open-guard";
import {LOCAL_USER_ID} from "nbook/server/workspace-history/project-history";
import {matchWorkspaceHistoryInboxGroup} from "nbook/server/workspace-history/history-inbox";

const RevertBodySchema = z.object({
    projectRoot: ProjectRootDtoSchema,
    path: z.string().trim().min(1, "path 不能为空"),
    revision: z.number().int().positive("revision 必须是正整数"),
});

/**
 * 还原一个文件到用户的「已接受基线」：落盘 + 记 file.revert + 位点推进。
 * 还原写盘绕过常规写入口，手动失效 workspace 索引让编辑器立即看到。
 */
export default defineEventHandler(async (event) => {
    const body = RevertBodySchema.parse(await readBody(event));
    return withProjectHandlesOperation(body.projectRoot, async (projectHandles) => {
        await projectHandles.history.waitForWarmup();
        const history = await projectHandles.history.history;
        if (!history) {
            throw createError({statusCode: 400, message: "文件历史未启用"});
        }
        const match = matchWorkspaceHistoryInboxGroup(await history.inbox(LOCAL_USER_ID), body.path, body.revision);
        if (match.kind === "missing") {
            throw createError({statusCode: 404, message: "待审文件不存在或已被接受"});
        }
        if (match.kind === "stale") {
            throw createError({statusCode: 412, message: "文件已发生新变化，请刷新后重新审查"});
        }
        await history.revert(LOCAL_USER_ID, match.group.path);
        projectHandles.fileIndex.invalidate();
        return {success: true};
    });
});
