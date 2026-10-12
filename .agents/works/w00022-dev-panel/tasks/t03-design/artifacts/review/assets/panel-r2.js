/* 第二轮共用：分组导航（含 Work › Task 树）、顶栏、明暗切换、通知会话的确认小窗、评审浮条。数据在 data-r2*.js。 */
(function () {
    const S = window.PANEL2;
    const W = window.PANEL2W;

    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
    const icon = (name, cls = "") => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
    const statusOf = (id) => W.statusRules.find((r) => r.id === id) ?? {label: "", tone: ""};

    const sessionsHere = S.sessions.filter((s) => !s.otherRepo);
    const counts = {
        inbox: W.inbox.length,
        sessions: S.sessions.length,
        working: S.sessions.filter((s) => s.status === "working").length,
        running: 5,
        checkouts: 11,
        design: W.artifacts.design.length,
        reports: W.artifacts.reports.length,
        reviews: W.artifacts.reviews.length,
        evidence: W.artifacts.evidence.length,
    };
    void sessionsHere;

    const link = (it, current) => {
        const cur = it.id === current ? ' aria-current="page"' : "";
        const n = it.badge ? `<span class="n"><span class="badge sm ${it.badge}">${it.n}</span></span>` : it.n != null ? `<span class="n">${esc(it.n)}</span>` : "";
        return `<a href="${it.href || "#"}"${cur}${it.hint ? ` title="${esc(it.hint)}"` : ""}>${icon(it.icon)}<span>${esc(it.label)}</span>${n}</a>`;
    };

    const group = (id, title, body, {closed = false, more = ""} = {}) => `
        <section class="ngroup${closed ? " closed" : ""}" data-group="${id}">
            <button class="ngroup-h" type="button" aria-expanded="${!closed}">${icon("chevron-down")}<span>${esc(title)}</span>${more}</button>
            <div class="ngroup-b">${body}</div>
        </section>`;

    const tree = (current) => {
        const rows = W.works.map((w) => {
            const expanded = !!w.open;
            const head = `<div class="trow work" role="treeitem" aria-expanded="${expanded}" data-work="${w.id}" title="${esc(w.title)}">
                <span class="twist">${icon("chevron-down")}</span><span class="tid">${w.id}</span><span class="tt">${esc(w.title)}</span>
                ${w.status ? `<span class="sdot ${w.status}" title="${esc(statusOf(w.status).label + "：" + (w.note || ""))}"></span>` : `<span class="tn">${w.taskCount}</span>`}</div>`;
            const kids = (w.tasks || []).map((t) => {
                const st = statusOf(t.status);
                const cur = current === `${w.id}/${t.id}` ? ' aria-current="page"' : "";
                return `<a class="trow task" role="treeitem" href="${t.id === "t80" && w.id === "w00017" ? "../r1/task.html" : "#"}"${cur} title="${esc(`${st.label}（近似）：${t.note}`)}">
                    <span class="sdot ${t.status}"></span><span class="tid">${t.id}</span><span class="tt">${esc(t.title)}</span>
                    ${t.status === "wait" ? '<span class="badge sm warning">等你</span>' : ""}</a>`;
            }).join("");
            const more = w.more ? `<a class="trow more" href="#">更早的 ${w.more} 个</a>` : "";
            return head + (w.tasks ? `<div class="tkids" role="group">${kids}${more}</div>` : "");
        }).join("");
        const legend = W.statusRules.filter((r) => r.id !== "idle").map((r) => `<span title="${esc(r.rule)}"><span class="sdot ${r.id}"></span>${esc(r.label)}</span>`).join("");
        return `<div class="tree" role="tree" aria-label="Work 与 Task">${rows}</div><div class="tree-legend">${legend}<span>（近似）</span></div>`;
    };

    const sidebar = (current, {open = []} = {}) => `
        <aside class="sidebar side-nav r2nav">
            <div class="brand side-brand"><span class="brand-mark">NB</span><span>开发面板<br><small>neuro-book · 本机</small></span></div>
            <nav class="nav" aria-label="首页与收件箱">
                ${link({id: "home", icon: "house", label: "首页", href: "home.html"}, current)}
                ${link({id: "inbox", icon: "inbox", label: "收件箱", n: counts.inbox, badge: "warning", href: "home.html#inbox", hint: "只放要你动手的条目"}, current)}
            </nav>
            ${group("work", "工作", tree(current), {more: `<a class="more" href="#">全部 ${W.worksTotal}</a>`})}
            ${group("artifacts", "产物", `<nav class="nav">
                ${link({id: "art-design", icon: "palette", label: "设计稿", n: counts.design, href: "artifacts.html#design"}, current)}
                ${link({id: "art-reports", icon: "scroll-text", label: "讲解与报告", n: counts.reports, href: "artifacts.html#reports"}, current)}
                ${link({id: "art-reviews", icon: "clipboard-check", label: "审查", n: counts.reviews, href: "artifacts.html#reviews"}, current)}
                ${link({id: "art-evidence", icon: "flask-conical", label: "证据", n: counts.evidence, href: "artifacts.html#evidence"}, current)}
            </nav>`, {closed: !open.includes("artifacts") && current?.startsWith?.("doc")})}
            ${group("docs", "文档", `<nav class="nav">
                ${link({id: "doc-spec", icon: "file-check", label: "Spec", n: 35, href: "docs.html"}, current)}
                ${link({id: "doc-adr", icon: "gavel", label: "ADR", n: 71, href: "docs.html#adr"}, current)}
                ${link({id: "doc-proposal", icon: "lightbulb", label: "Proposal", n: 6, href: "docs.html#proposal"}, current)}
                ${link({id: "doc-std", icon: "book-text", label: "规范与测试规范", n: 36, href: "docs.html#std"}, current)}
                ${link({id: "doc-skill", icon: "sparkles", label: "Skill", n: 8, href: "docs.html#skill"}, current)}
                ${link({id: "doc-agents", icon: "bot", label: "AGENTS", n: 26, href: "docs.html#agents"}, current)}
                ${link({id: "doc-user", icon: "library", label: "用户文档", n: 102, href: "docs.html#user"}, current)}
            </nav>`, {closed: !(current || "").startsWith("doc") && !open.includes("docs")})}
            ${group("field", "现场", `<nav class="nav">
                ${link({id: "sessions", icon: "message-square", label: "会话", n: `${counts.working} 在工作 · ${counts.sessions}`, href: "sessions.html"}, current)}
                ${link({id: "running", icon: "activity", label: "在跑", n: counts.running, href: "#"}, current)}
                ${link({id: "code", icon: "git-branch", label: "代码", n: counts.checkouts, href: "#", hint: "checkout、分支、提交"}, current)}
                ${link({id: "gh-pr", icon: "git-pull-request", label: "PR", n: S.prOpen, href: "github.html"}, current)}
                ${link({id: "gh-issue", icon: "circle-dot", label: "Issue", n: S.issueTotal, href: "github.html#issues"}, current)}
            </nav>`)}
        </aside>`;

    /* 明暗：跟随系统、浅、深 */
    const THEMES = [{id: null, icon: "sun-moon", label: "明暗：跟随系统"}, {id: "light", icon: "sun", label: "明暗：浅色"}, {id: "dark", icon: "moon", label: "明暗：深色"}];
    const readTheme = () => { try { return localStorage.getItem("nbdp-theme"); } catch { return null; } };
    const writeTheme = (t) => { try { t ? localStorage.setItem("nbdp-theme", t) : localStorage.removeItem("nbdp-theme"); } catch { /* 只在本页生效 */ } };
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

    const topbar = (placeholder = "搜索 Task、产物、文档、会话、提交") => `
        <header class="topbar">
            <label class="input" style="width:min(560px,100%)">${icon("search")}<input type="search" placeholder="${esc(placeholder)}"><span class="kbd">Ctrl</span><span class="kbd">K</span></label>
            <div class="sp"></div>
            <span class="muted xs nowrap" title="面板每次打开都现读 Git、文件系统与 herdr；这里是稿子取数的时间">数据 ${esc(S.snapshot.slice(11))}</span>
            <button class="ibtn" type="button" title="重新读取" aria-label="重新读取">${icon("refresh-cw")}</button>
            <button class="ibtn" type="button" data-theme-toggle></button>
        </header>`;

    /* 通知会话的确认小窗：开发者在面板上提交答案之后弹出 */
    const notifyDialog = () => `
        <div class="dlg-scrim" id="notify" data-open="false" role="presentation">
            <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="notify-title">
                <h3 id="notify-title">通知会话 w1:p16？</h3>
                <p>答案已记下（只追加，写在 <code>answers/spec-promotion/</code>）。问这个问题的是 Claude 会话 <span class="mono">d02974de</span>（pane <span class="mono">w1:p16</span>，现在在做 w00022 t03）；面板经 herdr 把下面这段发给它：</p>
                <div class="preview" id="notify-preview"></div>
                <div class="opt" role="radiogroup" aria-label="什么时候发">
                    <label><input class="chk" type="radio" name="when" value="idle" checked><span>它空闲时再发<div class="hint">它正在工作。面板排队，等 herdr 报告它空闲后再发。</div></span></label>
                    <label><input class="chk" type="radio" name="when" value="now"><span>现在就发<div class="hint">发进正在工作的会话；Claude Code 会排在这一轮后面。</div></span></label>
                </div>
                <div class="acts">
                    <button class="btn secondary" type="button" data-notify="skip">不通知</button>
                    <button class="btn primary" type="button" data-notify="send">通知</button>
                </div>
            </div>
        </div>
        <div class="toast" id="toast" role="status" aria-live="polite">${icon("circle-check")}<div id="toast-text"></div></div>`;

    const openNotify = (preview) => {
        document.getElementById("notify-preview").textContent = preview;
        const scrim = document.getElementById("notify");
        scrim.dataset.open = "true";
        scrim.querySelector("[data-notify=send]").focus();
    };
    const toast = (text) => {
        const t = document.getElementById("toast");
        document.getElementById("toast-text").textContent = text;
        t.dataset.open = "true";
        clearTimeout(toast.timer);
        toast.timer = setTimeout(() => (t.dataset.open = "false"), 5200);
    };

    document.addEventListener("click", (e) => {
        const th = e.target.closest("[data-theme-toggle]");
        if (th) {
            const cur = document.documentElement.dataset.theme || null;
            const next = THEMES[(THEMES.findIndex((x) => x.id === cur) + 1) % THEMES.length].id;
            writeTheme(next);
            applyTheme(next);
            return;
        }
        const gh = e.target.closest(".ngroup-h");
        if (gh && !e.target.closest("a")) {
            const g = gh.closest(".ngroup");
            g.classList.toggle("closed");
            gh.setAttribute("aria-expanded", String(!g.classList.contains("closed")));
            return;
        }
        const wr = e.target.closest(".trow.work");
        if (wr) {
            wr.setAttribute("aria-expanded", String(wr.getAttribute("aria-expanded") !== "true"));
            return;
        }
        const n = e.target.closest("[data-notify]");
        if (n) {
            const scrim = document.getElementById("notify");
            scrim.dataset.open = "false";
            const when = scrim.querySelector("input[name=when]:checked").value;
            toast(n.dataset.notify === "skip"
                ? "没有通知会话。答案已记下，会话下次读答案时会看到。"
                : when === "idle" ? "已排队：w1:p16 空闲时发出（本稿不真的发送）。" : "已发给 w1:p16（本稿不真的发送）。");
        }
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            const scrim = document.getElementById("notify");
            if (scrim && scrim.dataset.open === "true") scrim.dataset.open = "false";
        }
    });
    document.addEventListener("DOMContentLoaded", () => applyTheme(readTheme()));

    const dock = (inner) => {
        const el = document.createElement("div");
        el.className = "review-dock";
        el.innerHTML = `<b>评审稿 r2</b>${inner}<a class="btn sm ghost" href="../index.html#r2">${icon("arrow-right", "sm")}评审板</a>`;
        if (window.self === window.top) document.body.appendChild(el);
        return el;
    };

    window.NB2 = {S, W, esc, icon, statusOf, sidebar, topbar, notifyDialog, openNotify, toast, dock, counts};
})();
