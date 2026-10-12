/**
 * 生成评审稿用的两份静态资源：tokens-nbook.css 与 assets/icons.js。
 *
 * nb-ui 的配色在运行时由 JS 写到 <html> 的 inline style 上（applyColorway），主题 vars.css
 * 只在 <html data-nb-theme="nbook" data-nb-appearance="..."> 上生效，所以 dist/nb-ui.css
 * 里没有任何颜色。file:// 打开的草稿没有那段 JS，这里把同一批源文件拼成一份纯 CSS：
 *
 *   1. packages/nb-ui/src/tokens.css 的裸 :root（基线 token 与角色映射默认值）
 *   2. packages/nb-ui/themes/nbook/vars.css 的 :root[data-nb-theme="nbook"]（nbook 主题取值）
 *   3. packages/nb-ui/themes/nbook/colorways.ts 的 NBOOK_LIGHT 作缺省、NBOOK_DARK 作暗色
 *   4. vars.css 里按 data-nb-appearance 分档的块：light 并入缺省，dark 改挂 prefers-color-scheme
 *   5. vars.css 与 tokens.css 的无障碍、窄屏媒体查询，原样保持在最后
 *
 * 暗色有两个入口：跟随系统（@media (prefers-color-scheme: dark) 下的 :root:not([data-theme="light"])），
 * 与评审时手动切换（:root[data-theme="dark"]）。另生成 .nb-dark 作用域（完整一套暗色声明），
 * 让终端这类块在浅色页面里也能用暗色；只覆盖配色变量不够，因为 --divider 这类派生变量
 * 在声明处就算好了值，必须连主题层一起重新声明。
 *
 * 用法：在本目录执行 `bun build.ts`。改了 nb-ui 的 token、nbook 主题或配色后重跑即可。
 */
import {readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";

const repo = resolve(import.meta.dir, "../../../../../../..");
const here = import.meta.dir;

const tokensCss = readFileSync(resolve(repo, "packages/nb-ui/src/tokens.css"), "utf8");
const varsCss = readFileSync(resolve(repo, "packages/nb-ui/themes/nbook/vars.css"), "utf8");
const {nbookColorways} = await import(resolve(repo, "packages/nb-ui/themes/nbook/colorways.ts"));

interface Rule {
    media: string | null;
    selector: string;
    body: string;
}

/** 只认本仓库这两份文件的形状：顶层规则与一层 @media 包着的规则；注释先去掉 */
function parse(css: string): Rule[] {
    const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const rules: Rule[] = [];
    const walk = (text: string, media: string | null) => {
        let k = 0;
        while (k < text.length) {
            const open = text.indexOf("{", k);
            if (open < 0) break;
            const head = text.slice(k, open).trim();
            let depth = 0;
            let end = open;
            for (let j = open; j < text.length; j++) {
                if (text[j] === "{") depth++;
                else if (text[j] === "}") {
                    depth--;
                    if (depth === 0) {
                        end = j;
                        break;
                    }
                }
            }
            const inner = text.slice(open + 1, end);
            if (head.startsWith("@media")) walk(inner, head.replace(/^@media\s*/, ""));
            else rules.push({media, selector: head.replace(/\s+/g, " "), body: inner.trim()});
            k = end + 1;
        }
    };
    walk(src, null);
    return rules;
}

type Ctx = "base" | "dark" | "both";

function ctxOf(selector: string): Ctx {
    const parts = selector.split(",").map((s) => s.trim());
    const kinds = new Set(parts.map((p) => (p.includes('data-nb-appearance="dark"') ? "dark" : "base")));
    if (kinds.size === 2) return "both";
    return kinds.has("dark") ? "dark" : "base";
}

function decls(body: string): string {
    return body
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => `    ${d.replace(/\s*\n\s*/g, " ")};`)
        .join("\n");
}

function colorway(vars: Record<string, string>): string {
    return Object.entries(vars)
        .map(([k, v]) => `    ${k}: ${v};`)
        .join("\n");
}

const tokenRules = parse(tokensCss);
const themeRules = parse(varsCss);

const out: string[] = [];
const darkScope: string[] = [];
const push = (comment: string, css: string) => out.push(`/* ${comment} */\n${css}\n`);

out.push(`/*
 * tokens-nbook.css —— 由 build.ts 生成，不要手改。生成时间 ${new Date().toISOString()}。
 * 来源（仓库根相对路径）：
 *   packages/nb-ui/src/tokens.css              基线 token（排版、间距、圆角、层级、动效）与角色映射默认值
 *   packages/nb-ui/themes/nbook/vars.css       nbook 主题：字体、密度、圆角、玻璃、角色映射、阴影、稿面
 *   packages/nb-ui/themes/nbook/colorways.ts   nbook-light（缺省）与 nbook-dark（暗色）两套配色
 * 选择器改写：:root[data-nb-theme="nbook"] → :root；[data-nb-appearance="dark"] → 跟随系统暗色或 [data-theme="dark"]；
 * [data-nb-appearance="light"] → 并入缺省。.nb-dark 是完整暗色作用域（终端块用）。
 */
`);

// 1. tokens.css 的裸 :root（不含媒体查询）
for (const r of tokenRules.filter((r) => !r.media)) {
    push("nb-ui 基线：packages/nb-ui/src/tokens.css", `:root {\n${decls(r.body)}\n}`);
    darkScope.push(decls(r.body));
}

