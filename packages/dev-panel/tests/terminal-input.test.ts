import {describe, expect, test} from "bun:test";
import {letBrowserCopy, sanitizePaste, type KeyLike} from "../src/web/host/terminal-input.js";

/** t12 网页终端的输入整理（L1）。 */
describe("粘贴与复制", () => {
    test("粘贴去掉 Esc 与其它控制字符，挡住用 ESC[201~ 提前结束粘贴；换行统一成回车，制表符留着", () => {
        expect(sanitizePaste("第一行\r\n第二行\n\t缩进")).toBe("第一行\r第二行\r\t缩进");
        expect(sanitizePaste("正常\u001b[201~rm -rf ~\u001b[200~")).toBe("正常[201~rm -rf ~[200~");
        expect(sanitizePaste("a\u0000b\u0007c\u007fd")).toBe("abcd");
    });

    test("Ctrl+C：有选中的文字时交给浏览器复制，没有时照常发；带别的修饰键不算", () => {
        const key = (extra: Partial<KeyLike> = {}) => ({type: "keydown", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, key: "c", ...extra});
        expect(letBrowserCopy(key(), true)).toBe(true);
        expect(letBrowserCopy(key(), false)).toBe(false);
        expect(letBrowserCopy(key({shiftKey: true}), true)).toBe(false);
        expect(letBrowserCopy(key({type: "keyup"}), true)).toBe(false);
        expect(letBrowserCopy(key({key: "C"}), true)).toBe(true);
    });
});
