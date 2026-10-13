import {describe, expect, test} from "bun:test";
import {TERMINAL_FONT_FALLBACK, terminalFontFamily} from "../src/web/host/terminal-font.js";

/** 交给 xterm 的字体串不能有 CSS 变量：canvas 量字时整串作废，格宽退回 10px sans-serif（t12 实现审查 F1）。 */
describe("终端字体串", () => {
    test("用 --font-mono 的计算值拼，不含 var(；值为空或仍带变量时用具体的缺省字体", () => {
        const nbook = "\"SF Mono\", ui-monospace, Menlo, Consolas, \"Noto Sans Mono CJK SC\", monospace";
        expect(terminalFontFamily(` ${nbook} `)).toBe(`"Noto Sans Mono CJK SC", "Sarasa Mono SC", ${nbook}`);
        expect(terminalFontFamily("")).toBe(TERMINAL_FONT_FALLBACK);
        expect(terminalFontFamily("var(--font-code), monospace")).toBe(TERMINAL_FONT_FALLBACK);
        for (const value of [nbook, "", "var(--x)"]) expect(terminalFontFamily(value)).not.toContain("var(");
        expect(TERMINAL_FONT_FALLBACK).toEndWith("monospace");
    });
});
