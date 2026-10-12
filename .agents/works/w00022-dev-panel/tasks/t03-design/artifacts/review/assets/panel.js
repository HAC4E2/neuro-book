/* 稿子共用的一点脚本：图标、导航、明暗切换、评审浮条。数据在 data.js。 */
(function () {
    const D = window.PANEL;

    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
    const icon = (name, cls = "") => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

    /* 导航入口（第一版提议）：先“要我做的事”，再“东西在哪”，最后“读的材料” */
    const NAV = [
        {id: "home", icon: "house", label: "首页", href: "home.html"},
        {id: "inbox", icon: "inbox", label: "等你处理", n: D.inbox.length, href: "home.html#inbox", strong: true},
        null,
        {id: "task", icon: "list-checks", label: "Task", n: D.counts.tasksActive, href: "task.html", hint: "进行中"},
        {id: "work", icon: "layers", label: "Work", n: D.counts.works, href: "#"},
        {id: "checkout", icon: "git-branch", label: "Checkout", n: D.counts.checkouts, href: "#"},
        {id: "run", icon: "activity", label: "在跑", n: D.counts.running, href: "home.html#running"},
        null,
        {id: "page", icon: "presentation", label: "讲解页", n: D.counts.pages, href: "kit.html"},
        {id: "docs", icon: "book-open", label: "文档", href: "#", hint: "Spec、Proposal、规范"},
        {id: "local", icon: "folder-open", label: "本地文件", href: "#", hint: ".local/agent"},
    ];
    const NAV_FOOT = [
        {id: "cli", icon: "square-terminal", label: "命令行", href: "cli.html"},
        {id: "gh", icon: "github", label: "GitHub", disabled: true, hint: "第二版"},
    ];

    const navItem = (it, current, withCount = true) => {
        if (!it) return `<div class="nav-sep" role="separator"></div>`;
        const cur = it.id === current ? ' aria-current="page"' : "";
        const dis = it.disabled ? ' aria-disabled="true" tabindex="-1"' : "";
        const n = it.disabled
            ? `<span class="n">${esc(it.hint)}</span>`
            : withCount && it.n != null
                ? it.strong ? `<span class="n"><span class="badge sm warning">${it.n}</span></span>` : `<span class="n">${it.n}</span>`
                : "";
        const title = it.hint && !it.disabled ? ` title="${esc(it.hint)}"` : "";
        return `<a href="${it.disabled ? "#" : it.href}"${cur}${dis}${title}>${icon(it.icon)}<span>${esc(it.label)}</span>${n}</a>`;
    };

    const sidebar = (current) => `
        <aside class="sidebar side-nav">
            <div class="brand side-brand"><span class="brand-mark">NB</span><span>开发面板<br><small>neuro-book · 本机</small></span></div>
            <nav class="nav" aria-label="面板导航">${NAV.map((it) => navItem(it, current)).join("")}</nav>
            <div class="sp"></div>
            <nav class="nav" aria-label="其它">${NAV_FOOT.map((it) => navItem(it, current)).join("")}</nav>
        </aside>`;

    const tabs = (current) => `
        <nav class="tabs" aria-label="面板导航">${NAV.filter(Boolean).filter((it) => it.id !== "inbox").map((it) => {
            const cur = it.id === current ? ' aria-current="page"' : "";
            const n = it.n != null ? ` <span class="n">${it.n}</span>` : "";
            return `<a href="${it.href}"${cur}>${esc(it.label)}${n}</a>`;
        }).join("")}</nav>`;

    const THEMES = [
        {id: null, icon: "sun-moon", label: "明暗：跟随系统"},
        {id: "light", icon: "sun", label: "明暗：浅色"},
        {id: "dark", icon: "moon", label: "明暗：深色"},
    ];
    const readTheme = () => {
        try { return localStorage.getItem("nbdp-theme"); } catch { return null; }
    };
    const writeTheme = (t) => {
        try { t ? localStorage.setItem("nbdp-theme", t) : localStorage.removeItem("nbdp-theme"); } catch { /* 无痕窗口等：只在本页生效 */ }
    };
    const applyTheme = (t) => {
        if (t) document.documentElement.dataset.theme = t;
        else delete document.documentElement.dataset.theme;
        document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
            const th = THEMES.find((x) => x.id === (t || null)) ?? THEMES[0];
            b.innerHTML = icon(th.icon);
            b.title = th.label;
            b.setAttribute("aria-label", th.label);
        });
    };
    const themeButton = () => `<button class="ibtn" type="button" data-theme-toggle></button>`;
    const topRight = () => `
        <span class="muted xs nowrap" title="面板每次打开都现读 Git 与文件系统；这里是稿子取数的时间">数据 ${esc(D.snapshot.slice(11))}</span>
        <button class="ibtn" type="button" title="重新读取" aria-label="重新读取">${icon("refresh-cw")}</button>
        ${themeButton()}`;

    document.addEventListener("click", (e) => {
        const b = e.target.closest("[data-theme-toggle]");
        if (!b) return;
        const cur = document.documentElement.dataset.theme || null;
        const next = THEMES[(THEMES.findIndex((x) => x.id === cur) + 1) % THEMES.length].id;
        writeTheme(next);
        applyTheme(next);
    });
    document.addEventListener("DOMContentLoaded", () => applyTheme(readTheme()));

    /* 评审浮条：只在稿子里有，标出这是第几轮、能切哪些候选 */
    const dock = (inner) => {
        const el = document.createElement("div");
        el.className = "review-dock";
        el.innerHTML = `<b>评审稿 r1</b>${inner}<a class="btn sm ghost" href="../index.html">${icon("arrow-right", "sm")}评审板</a>`;
        // 评审板用 iframe 预览各页时不显示浮条
        if (window.self === window.top) document.body.appendChild(el);
        return el;
    };

    window.NB = {D, esc, icon, sidebar, tabs, topRight, themeButton, dock};
})();
