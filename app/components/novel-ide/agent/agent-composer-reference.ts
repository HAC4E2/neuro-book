/**
 * 把 Composer 从当前 Project Workspace 菜单取得的相对引用补成完整 Project File Address。
 * 已经是 managed 地址或绝对地址的目标只做斜杠规范化，不重复添加 Project Path。
 */
export function completeProjectFileAddress(target: string, projectPath: string | null): string {
    const normalized = target.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
    if (normalized.startsWith("workspace/") || /^(?:[a-z][a-z0-9+.-]*:|\/)/iu.test(normalized)) {
        return normalized;
    }
    const normalizedProjectPath = projectPath?.trim().replaceAll("\\", "/").replace(/\/+$/u, "");
    return normalizedProjectPath?.startsWith("workspace/")
        ? `${normalizedProjectPath}/${normalized}`
        : normalized;
}
