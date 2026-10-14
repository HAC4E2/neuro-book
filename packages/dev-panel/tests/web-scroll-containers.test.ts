import {describe, expect, test} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";

/**
 * 滚动容器要做绝对定位后代的包含块（t15 阶段 4 第 1 批）。nb-ui 的 CheckboxGroup 把 `sr-only`（`position: absolute`）的 input
 * 放在 label 里，点选项时焦点给它；容器不是 `relative` 时它的包含块落到外面 Splitter 那一格（`overflow: hidden`），
 * 浏览器为了把它滚进视野去滚那一格，整页内容被推出视野（多选题点了页面变空白）。布局在测试环境里量不到，这里按源码钉住约定。
 */
const WEB = join(import.meta.dir, "../src/web");
const SCROLL = /(?:^|\s)(?:[a-z]+:)*overflow(?:-[xy])?-(?:auto|scroll)(?:\s|$)/u;

function vueFiles(dir: string): string[] {
    return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => (entry.isDirectory() ? vueFiles(join(dir, entry.name)) : entry.name.endsWith(".vue") ? [join(dir, entry.name)] : []));
}

describe("滚动容器", () => {
    test("开了滚动的元素都带 relative（等宽预览块 pre 除外：里面没有表单控件）", () => {
        const missing: string[] = [];
        for (const file of vueFiles(WEB)) {
            const text = readFileSync(file, "utf8");
            const template = text.slice(text.indexOf("<template>"));
            for (const match of template.matchAll(/\sclass="([^"]*)"/gu)) {
                const classes = match[1]!;
                if (!SCROLL.test(classes) || /(?:^|\s)relative(?:\s|$)/u.test(classes)) continue;
                const tag = /<([a-zA-Z][\w-]*)[^<]*$/u.exec(template.slice(0, match.index))?.[1];
                if (tag === "pre") continue;
                missing.push(`${relative(WEB, file)}：<${tag} class="${classes.slice(0, 60)}…">`);
            }
        }
        expect(missing).toEqual([]);
    });

    test("共用的滚动类 nbdev-scroll-y 带 position: relative，外壳的 main 也带", () => {
        const css = readFileSync(join(WEB, "app.css"), "utf8");
        expect(/\.nbdev-scroll-y \{[^}]*position: relative;/u.test(css)).toBe(true);
        const app = readFileSync(join(WEB, "App.vue"), "utf8");
        expect(/<main id="nbdev-main"[^>]*class="[^"]*\brelative\b/u.test(app)).toBe(true);
    });
});
