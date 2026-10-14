/**
 * 外壳的全局快捷键（t15 阶段 2d）：`/` 与 Ctrl+K（macOS 上 Cmd+K）把焦点放进顶栏的搜索框。
 * 焦点在可编辑的地方（输入框、`textarea`、`contenteditable`、xterm 的 `.xterm-helper-textarea`）或对话框里时不处理：
 * 那里的 `/` 是要打进去的字，接管中的终端要原样收到 Ctrl+K。外壳在冒泡阶段监听，也不在捕获阶段 `preventDefault`，
 * 先处理按键的元素（例如 xterm）拦下的按键这里看不到。接管时退出键盘的 Ctrl+]（决定点 11）不在这里处理。
 * 判定只看按键与焦点所在的元素，不用 DOM 类型（L1 测试在 Node 类型下导入它，用结构相同的对象代替）。
 */

export type ShortcutKey = {key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean; defaultPrevented: boolean};
export type ShortcutTarget = {tagName: string; isContentEditable: boolean; closest(selector: string): unknown; getAttribute(name: string): string | null} | null;

/** 不接受文字输入的 input 类型：焦点在它们上面时 `/` 仍可用来聚焦搜索。 */
const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

export function isEditableTarget(target: ShortcutTarget): boolean {
    if (!target) return false;
    const tag = target.tagName.toUpperCase();
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag === "INPUT") return !NON_TEXT_INPUTS.has((target.getAttribute("type") ?? "text").toLowerCase());
    return target.isContentEditable || target.closest(".xterm") !== null;
}

/** 这次按键要不要把焦点挪到搜索框。 */
export function wantsSearchFocus(event: ShortcutKey, target: ShortcutTarget): boolean {
    if (event.isComposing || event.defaultPrevented) return false;
    const slash = event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey;
    const commandK = event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    if (!slash && !commandK) return false;
    if (isEditableTarget(target)) return false;
    return !(target?.closest("[role='dialog'], [role='alertdialog']"));
}
