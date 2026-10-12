/*
 * 第二轮的工作、收件箱、产物、文档数据：2026-10-12 16:01（BST）现读。
 * 来源：git worktree list、rev-list、status、log --all；各 checkout 里 .agents/works 下的 README 与 Task 表；
 * .local/agent 下的评审板、报告、日志与截图；ps 与 /proc；herdr（见 data-r2.js）。demo:true 的是“示例”。
 * Task 状态是近似值，规则见 STATUS_RULES，不解析 README 里的文字。
 */
window.PANEL2W = {
    /* Task 状态近似值：按 Git、进程、会话与收件箱推断 */
    statusRules: [
        {id: "wait", label: "等你", tone: "warning", rule: "收件箱里有指向它的条目"},
        {id: "run", label: "在跑", tone: "info", rule: "有会话在工作，或有进程的工作目录在它的 checkout 里"},
        {id: "active", label: "有动静", tone: "accent", rule: "7 天内有提交或未提交改动"},
        {id: "merge", label: "待合入", tone: "success", rule: "分支领先基线、没有未提交改动、7 天内没有新提交以外的动静"},
        {id: "new", label: "新建", tone: "", rule: "README 还没提交，或只在 Work 表里登记"},
        {id: "idle", label: "停了", tone: "", rule: "7 天以上没有动静"},
    ],

    works: [
        {
            id: "w00017", title: "应用运行时与内置插件架构", kind: "repo", taskCount: 81, open: true,
            where: "refactor/w00017-runtime-foundation", sessions: 1,
            tasks: [
                {id: "t83", title: "拖放与标题栏对照旧应用", status: "new", note: "README 未提交（15:12）"},
                {id: "t82", title: "底部面板的拖动手势", status: "new", note: "README 未提交（15:12）"},
                {id: "t81", title: "nb-ui 字号写法与分段控件截断", status: "merge", note: "t81/nb-ui-fixes 领先主线 5"},
                {id: "t80", title: "设置界面", status: "wait", note: "Spec 晋升等你批准", href: "#t80"},
                {id: "t79", title: "工作台打磨", status: "run", note: "会话 w1:p2 在工作，omp 审查在跑"},
                {id: "t78", title: "清空 Lab 版面基线", status: "active", note: "今天 11:14 提交"},
                {id: "t77", title: "书架打磨二", status: "active", note: "今天 05:21 提交"},
            ],
            more: 74,
        },
        {
            id: "w00022", title: "开发者项目面板与本地／入库边界", kind: "repo", taskCount: 4, open: true,
            where: "主工作区（纯规划）", sessions: 1,
            tasks: [
                {id: "t04", title: "已确认的规则跟进", status: "new", note: "只在 Work 表登记，没有目录"},
                {id: "t03", title: "面板与命令行的设计", status: "wait", note: "第二轮静态稿等你看；会话 w1:p16 在工作"},
                {id: "t02", title: "本地与入库的规则", status: "active", note: "13:30 提交"},
                {id: "t01", title: "需求分析与功能分析", status: "active", note: "15:56 提交"},
            ],
        },
        {id: "w00005", title: "小说理解 Spike", kind: "repo", taskCount: 3, status: "run", note: "抽取在跑 71 / 100 章"},
        {id: "w00019", title: "Agent 对话视图", kind: "repo", taskCount: 9, status: "wait", note: "会话 w1:pB 在等你"},
        {id: "w00021", title: "智能输入法 Spike", kind: "repo", taskCount: 2, status: "active", note: "未提交 83"},
        {id: "w00002", title: "NeuroAgentHarness 重构", kind: "repo", taskCount: 6, status: "active", note: "昨天 18:58 提交"},
    ],
    worksTotal: 22,

    /* 收件箱：只放要开发者动手的条目，每条指向下面某一类 */
    inbox: [
        {
            type: "approve", typeLabel: "批准", icon: "badge-check", work: "w00017", task: "t80",
            title: "settings.window 晋升为 implemented？",
            summary: "S5 已补“实现合同”与三行证据，注册表标“待晋升”，status 仍是 planned。15:55 记下：晋升暂缓，经面板决定。",
            at: "15:55", target: "文档 › Spec › settings/settings-window.md", targetHref: "docs.html",
            actions: [["批准", "primary", "artifacts.html#answer"], ["暂缓", "secondary", "#"]],
        },
        {
            type: "question", typeLabel: "问题", icon: "message-circle-question", work: "w00022", task: "t03",
            title: "第二轮静态稿：6 个待定",
            summary: "首页、会话页、通知小窗、产物页、文档页、GitHub 页各有一个要你定的问题。",
            at: "刚发布", target: "产物 › 设计稿 › 面板评审板", targetHref: "../index.html",
            actions: [["去回答", "secondary", "../index.html"]],
        },
        {
            type: "session", typeLabel: "会话在等你", icon: "message-square", work: "w00019", task: "t09", pane: "w1:pB",
            title: "输入框：确认后做第 3 步",
            summary: "会话最后一句“确认后做第 3 步：历史消息就地编辑。”它的输入框里有一句你没发出去的话。",
            at: "空闲", target: "现场 › 会话 › w1:pB", targetHref: "sessions.html#w1:pB",
            actions: [["打开会话", "secondary", "sessions.html#w1:pB"]], inferred: true,
        },
        {
            type: "session", typeLabel: "会话在等你", icon: "message-square", work: null, task: null, pane: "w1:pC",
            title: "NeuroBook logo 设计：接入时还要定 3 条",
            summary: "何时切、放在哪、文案里的对象。这个会话不属于任何 Work（在用户区 .local/agent-thinking）。",
            at: "空闲", target: "现场 › 会话 › w1:pC", targetHref: "sessions.html#w1:pC",
            actions: [["打开会话", "secondary", "sessions.html#w1:pC"]], inferred: true,
        },
        {
            type: "session", typeLabel: "会话在等你", icon: "message-square", work: null, task: null, pane: "w1:pV",
            title: "omp：系统依赖升级“升完叫我”",
            summary: "工作目录 /tmp，不属于本仓库；等你手动跑完 pacman 再回它一句。",
            at: "空闲", target: "现场 › 会话 › w1:pV", targetHref: "sessions.html#w1:pV",
            actions: [["打开会话", "secondary", "sessions.html#w1:pV"]], inferred: true, outside: true,
        },
        {
            type: "review", typeLabel: "审查", icon: "clipboard-check", work: "w00017", task: "t79", demo: true,
            title: "t79 omp 实现审查",
            summary: "审查在跑（2:24 / 3h），报告还没有条目；出第一条后，没处理的条目逐条进这里。",
            at: "13:37 开始", target: "产物 › 审查 › t79 omp 实现审查", targetHref: "artifacts.html",
            actions: [["逐条看", "secondary", "artifacts.html"]],
        },
        {
            type: "approve", typeLabel: "批准", icon: "badge-check", work: null, task: null, demo: true,
            title: "回写建议：omp 审查目录写进全局规则",
            summary: "已确认 omp 会话目录放 .local/agent/…/reports/，待 t04 改 ~/.agent/AGENTS.md 里那句。",
            at: "—", target: "工作 › w00022 › t04", targetHref: "#",
            actions: [["批准", "secondary", "#"], ["驳回", "ghost", "#"]],
        },
    ],

    /* 进行中的 Task（按最后动静） */
    tasks: [
        {work: "w00017", task: "t79", title: "工作台打磨：打开项目之后的那一页", status: "run",
            checkout: ".worktree/w00017-runtime-foundation", branch: "refactor/w00017-runtime-foundation", base: "master", ahead: 397, behind: 11, dirty: 14, untracked: 12,
            last: "15:58（草稿图）", sessions: ["w1:p2"], running: ["omp 审查 2:24", "开发服务 :4317"]},
        {work: "w00022", task: "t03", title: "面板与命令行的设计", status: "wait",
            checkout: "主工作区", branch: "master", base: "origin/master", ahead: 0, behind: 0, dirty: null,
            last: "15:59", sessions: ["w1:p16"], running: []},
        {work: "w00017", task: "t80", title: "设置界面：nbook.settings 的界面与贡献点", status: "wait",
            checkout: ".worktree/w00017-t80-settings-ui", branch: "t80/settings-ui", base: "w00017 主线", ahead: 15, behind: 4, dirty: 0,
            last: "15:55", sessions: [], running: [], inbox: 1},
        {work: "w00005", task: "t34", title: "V9 图在 100 章上和全读比", status: "run",
            checkout: ".worktree/w00005-novel-understanding-spike", branch: "feat/w00005-v6-ingest-viewer", base: "master", ahead: 19, behind: 452, dirty: 68, untracked: 52,
            last: "运行产物 16:00", sessions: ["w1:pK"], running: ["抽取 71 / 100 章"]},
        {work: "w00019", task: "t09", title: "Agent 对话视图：输入框", status: "wait",
            checkout: "主工作区（未提交）", branch: "master", base: "origin/master", ahead: 0, behind: 0, dirty: 121,
            last: "10-02（文件）", sessions: ["w1:pB"], running: []},
        {work: "w00017", task: "t81", title: "nb-ui：字号写法与分段控件截断", status: "merge",
            checkout: ".worktree/w00017-t81-nb-ui", branch: "t81/nb-ui-fixes", base: "w00017 主线", ahead: 5, behind: 2, dirty: 0,
            last: "13:30", sessions: [], running: []},
        {work: "w00002", task: "t19", title: "nb-harness 易用性与渐进式示例", status: "active",
            checkout: ".worktree/w00002-neuro-agent-harness-redesign", branch: "feat/w00002-harness-kernel", base: "master", ahead: 407, behind: 10, dirty: 0,
            last: "昨天 18:58", sessions: ["w1:pR"], running: []},
    ],

    changes: [
        {t: "16:00", kind: "file", text: "抽取产物 context-after-ch071.md", task: "w00005 t34"},
        {t: "15:59", kind: "commit", hash: "3b950e55", ref: "master", text: "docs(w00022): 面板只做 herdr 的网页前端、内容分类与导航", task: "w00022 t03"},
        {t: "15:58", kind: "file", text: "t79 草稿 draft10-lockup.png（evidences/，未提交）", task: "w00017 t79"},
        {t: "15:56", kind: "commit", hash: "5959ba77", ref: "master", text: "docs(w00022): 首页选 B、Work 与 Task 层级导航、GitHub 入口", task: "w00022 t01"},
        {t: "15:55", kind: "commit", hash: "12990764", ref: "t80/settings-ui", text: "docs(t80): Spec 晋升暂缓，作为面板的第一个验证对象", task: "w00017 t80"},
        {t: "15:46", kind: "commit", hash: "5bc8fbda", ref: "t80/settings-ui", text: "fix(t80): S5 按审查修正关窗期间迟到的 page 加载结果", task: "w00017 t80"},
        {t: "15:21", kind: "file", text: "t80 变异检查日志 logs/mutations（38 单元 + 5 e2e）", task: "w00017 t80"},
        {t: "15:12", kind: "file", text: "w00017 新建 t82、t83（README 未提交）", task: "w00017"},
        {t: "14:44", kind: "report", text: "t80 omp 审查报告补完总结（1 条，重要 1）", task: "w00017 t80"},
        {t: "14:00", kind: "commit", hash: "8d47a66a", ref: "master", text: "docs(w00022): t03 第一轮静态稿完成", task: "w00022 t03"},
        {t: "13:55", kind: "commit", hash: "09e21502", ref: "master", text: "docs(w00022): 需求补充分析", task: "w00022 t01"},
        {t: "13:37", kind: "run", text: "c38df555 起了 t79 omp 实现审查（/tmp 下的 worktree）", task: "w00017 t79"},
    ],

    /* 产物：Agent 交来、给开发者看的 */
    artifacts: {
        design: [
            {id: "t80-board", title: "t80 设置界面评审板", work: "w00017", task: "t80", at: "08:58", open: 0, answered: 8,
                meta: "4 轮 · 8 节全部已定 · 12 MB", where: "本地 review/", href: "#view"},
            {id: "t03-board", title: "开发面板评审板（第一轮、第二轮）", work: "w00022", task: "t03", at: "刚发布", open: 6, answered: 3,
                meta: "r1 4 页、r2 5 页 · HTML", where: "本地 review/", href: "../index.html"},
            {id: "t79-drafts", title: "t79 工作台静态稿（draft1–10、s6）", work: "w00017", task: "t79", at: "15:58", open: null, answered: null,
                meta: "28 张 PNG · 3.6 MB；问题都在会话里问、在会话里答", where: "evidences/（入库目录，10 张未提交）", warn: "按新规则应放 .local"},
        ],
        reports: [
            {id: "supplement", title: "需求补充分析", work: "w00022", task: "t01", at: "13:55", open: 0, meta: "数据模型、多 Agent 并发、回复通道、命令行合同……", where: "入库 analysis-supplement.md"},
            {id: "requirements", title: "需求分析与功能分析", work: "w00022", task: "t01", at: "15:56", open: 0, meta: "第九节：范围扩大到会话托管与局域网", where: "入库 requirements.md"},
            {id: "platform-review", title: "平台回顾（2026-09-30）", work: "w00017", task: null, at: "09-30", open: 0, meta: "Work 级，不属于任何 Task", where: "本地 works/w00017…/review/"},
            {id: "herdr-research", title: "会话托管调研（面板只做 herdr 前端）", work: "w00022", task: "t03", at: "进行中", open: null, meta: "子代理在做，还没有落盘", where: "—", pending: true},
        ],
        reviews: [
            {id: "t80-omp", title: "t80 omp 实现审查", work: "w00017", task: "t80", at: "14:44", open: 0,
                meta: "1 条（重要 1），已修 5bc8fbda；未覆盖：全量 e2e、手机宽度、WebKit", where: "本地 reports/omp-review-1/"},
            {id: "t79-omp", title: "t79 omp 实现审查", work: "w00017", task: "t79", at: "在跑 2:24 / 3h", open: 0,
                meta: "报告还没有条目", where: "会话 c38df555 的临时目录", warn: "按新规则应放 .local/agent/…/reports/", running: true},
        ],
        evidence: [
            {id: "t80-shots", title: "t80 截图 s2–s4", work: "w00017", task: "t80", at: "11:42", meta: "305 张 · 17 MB · lab:shot 检查 0 条（s2 iter1 15 条）", where: "本地 shots/"},
            {id: "t80-e2e", title: "t80 测试与 e2e 日志", work: "w00017", task: "t80", at: "15:43", meta: "34 个 · 全量 e2e 两轮各 170 通过", where: "本地 logs/"},
            {id: "t80-mutations", title: "t80 变异表", work: "w00017", task: "t80", at: "15:21", meta: "38 处单元 + 5 处 e2e 与门禁，每处都有测试失败", where: "本地 logs/mutations/"},
            {id: "t81-shots", title: "t81 改前改后截图", work: "w00017", task: "t81", at: "12:11", meta: "299 张 · 67 MB", where: "本地 shots/"},
            {id: "t34-run", title: "t34 抽取运行", work: "w00005", task: "t34", at: "16:00", meta: "71 / 100 章，在跑", where: "evidences/run-med-100（入库目录）", warn: "日志写在入库目录", running: true},
        ],
    },

    /* 文档：按类型；Spec 按 checkout 不同 */
    docs: {
        checkouts: [
            {id: "master", label: "master", note: "默认"},
            {id: "w17", label: "refactor/w00017-runtime-foundation", note: "w00017 主线"},
            {id: "t80", label: "t80/settings-ui", note: "t80"},
            {id: "t81", label: "t81/nb-ui-fixes", note: "t81"},
        ],
        specs: {
            master: {agent: ["asset-install-runtime", "session-abort", "session-store-lease"], media: ["image-variants"], platform: ["files", "sqlite"],
                runtime: ["api-docs", "application", "browser-host", "diagnostics", "lifecycle", "plugin-api", "plugin-channel", "plugin-code-loading", "plugin-hot-plug", "plugin-install", "plugin-manifest", "plugins", "server-host", "services", "stall-watchdog"],
                storage: ["boundaries", "persistence"], theme: ["system"],
                ui: ["agent-conversation-view", "agent-profile-settings", "component-lab-timeline", "component-lab", "model-role-selection", "nested-grid", "workbench-shell"],
                workbench: ["commands", "files-explorer", "quick-open"], workspace: ["files"]},
            t80: {platform: ["files", "sqlite"],
                runtime: ["api-docs", "application", "browser-host", "diagnostics", "glossary", "lifecycle", "plugin-api", "plugin-channel", "plugin-code-loading", "plugin-hot-plug", "plugin-install", "plugin-manifest", "plugins", "projects", "server-host", "services", "stall-watchdog"],
                settings: ["configuration", "settings-window"], state: ["public-state", "store"], storage: ["boundaries", "persistence"], theme: ["system"],
                ui: ["component-lab-timeline", "component-lab", "nested-grid", "workbench-shell"],
                workbench: ["bookshelf", "commands", "editor", "files-explorer", "notifications", "quick-open", "views"], workspace: ["files", "folder-kinds", "resources"]},
        },
        /* git diff --name-status master t80/settings-ui -- docs/specs */
        diffVsMaster: {
            added: ["runtime/glossary", "runtime/projects", "settings/configuration", "settings/settings-window", "state/public-state", "state/store", "workbench/bookshelf", "workbench/editor", "workbench/notifications", "workbench/views", "workspace/folder-kinds", "workspace/resources"],
            deleted: ["agent/asset-install-runtime", "agent/session-abort", "agent/session-store-lease", "media/image-variants", "ui/agent-conversation-view", "ui/agent-profile-settings", "ui/model-role-selection"],
            modifiedCount: 30,
        },
        others: [
            {type: "ADR", count: 71, note: "master 只有各包 docs/adr；w00017 系分支另有 docs/adr（0022 起）"},
            {type: "Proposal", count: 6, note: "master 6 份；t80 分支 16 份"},
            {type: "规范与测试规范", count: 36, note: "docs/standards 25、docs/testing 11"},
            {type: "Skill", count: 8, note: ".agents/skills"},
            {type: "AGENTS", count: 26, note: "各级 AGENTS.md"},
            {type: "用户文档", count: 102, note: "vitepress/"},
        ],
        /* git log t80/settings-ui -- docs/specs/settings/settings-window.md */
        fileLog: [
            ["5bc8fbda", "15:46", "fix(t80): S5 按审查修正关窗期间迟到的 page 加载结果；补实现合同与证据、注册表标待晋升"],
            ["28d4e3de", "11:42", "feat(t80): S4 工作台贡献点 activitybar-items 与 overlays"],
            ["2eef0fa2", "10:39", "feat(t80): S3 示例插件 example.snippets 与 page 分区"],
            ["dbe41959", "10:09", "feat(t80): S2 设置窗口"],
            ["177682b4", "08:55", "feat(t80): S1 设置声明补字段、settings.sections（新建本 Spec）"],
        ],
        /* 今天这个 checkout 上改过的 docs/specs */
        recent: {
            t80: [["15:46", "settings/settings-window.md"], ["15:46", "workbench/bookshelf.md"], ["15:46", "README.md（注册表）"], ["11:42", "ui/workbench-shell.md"], ["10:09", "settings/configuration.md"], ["10:09", "workbench/commands.md"], ["08:20", "runtime/projects.md"], ["08:20", "runtime/browser-host.md"], ["03:37", "workbench/notifications.md"], ["02:11", "workbench/editor.md"]],
            master: [["13:30", "docs/testing/README.md"], ["13:30", ".agents/skills/design-review/SKILL.md"], ["08:57", ".agents/skills/README.md"]],
        },
    },
};
