/**
 * 网页终端的输入整理（纯函数，L1 测试）。帧里不带应用的终端模式（docs/herdr.md），浏览器的粘贴要由页面这边处理：
 * - 去掉 Esc 与其它 C0 控制字符（制表符、换行除外），挡住用 `\e[201~` 提前结束粘贴、把后面的字节当按键的路子；换行统一成 `\r`；
 * - Ctrl+C：有选中的文字时让浏览器复制（不发 `\x03`），没有时照常发。
 */
export function sanitizePaste(text: string): string {
    return text.replace(/\r\n?/gu, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, "").replace(/\n/gu, "\r");
}

/** 键盘事件里用到的几项（与 DOM 的 `KeyboardEvent` 同名字段；不引 DOM 类型，测试在 Node 类型下也能用）。 */
export type KeyLike = {type: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; key: string};

export function letBrowserCopy(event: KeyLike, hasSelection: boolean): boolean {
    return event.type === "keydown" && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "c" && hasSelection;
}
