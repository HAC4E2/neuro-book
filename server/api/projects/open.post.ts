import {z} from "zod";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {openProject} from "nbook/server/workspace-files/project-session";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {normalizeProjectPath} from "nbook/server/workspace-files/project-path";
import {resolveNovelWorkspaceTarget} from "nbook/server/workspace-files/novel-workspace";

const OpenProjectBodySchema = z.object({
    projectPath: z.string().trim().min(1, "projectPath 不能为空"),
});

/**
 * 显式打开 Project 会话（Task 94）。
 * openProject 内部完成目录校验（404）与数据库迁移收敛；未 open 前数据面接口会以 409 拒绝。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, OpenProjectBodySchema);
    const runtimePaths = runtimePathsFromEnv();
    const projectPath = normalizeProjectPath(body.projectPath);
    const target = await resolveNovelWorkspaceTarget(runtimePaths, projectPath);
    await openProject(runtimePaths.workspaceRoot, target.projectPath, {kind: "user"});
    return {success: true};
});
