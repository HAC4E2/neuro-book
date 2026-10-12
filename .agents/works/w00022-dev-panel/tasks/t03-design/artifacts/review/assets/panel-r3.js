/* 第三轮共用：分组导航（Work › Task 树用真实或推断的状态）、顶栏、明暗、状态与租约的小部件、答复后的通知窗、评审浮条。数据在 data-r3.js。 */
(function () {
    const D = window.PANEL3;
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
    const icon = (name, cls = "") => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

    /* ---- 小部件 ---- */
    const status = (s, inferred) => {
        const m = D.statuses[s];
        return `<span class="st ${s}" title="${inferred ? "没有 status 字段，按正文推断" : "Task 记录里的 status"}">${icon(inferred ? "circle" : m.icon)}${esc(m.label)}${inferred ? '<span class="inf">推断</span>' : ""}</span>`;
    };
    const ephTag = (label = "临时") => `<span class="eph-tag" title="会话结束或租约失效就消失，不入库">${icon("timer")}${esc(label)}</span>`;
    const demo = () => '<span class="badge sm demo">示例</span>';
    const lease = (l, {withTasks = true} = {}) => {
        const ext = l.managed === false;
        const t = withTasks && l.tasks ? ` · ${l.tasks.join("、")}` : "";
        return `<span class="lease${ext ? " ext" : ""}" title="${ext ? "外部会话：能读答复，不能打开终端，也不能被通知" : "面板管理的会话（herdr）"}">${icon(ext ? "bot" : "message-square")}<b>${esc(l.pane || "外部")}</b>${esc(l.pane ? (l.kind === "omp" ? " omp" : " Claude") : " " + l.name)}${esc(t)}${l.expiring ? ` · ${esc(l.expiring)}` : ""}</span>`;
    };
    const sbar = (c, inferred) => {
        const total = c.active + c.planned + c.done + c.shelved || 1;
        const seg = ["active", "planned", "done", "shelved"].filter((k) => c[k]).map((k) => `<i class="${k}" style="flex:${c[k] / total}"></i>`).join("");
        const leg = ["active", "planned", "done", "shelved"].map((k) => `<span><i class="${k}"></i>${D.statuses[k].label} ${c[k]}</span>`).join("");
        return `<div class="sbar${inferred ? " inf" : ""}" title="${inferred ? "按正文推断" : "按 status 字段"}">${seg}</div><div class="slegend">${leg}${inferred ? '<span class="muted">（推断）</span>' : ""}</div>`;
    };
    const qcount = (n, label = "待答") => `<span class="qcount${n ? "" : " zero"}">${icon("message-circle-question")}${label} ${n}</span>`;

    /* ---- 左栏 ---- */
    const link = (it, current) => {
        const cur = it.id === current ? ' aria-current="page"' : "";
        const n = it.badge ? `<span class="n"><span class="badge sm ${it.badge}">${it.n}</span></span>` : it.n != null ? `<span class="n">${esc(it.n)}</span>` : "";
        return `<a href="${it.href || "#"}"${cur}>${icon(it.icon)}<span>${esc(it.label)}</span>${n}</a>`;
    };
    const group = (id, title, body, {closed = false, more = ""} = {}) => `
        <section class="ngroup${closed ? " closed" : ""}" data-group="${id}">
            <button class="ngroup-h" type="button" aria-expanded="${!closed}">${icon("chevron-down")}<span>${esc(title)}</span>${more}</button>
            <div class="ngroup-b">${body}</div>
        </section>`;
    const tree = (current) => {
        const rows = D.works.map((w) => {
            const open = w.id === "w00022" || current === w.id;
            const head = `<div class="trow work" role="treeitem" aria-expanded="${open}" data-work="${w.id}" title="${esc(w.title)}">
                <span class="twist">${icon("chevron-down")}</span><span class="tid">${w.id}</span><span class="tt">${esc(w.title)}</span>
                ${w.questions ? `<span class="badge sm warning" title="待答提问">${w.questions}</span>` : ""}</div>`;
            const kids = (w.tasks || []).map((t) => `<a class="trow task" role="treeitem" href="${w.id === "w00022" ? "work.html#" + t.id : "#"}" title="${esc(D.statuses[t.status].label + (t.statusFrom === "inferred" ? "（推断）" : "") + "：" + (t.now || ""))}">
                <span class="st ${t.status}" style="gap:0">${icon(t.statusFrom === "inferred" ? "circle" : D.statuses[t.status].icon)}</span><span class="tid">${t.id}</span><span class="tt">${esc(t.title)}</span>
                ${t.questions ? `<span class="badge sm warning">${t.questions}</span>` : ""}</a>`).join("");
            const more = w.moreTasks ? `<a class="trow more" href="#">另 ${w.moreTasks} 个</a>` : "";
            return head + `<div class="tkids" role="group">${kids}${more}</div>`;
        }).join("");
        return `<div class="tree" role="tree" aria-label="Work 与 Task">${rows}<a class="trow more" style="padding-left:var(--space-2)" href="#">其余 ${D.otherWorks.count} 个 Work</a></div>`;
    };
    const inboxCount = D.inbox.length;
    const sidebar = (current) => `
        <aside class="sidebar side-nav r2nav">
            <div class="brand side-brand"><span class="brand-mark">NB</span><span>开发面板<br><small>neuro-book · 本机</small></span></div>
            <nav class="nav" aria-label="首页与收件箱">
                ${link({id: "home", icon: "house", label: "首页", href: "home.html"}, current)}
                ${link({id: "inbox", icon: "inbox", label: "收件箱", n: inboxCount, badge: "warning", href: "home.html#inbox"}, current)}
            </nav>
            ${group("work", "工作", tree(current), {more: `<a class="more" href="new.html">${icon("plus", "sm")}新建</a>`})}
            ${group("artifacts", "产物", `<nav class="nav">
                ${link({id: "art-design", icon: "palette", label: "设计稿", href: "../r2/artifacts.html#design"}, current)}
                ${link({id: "art-reports", icon: "scroll-text", label: "讲解与报告", href: "../r2/artifacts.html#reports"}, current)}
                ${link({id: "art-reviews", icon: "clipboard-check", label: "审查报告", href: "../r2/artifacts.html#reviews"}, current)}
            </nav>`, {closed: true})}
            ${group("docs", "文档", `<nav class="nav">${link({id: "docs", icon: "file-check", label: "Spec 与文档", href: "../r2/docs.html"}, current)}</nav>`, {closed: true})}
            ${group("field", "现场", `<nav class="nav">
                ${link({id: "sessions", icon: "message-square", label: "会话", n: `${D.sessions.filter((s) => s.status === "working").length} 在工作 · ${D.sessions.length}`, href: "sessions.html"}, current)}
                ${link({id: "runs", icon: "activity", label: "运行", n: D.sessions.reduce((n, s) => n + s.runs.length, 0), href: "sessions.html#runs"}, current)}
                ${link({id: "code", icon: "git-branch", label: "代码", n: 11, href: "#"}, current)}
                ${link({id: "gh-pr", icon: "git-pull-request", label: "PR", n: 6, href: "../r2/github.html"}, current)}
                ${link({id: "gh-issue", icon: "circle-dot", label: "Issue", n: 82, href: "../r2/github.html#issues"}, current)}
            </nav>`)}
        </aside>`;

    /* ---- 顶栏与明暗 ---- */
    const THEMES = [{id: null, icon: "sun-moon", label: "明暗：跟随系统"}, {id: "light", icon: "sun", label: "明暗：浅色"}, {id: "dark", icon: "moon", label: "明暗：深色"}];
    const readTheme = () => { try { return localStorage.getItem("nbdp-theme"); } catch { return null; } };
    const writeTheme = (t) => { try { t ? localStorage.setItem("nbdp-theme", t) : localStorage.removeItem("nbdp-theme"); } catch { /* 只在本页生效 */ } };
    const applyTheme = (t) => {
        if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
        document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
            const th = THEMES.find((x) => x.id === (t || null)) ?? THEMES[0];
            b.innerHTML = icon(th.icon); b.title = th.label; b.setAttribute("aria-label", th.label);
        });
    };
    const topbar = (placeholder = "搜索 Work、Task、产物、会话") => `
        <header class="topbar">
            <label class="input" style="width:min(520px,100%)">${icon("search")}<input type="search" placeholder="${esc(placeholder)}"><span class="kbd">Ctrl</span><span class="kbd">K</span></label>
            <div class="sp"></div>
            <a class="btn sm secondary" href="new.html">${icon("plus", "sm")}新建 Work</a>
            <span class="muted xs nowrap" title="面板每次打开都现读仓库与 herdr；这里是稿子取数的时间">数据 ${esc(D.snapshot.slice(11))}</span>
            <button class="ibtn" type="button" data-theme-toggle></button>
        </header>`;

    /* ---- 答复后的通知窗：两种情况 ---- */
    const notifyBody = (c) => c.canNotify ? `
        <h3>通知提问的会话？</h3>
        <p>答复已保存（${esc(c.saved)}）。提问者 <span class="mono">${esc(c.pane)}</span>（${esc(c.who)}）的租约还有效，是面板管理的会话，现在<b>${esc(c.state)}</b>。</p>
        <div class="opt" role="radiogroup" aria-label="投递方式">
            <label><input class="chk" type="radio" name="mode-${c.id}" value="followup" checked><span>followup：排在当前这一轮之后<div class="hint">它做完手上这一轮再看答复，不打断。</div></span></label>
            <label><input class="chk" type="radio" name="mode-${c.id}" value="steer"><span>steer：打断当前这一轮<div class="hint">答复会改变它正在做的事时用。</div></span></label>
        </div>
        <div class="xs muted">要发的一行：</div>
        <div class="preview mono">${esc(c.pointer)}</div>
        <div class="acts"><button class="btn secondary" type="button" data-n="skip">不通知</button><button class="btn primary" type="button" data-n="send">通知</button></div>` : `
        <h3>答复已保存，没有可通知的会话</h3>
        <p>${esc(c.reason)}</p>
        <div class="callout info xs">${icon("info")}<div>答复在 <span class="mono">${esc(c.saved)}</span>。下一个在这个 Task 上运行 <span class="mono">nbdev answers</span> 的会话会读到它。</div></div>
        <div class="acts"><button class="btn primary" type="button" data-n="ok">知道了</button></div>`;

    document.addEventListener("click", (e) => {
        const th = e.target.closest("[data-theme-toggle]");
        if (th) {
            const cur = document.documentElement.dataset.theme || null;
            const next = THEMES[(THEMES.findIndex((x) => x.id === cur) + 1) % THEMES.length].id;
            writeTheme(next); applyTheme(next); return;
        }
        const gh = e.target.closest(".ngroup-h");
        if (gh && !e.target.closest("a")) {
            const g = gh.closest(".ngroup"); g.classList.toggle("closed");
            gh.setAttribute("aria-expanded", String(!g.classList.contains("closed"))); return;
        }
        const wr = e.target.closest(".trow.work");
        if (wr) { wr.setAttribute("aria-expanded", String(wr.getAttribute("aria-expanded") !== "true")); }
    });
    document.addEventListener("DOMContentLoaded", () => applyTheme(readTheme()));

    const dock = (inner) => {
        const el = document.createElement("div");
        el.className = "review-dock";
        el.innerHTML = `<b>评审稿 r3</b>${inner}<a class="btn sm ghost" href="../index.html#r3">${icon("arrow-right", "sm")}评审板</a>`;
        if (window.self === window.top) document.body.appendChild(el);
        return el;
    };

    window.NB3 = {D, esc, icon, status, ephTag, demo, lease, sbar, qcount, sidebar, topbar, notifyBody, dock};
})();
