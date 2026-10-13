/**
 * 网页终端的字体（t12 实现审查 F1）。xterm 按 canvas 量字宽（`ctx.font = "<字号>px <字体串>"` 再量 “W”），canvas 不认 CSS 变量：
 * 字体串里有 `var()` 时整串作废、退回 `10px sans-serif`，格宽与字号无关，字之间被撑开。所以交给 xterm 的字体串一律是解析过的具体字体。
 * 本文件不用 DOM 类型（L1 测试在 Node 类型下导入它）；读计算值与量字宽在 `terminal-theme.ts`。
 */

/** 解析不到 `--font-mono` 时用的具体字体（中文与英文都等宽的放前面）。 */
export const TERMINAL_FONT_FALLBACK = "\"Noto Sans Mono CJK SC\", \"Sarasa Mono SC\", ui-monospace, Menlo, Consolas, \"Liberation Mono\", monospace";

/** 由 `--font-mono` 的计算值拼出交给 xterm 的字体串；值为空或仍含 `var(` 时用 `TERMINAL_FONT_FALLBACK`。 */
export function terminalFontFamily(fontMono: string): string {
    const value = fontMono.trim();
    if (value === "" || value.includes("var(")) return TERMINAL_FONT_FALLBACK;
    return `"Noto Sans Mono CJK SC", "Sarasa Mono SC", ${value}`;
}
