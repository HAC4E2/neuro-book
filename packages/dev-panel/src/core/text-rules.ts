import {NbdevError} from "./errors.js";

/**
 * 写进记录的文字的规则，命令行与面板共用；前端直接导入（本模块只依赖 errors.js，没有 Node 依赖）。
 * 命令行参数里带不进 NUL，JSON 可以：NUL 与其它 C0 控制字符一旦写进 README，Git 会把它当二进制文件，差异只剩“Binary files differ”。
 */

/** 单行文字里不允许的字符：C0 控制字符，制表符除外（含换行）。 */
const SINGLE_LINE_FORBIDDEN = /[\u0000-\u0008\u000a-\u001f]/u;
/** 正文类文字（目标、说明、备注、文字答复、编辑内容）里不允许的字符：C0 控制字符，制表符与换行除外（`\r` 也不收）。 */
const MULTI_LINE_FORBIDDEN = /[\u0000-\u0008\u000b-\u001f]/u;

/** 不合规时返回原因，合规返回 null。 */
export function controlCharProblem(text: string, multiline: boolean): string | null {
    const match = (multiline ? MULTI_LINE_FORBIDDEN : SINGLE_LINE_FORBIDDEN).exec(text);
    if (!match) return null;
    const code = match[0].codePointAt(0)!;
    if (!multiline && (code === 0x0a || code === 0x0d)) return "只能写一行";
    return `含控制字符 U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** 标题：非空的单行文字。不合规时返回原因。 */
export function titleProblem(title: string): string | null {
    if (title.trim() === "") return "不能为空";
    return controlCharProblem(title.trim(), false);
}

export function assertTitle(title: string, label: string): string {
    const problem = titleProblem(title);
    if (problem) throw new NbdevError("invalid_title", `${label}必须是非空的单行文字（${problem}）`, {details: {title}});
    return title.trim();
}

/** 正文类或单行的文字字段；`field` 写进 `details.field`，界面据此把错误放到字段旁。 */
export function assertPlainText(text: string, field: string, multiline: boolean): string {
    const problem = controlCharProblem(text, multiline);
    if (problem) throw new NbdevError("invalid_text", `${field}${problem}`, {details: {field, reason: "control_char"}});
    return text;
}

/** 治理入口非空行上限的数法（与 `governance:check` 相同：去掉只有空白的行）。编辑页实时显示它。 */
export function countNonEmptyLines(text: string): number {
    return text.split(/\r?\n/u).filter((line) => line.trim().length > 0).length;
}
