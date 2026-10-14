import {describe, expect, test} from "bun:test";
import {hexWithAlpha} from "../src/web/host/terminal-colors.js";

/** xterm 主题的颜色串只能是它解析得了的写法：color-mix 会被丢掉（t15 阶段 2a）。 */
describe("带透明度的终端颜色", () => {
    test("#rrggbb 与 #rgb 拼成 8 位十六进制；别的写法不给，交给 xterm 用缺省色", () => {
        expect(hexWithAlpha("#918A7E", 0.45)).toBe("#918a7e73");
        expect(hexWithAlpha(" #abc ", 1)).toBe("#aabbccff");
        expect(hexWithAlpha("#918a7e", 2)).toBe("#918a7eff");
        expect(hexWithAlpha("rgb(1, 2, 3)", 0.5)).toBeUndefined();
        expect(hexWithAlpha("color-mix(in srgb, #fff 50%, transparent)", 0.5)).toBeUndefined();
        expect(hexWithAlpha("", 0.5)).toBeUndefined();
    });
});
