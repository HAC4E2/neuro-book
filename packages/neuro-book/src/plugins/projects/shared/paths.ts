/**
 * 用户输入的路径里的 `~`（docs/specs/runtime/projects.md 输入与前置条件）：只认开头的 `~` 与 `~/`，按服务端进程用户的主目录
 * 展开；`~user` 这种写法不认、原样交给后面的目录校验。两端共用：服务端展开，页面显示时也按同一规则预览。
 */

const SEPARATORS = new Set(["/", "\\"]);

export function expandHome(input: string, home: string): string {
    if (input === "~") return home;
    if (input.length > 1 && input.startsWith("~") && SEPARATORS.has(input[1] as string)) return `${home}${input.slice(1)}`;
    return input;
}