// 2. 配色：缺省亮色
push(
    "配色 nbook-light：packages/nb-ui/themes/nbook/colorways.ts NBOOK_LIGHT",
    `:root {\n${colorway(nbookColorways["nbook-light"])}\n}`,
);

// 3. vars.css 的无媒体规则，按明暗归位
const darkBodies: string[] = [];
for (const r of themeRules.filter((r) => !r.media)) {
    const ctx = ctxOf(r.selector);
    if (ctx === "dark") {
        darkBodies.push(decls(r.body));
        continue;
    }
    const isLight = r.selector.includes('data-nb-appearance="light"');
    push(
        `nbook 主题：packages/nb-ui/themes/nbook/vars.css ${r.selector}${isLight ? "（亮色分档，并入缺省）" : ""}`,
        `:root {\n${decls(r.body)}\n}`,
    );
    if (!isLight) darkScope.push(decls(r.body));
}

// 4. 暗色：配色 + 主题暗色分档，两个入口
const darkAll = [colorway(nbookColorways["nbook-dark"]), ...darkBodies].join("\n");
push(
    "暗色：colorways.ts NBOOK_DARK + vars.css 的 [data-nb-appearance=\"dark\"] 分档；跟随系统",
    `@media (prefers-color-scheme: dark) {\n    :root:not([data-theme="light"]) {\n${darkAll.replace(/^/gm, "    ")}\n    }\n}`,
);
push("暗色：评审时手动切换", `:root[data-theme="dark"] {\n${darkAll}\n}`);
darkScope.push(darkAll);
push(
    "暗色作用域：在浅色页面里局部用暗色（例如终端块）。依次重放基线、主题与暗色",
    `.nb-dark {\n${darkScope.join("\n")}\n    color-scheme: dark;\n    color: var(--text-main);\n}`,
);

// 5. 媒体查询块，保持源文件顺序：先主题，再 tokens.css 的 reduced-motion
const BOTH = ':root, :root:not([data-theme="light"]), :root[data-theme="dark"]';
for (const r of [...themeRules.filter((r) => r.media), ...tokenRules.filter((r) => r.media)]) {
    const ctx = ctxOf(r.selector);
    const body = decls(r.body);
    if (ctx === "both") {
        push(`@media ${r.media}：vars.css ${r.selector.split(",")[0]} 等`, `@media ${r.media} {\n    ${BOTH} {\n${body.replace(/^/gm, "    ")}\n    }\n}`);
    } else if (ctx === "dark") {
        push(
            `@media ${r.media}（暗色）：vars.css`,
            `@media ${r.media} and (prefers-color-scheme: dark) {\n    :root:not([data-theme="light"]) {\n${body.replace(/^/gm, "    ")}\n    }\n}\n@media ${r.media} {\n    :root[data-theme="dark"] {\n${body.replace(/^/gm, "    ")}\n    }\n}`,
        );
    } else {
        push(`@media ${r.media}：${r.selector}`, `@media ${r.media} {\n    :root {\n${body.replace(/^/gm, "    ")}\n    }\n}`);
    }
}

writeFileSync(resolve(here, "tokens-nbook.css"), out.join("\n"));

// ---- 图标：lucide（nb-ui 与应用用的同一套，来自 @iconify-json/lucide）的一小份 sprite ----
const lucide = JSON.parse(readFileSync(resolve(repo, "node_modules/@iconify-json/lucide/icons.json"), "utf8"));
const names = `house inbox list-checks folder-git-2 git-branch git-commit-horizontal git-compare activity presentation
file-text book-open folder search square-terminal terminal external-link check x message-square-text image triangle-alert
circle-alert info circle-check clock refresh-cw chevron-right chevron-down sun moon server bot file-diff code layers hash
copy github eye lightbulb archive link git-merge loader-circle layout-grid circle-dot list pin flag sparkles workflow
file-search folder-open book-marked scroll-text clipboard-check history arrow-right arrow-up-right send circle-help cpu
monitor-play notebook-pen sun-moon plus
message-square bot git-pull-request stamp badge-check keyboard bell list-tree folder-tree file-check flask-conical
file-code shield-check user circle-pause play square panel-left chevrons-up-down git-fork message-circle-question
reply ellipsis pencil check-check timer hourglass arrow-left maximize-2 circle book-text files palette clipboard-list
circle-check-big pen-tool layout-template file-image scroll library list-filter gavel`.split(/\s+/);
const symbols = names
    .map((n) => {
        const icon = lucide.icons[n] ?? lucide.icons[lucide.aliases?.[n]?.parent];
        if (!icon) throw new Error(`lucide icon missing: ${n}`);
        // 去掉写死的线宽，交给 CSS（.ic 上的 stroke-width）按图标尺寸调
        return `<symbol id="i-${n}" viewBox="0 0 24 24">${icon.body.replace(/ stroke-width="2"/g, "")}</symbol>`;
    })
    .join("");
writeFileSync(
    resolve(here, "assets/icons.js"),
    `/* 由 build.ts 生成：lucide 图标（node_modules/@iconify-json/lucide/icons.json）的 sprite，ISC 许可。用法 <svg class="ic"><use href="#i-house"/></svg> */\n` +
        `document.currentScript.insertAdjacentHTML("afterend", ${JSON.stringify(`<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${symbols}</svg>`)});\n`,
);
console.log(`tokens-nbook.css: ${out.length} 段；icons.js: ${names.length} 个图标`);
