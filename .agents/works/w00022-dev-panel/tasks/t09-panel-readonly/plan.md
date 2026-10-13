# t09 实施计划：面板服务与只读视图

草案，交主 Agent 与设计审查（编码子代理 2026-10-12 写；2026-10-13 按设计审查改，正文与“设计审查的处理”一节不一致时以后者为准）。范围以 [实施计划的 t09 一节](../t03-design/plan.md#t09-面板服务与只读视图)（场景 1 到 7）为准，设计依据是 [Proposal](../../../../../docs/proposals/dev-panel.md) 第七节的会话列表、第八节（访问与安全，只做只读与本机部分）、第九节（视图），以及待决问题 1、2、3、13（开发者已按推荐同意：首页 Work 区用卡片；Vue 3 加 Vite、不用 Nuxt，样式取 nb-ui 的 token 与主题；面板 `127.0.0.1:4400`、产物来源 `4401`；文档视图从 Task 进入看该 Task 的 checkout，从左栏进入看 master）。视图依据 t03 [评审板](../t03-design/artifacts/review/index.html)：第三轮（首页 A、Work 页、会话页）为主；第二轮的产物页、文档页照稿子；GitHub 视图留给 t14。

## Context

- **要解决的问题**：t06 到 t08 之后，记录、租约、产物与答复都能经命令行读写，但开发者只能在终端里看。t09 做面板的第一个入口：本机浏览器里一页看全局（收件箱、每个 Work 的状态、谁在动），往下钻到 Work、Task、产物（带只读的问题侧栏）、文档与会话，并能跨 checkout 搜索。本片只读，不写任何项目数据。
- **前提**：t08 已在集成分支（`f3257f02e`）。核心库已有 `readProjectStatus`、`readActivity`、产物与答复的读取（`readArtifact`、`questionStates`、`listDocuments`、`askerOf`）、herdr 只读客户端。
- **工作方式**：同前。集成分支 `feat/w00022-dev-panel`，每片单独提交，编码子代理不 push；记录只在主工作区改。起开发服务或面板进程用会话的后台机制，记下 PID、用完结束、日志写文件。
- **约束**：服务端用 Bun（`src/server/`）；核心库保持 Node 兼容；前端在 `src/web/`；只支持 Linux。面板是开发工具：不进 Component Lab，不改 nb-ui。

## 环境核实（2026-10-12，本机只读）

| 事项 | 结论 | 怎么查的 |
|---|---|---|
| nb-ui 能否脱离 Nuxt | **能**。见下节实验 | 会话临时目录里的最小实验 |
| 前端工具链 | 根目录 `node_modules` 里已有 `vite@8.1.4`、`@vitejs/plugin-vue@6.0.7`、`vue@3.5.39`、`vue-router@5.1.0`、`reka-ui@2.10.3`、`tailwindcss@4.3.3`、`@tailwindcss/vite`、`@iconify/tailwind4`、`@iconify-json/lucide`、`vue-tsc@3.3.7`、`marked@17.0.6`、`dompurify@3.4.12`，都在 lockfile 里 | `node_modules/*/package.json` |
| `status` 的耗时构成 | 不带 herdr 时整份约 510 毫秒，其中过渡期判定（各 checkout 相对 master 的记录改动）约 370 毫秒，活动（租约与 `/proc`）约 10 毫秒；带 herdr 约 880 毫秒。紧凑 JSON 约 173 KB | 会话临时目录里的计时脚本，真实仓库只读 |
| herdr 的会话接口 | `session.snapshot` 返回 `{type: "session_snapshot", snapshot: {version, protocol, workspaces, tabs, panes, layouts, agents}}`，`panes[]` 带 `agent_session`、`agent_status`、`cwd`。`events.subscribe` 先回 `{type: "subscription_started"}`，之后同一连接上每行一个 `{event, data}`；全局可订阅 `workspace.*`、`tab.*`、`pane.created/closed/updated/focused/moved/exited/agent_detected`、`layout.updated`；`pane.agent_status_changed` 必须带 `pane_id`，只能逐格订阅。**客户端 0.9.3 的 schema（协议 22）里没有 `events_lost`** | `herdr api schema --json`；在命名会话 `nbdev-test` 里实测（用完已删） |
| 状态事件 | 在命名会话里用 `pane report-agent --state` 改状态，逐格订阅没有收到 `agent_status_changed`，快照里的 `agent_status` 也一直是 `unknown`。可能是假扮的 pane 没被 herdr 认成在跑的 Agent，**真实会话上会不会推送没有核实** | 同上 |
| 默认 server | 0.9.1；`session.snapshot`、`events.subscribe` 在默认 server 上都没调过（之前的约定只允许 list、get、read、process-info、ping） | |
| 文档的分布 | `docs/specs/` 38 份、`packages/neuro-book/docs/adr/` 23 份、`docs/proposals/`、`docs/modules/`、`docs/standards/`、`docs/testing/`、`.agents/skills/*/SKILL.md`、各处 `AGENTS.md`、`vitepress/` | `find` |
| 构建产物 | 根 `.gitignore` 已忽略 `dist/` | `git check-ignore` |

### nb-ui 脱离 Nuxt 的实验

在会话临时目录建了一个 Vite 8 加 Vue 3 的最小工程（`node_modules` 链到集成 worktree 的，不进仓库），从 `@notnotype/nb-ui/components` 导入 18 个面板会用到的组件（Button、IconButton、Badge、Kbd、Spinner、SegmentedControl、Tooltip、Popover、Dropdown、Breadcrumb、Tabs、FormInput、Separator、Panel、ScrollArea、Tree、Collapsible、Table、EmptyState）：

- **装主题**：`installTheme(nbookTheme)`（主题模块会带上 `vars.css`），在 `<html>` 上写 `data-nb-theme="nbook"` 与 `data-nb-appearance`，再 `applyColorway(root, nbook-light 或 nbook-dark)`。样式取 `@notnotype/nb-ui/styles.css`（`dist/nb-ui.css`）。
- **面板自己的原子类与图标**：Tailwind 4（`@tailwindcss/vite`）加 `@iconify/tailwind4`，选择器与 nb-ui 一致（`i-lucide-*`），`i-lucide-inbox` 等照常生成。
- **结果**：客户端构建通过（JS 300 KB、CSS 216 KB，未压缩）；用 Vue 的服务端渲染把整页渲染一遍，**没有任何警告**（没有“组件解析失败”，说明这些组件不依赖 Nuxt 的自动注册）；`vue-tsc` 类型检查通过。
- **唯一的例外**：`NotificationViewport` 用了 Nuxt 的 `<ClientOnly>`，脱离 Nuxt 渲染时报“组件解析失败”。面板第一版不用通知视口；以后要用时在面板注册一个直通的 `ClientOnly`，不改 nb-ui。
- 结论：按待决问题 2 的推荐直接用 nb-ui 组件，不需要退路（“只用 token 加自写组件”）。

## 关键设计

### 包内结构

```text
packages/dev-panel/
├── src/server/        # Bun：两个来源、请求校验、缓存、herdr 订阅、各接口、搜索、panel.json
├── src/web/           # 前端：Vite 的根（index.html、main.ts、App.vue、router、pages/、parts/、host/）
├── vite.config.ts     # root: src/web，outDir: dist/web
├── tsconfig.web.json  # 前端的类型检查（vue-tsc，DOM 类型）
└── dist/web/          # 构建产物，不入库（根 .gitignore 已忽略 dist/）
```

- 新增依赖（都已在 lockfile 里）：`@notnotype/nb-ui`（workspace）、`vue`、`vue-router`、`marked`、`dompurify`；开发依赖 `vite`、`@vitejs/plugin-vue`、`@tailwindcss/vite`、`tailwindcss`、`@iconify/tailwind4`、`@iconify-json/lucide`、`vue-tsc`。依赖方向符合 Proposal 第一节（可以依赖 nb-ui）。
- 核心库照旧只用 Node 兼容 API；`src/server/` 只在 `nbdev panel serve` 里按需导入，命令行的其它命令不加载它。

### 服务端

**两个来源**（`Bun.serve` 各一个）：

| 来源 | 地址 | 内容 |
|---|---|---|
| 面板 | `127.0.0.1:4400` | 前端页面（`dist/web`，单页路由回退到 `index.html`）、`/api/*` 的 JSON 接口、`/ws` 的 WebSocket |
| 产物 | `127.0.0.1:4401` | 只读的静态文件：只给 `.agents/works/` 下的文件，没有任何接口 |

- **只绑回环**：`--host` 只接受 `127.0.0.1`、`::1`、`localhost`，别的地址（含 `0.0.0.0`、docker 网桥）在启动前就拒绝。端口可以用参数改。
- **请求校验**（两个来源都做，按顺序，失败一律 4xx、不进业务逻辑）：
  1. 带转发头（`Forwarded`、`X-Forwarded-*`、`X-Real-IP`、`Tailscale-User-Login`、`Tailscale-User-Name`）的拒绝（Proposal 第八节第 10 条：跨设备上线之前关门）；
  2. `Host` 必须是本来源的 `127.0.0.1:<port>`、`localhost:<port>` 或 `[::1]:<port>`（防 DNS 重绑定）；
  3. 面板来源上，非 `GET`、`HEAD` 的请求与 WebSocket 升级要校验 `Origin` 等于面板自己的来源，拒绝缺失与 `null`；非 `GET`、`HEAD` 还要带 `X-Nbdev-Csrf` 头，值是服务启动时生成、写进页面 `<meta>` 的随机令牌。本片没有写接口，这条先建好并测试，t10 直接用；
  4. 产物来源只接受 `GET`、`HEAD`。
- **响应头**：面板来源 `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src <产物来源>; frame-ancestors 'none'`；产物来源 `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups; frame-ancestors <面板来源>`；两边都加 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`。产物来源与面板来源用同一种主机名（请求是 `localhost:4400` 时 iframe 指 `localhost:4401`）。
- **路径守卫**（面板的文件类接口与产物来源共用一个函数）：路径相对某个 checkout 的根，解码后逐段检查；拒绝 `..`、空段、以 `/` 开头、任何一段是 `.git`、`node_modules` 或以 `.env` 开头；`realpath` 之后必须仍在这个 checkout 的根下（防符号链接逃逸）；产物来源另要求在 `.agents/works/` 下。checkout 用登记的 key 指定（`main` 或 worktree 目录名），不接受任意绝对路径。
- **登录**：本片做最小的本机登录（启动令牌换 cookie，见“设计审查的处理”第 1 条）；设备配对与分级在 t13。

**接口**（全是 `GET`，返回 `{schema, ok, data, warnings, errors}`，与命令行的 `--json` 同一个外壳）：

| 接口 | 内容 | 数据从哪来 |
|---|---|---|
| `/api/meta` | 版本、启动时的 master HEAD 与当前 HEAD（变了就 `headChanged: true`）、herdr 是否可用、数据的新旧（各部分的刷新时间） | 缓存 |
| `/api/overview` | 首页与左栏要的全部：Work（不含 Task 正文）与 Task 摘要、收件箱、撞号、会话摘要、无主的运行数、最近的变化 | 缓存 |
| `/api/work/:workId` | Work 页：目标、Task 表（状态、当前情况、最近更新、产物数、待答、执行位置与来源）、谁在动、Work 级文档与产物 | 缓存 |
| `/api/task/:workId/:taskId` | Task 页：README 原文、产物（含文档类）、证据（第一层）、最近 20 个提交、README 里链到的 Spec、所在 checkout、租约 | 按需读，短缓存 |
| `/api/artifacts` | 产物页的列表：设计稿、讲解与报告、审查、证据四类，另列文档类产物与未发布的产物 | 缓存 |
| `/api/artifact/:workId/:taskId/:artifactId?version=` | 产物页：发布记录、题与状态、答复、确认、iframe 的地址 | `readArtifact`、`questionStates` |
| `/api/docs/tree?checkout=` | 文档树：按类型分组（Spec 按目录展开），非 master 的 checkout 附与 master 的差异（新增、删去、改动） | `git ls-files`、`git diff --name-status master...HEAD` |
| `/api/docs/file?checkout=&path=` | 一份文档的原文、frontmatter、最近的改动、哪些已检出的分支改了它 | 读文件、`git log`、`git diff --name-only master...<分支>` |
| `/api/sessions` | 会话页：会话（id、Agent 名称、状态、pane、工作目录是否在本仓库）、它持有的租约、它的运行；无主的运行；checkout 列表 | herdr 快照加核心的活动 |
| `/api/search?q=&checkout=` | 搜索，按行流式返回（NDJSON） | 见“搜索” |
| `/ws` | 推送 `{type: "changed", parts: [...], revision}`，前端据此重取 | 缓存的失效 |

**缓存与首屏 1 秒**：页面请求只读内存里的缓存，从不现算整份 `status`。

- 启动时先算一遍：记录（不带活动的那部分 `status`）、活动、herdr 快照并行；算完才开始监听端口，所以冷启动大约等于一次 `status`（约 0.9 秒，目标 3 秒内）。
- 分三块各自刷新，变了就经 `/ws` 推“哪块变了”：
  - **记录**（Work、Task、收件箱、撞号、产物与文档索引）：`fs.watch` 递归监视主工作区的 `.agents/works/`（去抖 300 毫秒）；每 5 秒一次 `git worktree list --porcelain` 加 `git rev-parse master`，任何 checkout 的 HEAD 或列表变了才重算过渡期判定（这一步占 `status` 的四成多，按各 checkout 的 HEAD 缓存）。来自分支的 Work 读的是执行 worktree 的工作区，未提交的改动靠每 30 秒的兜底重算跟上。
  - **活动**（租约、运行）：监视 `.local/agent/run/leases/`；`/proc` 的运行只在有浏览器连着时每 5 秒扫一次（约 10 毫秒）。
  - **会话**：herdr 订阅（下节），加每 30 秒一次快照对账。
- 核心库为此拆出 `readProjectRecords`（记录那一部分）并让过渡期判定可以传入缓存；`readProjectStatus` 改为两者的组合，命令行的输出不变。
- 前端拿到页面后先请求 `/api/overview`（内存读取加约 170 KB 以内的 JSON），实测再定是否压缩或分页。

**会话数据（herdr）**：

- 面板用自己的只读白名单 `HERDR_PANEL_READ_METHODS`：`ping`、`session.snapshot`、`pane.list`、`pane.process_info`、`events.subscribe`。Proposal 第八节第 7 条里的 `agent.read`、`agent.wait`、`agent.prompt`、`agent.send_keys` 与终端命令留给 t11、t12 加。面板的客户端是常驻的，不开 `memoizeAvailability`、`memoizePanes`、`budgetMs`（t07 的文档已写明）。
- 客户端加一个流式的 `subscribe(subscriptions, onEvent)`：单独的连接，读到 `subscription_started` 后逐行回调；连接断开或出错就回调一次“断开”。
- 订阅全局的 `pane.created/closed/updated/exited/agent_detected` 与 `workspace.created/closed`，加上逐格的 `pane.agent_status_changed`（pane 增减时换一条新的订阅连接）。
- **没有 `events_lost`**：协议 22 里没有这个事件，所以把“连接断开”当作可能丢了事件：断开后退避重连，重连成功先拿一次快照对账；另外每 30 秒对账一次。
- **状态的 1 秒**：真实会话上 `agent_status_changed` 会不会推送没有核实（命名会话里没收到）。S4 先在命名会话里用真实的 Agent 状态上报核实；收不到就改为有浏览器连着时每秒一次 `pane.list`（几毫秒），事件只当加速。
- 默认 server 是 0.9.1，`session.snapshot` 与 `events.subscribe` 在它上面没调过（见决定点 3）。调不通时退回 `pane.list` 加轮询。

**搜索**：

- 范围：已检出的 checkout（默认全部，可以只选一个），文件名与内容。
- 文件名：每个 checkout 一次 `git ls-files -z --cached --others --exclude-standard`，按子串匹配（不区分大小写）；内容：`git grep -I -n -i -F --untracked --exclude-standard -e <q>`，排除 `**/evidences/**`（w00005 的 worktree 里 `.agents` 有十万多个文件）与二进制文件。
- 各 checkout 并发，按行流式返回；每个 checkout 最多 200 条，2 秒内先送出第一批，5 秒截断（结束相应的子进程），最后一行写 `{truncated, elapsedMs}`。前端边收边显示。
- 只读：`git grep` 与 `ls-files` 都加 `--no-optional-locks`。

### `nbdev panel serve`、`panel open`、`panel.json`

- `nbdev panel serve [--host 127.0.0.1] [--port 4400] [--artifact-port 4401] [--no-build]`：前台运行。构建产物缺失或源码变了（`dist/web/.build-hash` 与 `src/web/**`、`vite.config.ts`、`package.json` 的哈希不一致）时先 `vite build`（约 2 秒），`--no-build` 跳过；端口被占时报错退出，不自动换端口。
- 跑起来以后写 `.local/agent/panel.json`（`nbdev.panel/v1`：`pid`、`startTicks`、`startedAt`、`url`、`artifactUrl`、`head`），退出（含 SIGINT、SIGTERM）时删掉；读的一方按 pid 加启动时刻判断它是否真的在跑。
- 记下启动时主工作区 master 的 HEAD；每 5 秒的检查发现 HEAD 变了，`/api/meta` 标出来，顶栏提示“代码已更新，重启后生效”。
- `nbdev panel open [--print]`：读 `panel.json`，面板在跑就用 `xdg-open` 打开地址（`--print` 只打印），没在跑时报 `panel_not_running`，提示先 `panel serve`。
- 合入 `master` 后由主工作区的代码运行（shim 跑的就是主工作区的 `src/cli.ts`），构建产物也在主工作区的包目录里。常驻与 systemd 单元是 t11。

### 前端

**技术**：Vue 3 加 Vite，`vue-router` 用 history 模式（服务端回退到 `index.html`）；组件来自 nb-ui；面板自己的原子类与图标走 Tailwind 4 加 `@iconify/tailwind4`。主题 nbook，明暗跟随系统，可在顶栏切换。

**数据宿主**：`host/` 下一个 `usePanelData`，独占全部 `fetch` 与 `/ws`：按页面需要取数、收到“变了”就重取对应的那块。页面是宿主（`io:read`、`io:stream`），零件只吃 props、只发事件（耦合度 0）。偏好（明暗、左栏各组的展开）只经 `host/prefs.ts` 一处读写 `localStorage`（带 `nbdev-panel:` 前缀，读写都包 try/catch），组件不碰浏览器存储（见决定点 4）。

**页面**（路由 → 依据的稿子）：

| 路由 | 页面 | 依据 |
|---|---|---|
| `/` | 首页：收件箱（待答的提问、撞号）在上；Work 卡片（状态、目标、Task 状态计数条与图例、待答数、最近更新、“来自分支”的警示、虚线框里的“谁在动”）；done 与 shelved 的 Work 收成“其余 N 个 Work”；会话摘要与最近的变化 | 第三轮 `r3/home.html` 的 A |
| `/work/:workId` | Work 页：目标、Task 表、现在谁在动、Work 级文档 | `r3/work.html` |
| `/work/:workId/task/:taskId` | Task 页：README、产物与文档类产物、证据、提交、相关 Spec、所在 checkout、租约 | Proposal 第九节（第三轮没有单独的稿，结构照 Work 页的样式） |
| `/artifacts` | 产物列表：四类加文档类、按 Work 过滤 | `r2/artifacts.html` 的列表 |
| `/artifact/:workId/:taskId/:artifactId` | 左边产物原页（产物来源的沙箱 iframe，`sandbox="allow-scripts allow-forms allow-popups"`，不给同源），右边问题侧栏：未答在上、已答收起、被取代与撤回的折叠，挂在 Task 上的题单列；可切版本、“单独打开” | `r2/artifacts.html` 的产物页 |
| `/docs` | 文档：左边按类型的树，顶部切换 checkout（缺省 master；从 Task 进入时带 `?checkout=<该 Task 的 checkout>`），不是 master 时标出来并列出与 master 的差异（删去的划掉）；右边渲染 Markdown（`marked` 加 `DOMPurify`），frontmatter 变成徽章，带最近的改动 | `r2/docs.html` |
| `/live/sessions` | 会话：以会话 id 加 Agent 名称认，状态与它的运行分开列，附租约；无主的运行；不在本仓库的会话单列；herdr 不可用时给出说明 | `r3/sessions.html` 的左半边（终端在 t12，通知在 t11） |
| `/live/checkouts` | checkout：路径、分支、HEAD、是否可清理、哪个 Work 的执行 worktree | Proposal 第九节 |
| `/search` | 搜索结果，按 checkout 分组，流式出现，截断时标出 | 第二轮顶栏的搜索 |

**外壳与零件**：外壳是左栏（首页与收件箱、工作的 Work › Task 树、产物、文档、现场五组）、顶栏（搜索框、数据新旧、HEAD 变化提示、herdr 状态、明暗）。零件按稿子拆，每个都有同名 `.md`：`StatusChip`、`StatusBar`（计数条与图例）、`QuestionCount`、`LeaseChip`、`EphemeralFrame`（虚线框加“临时”小标）、`InferredMark`、`BranchNote`（来自分支的警示）、`WorkCard`、`InboxList`、`TaskTable`、`QuestionPanel`、`ArtifactList`、`DocTree`、`MarkdownView`、`CheckoutSwitch`、`SessionList`、`RunList`、`SearchResults`、`LoadState`（加载与失败的唯一形态，延时 200 毫秒出现，按 nb-ui 规范第 4.3 节）。

**画法**（第三轮已定）：持久的照常画实线的面；临时的（会话、租约、谁在动、运行）一律信息色虚线框，角上一个“临时”小标，单独的租约是虚线胶囊，失效的划掉；没有字段的值显示“未标”，靠推断的标“推断”、图标空心；来自分支的 Work 在卡片与 Work 页上给警示条。“示例”标记不再需要：数据都是真的。

**规则的取舍**：

- 零件遵守 [组件规范](../../../../../docs/standards/code/components.md)（同名 `.md`、能力标签、明面通道），页面与外壳按规范豁免。
- **不进 Component Lab**：Lab 在 NeuroBook 应用里（Nuxt），挂不了这个包的组件；零件的状态在浏览器验收里用临时仓库的夹具数据摆出来。组件规范“应用侧可挂载组件在 Lab 有场景登记”这条因此不适用。
- 不改 nb-ui；缺的样式在面板里用 token 写，不新增按部件命名的表面变量（nb-ui 规范第 2 节）。
- 窄屏：390 宽时左栏收成抽屉，产物页的侧栏移到 iframe 下面；没有页面级横向滚动。

## 文档改动

| 文件 | 内容 |
|---|---|
| `packages/dev-panel/docs/panel.md`（新） | 面板的合同：两个来源、请求校验、路径守卫、接口与外壳、缓存与刷新、`panel serve`、`panel open`、`panel.json`、构建 |
| `packages/dev-panel/docs/cli.md` | `panel serve`、`panel open` 两个命令与新错误码（`panel_not_running`、`port_in_use`、`unsafe_host`） |
| `packages/dev-panel/docs/herdr.md` | 面板的白名单、订阅与对账、没有 `events_lost` 的处理、状态的轮询退路 |
| `packages/dev-panel/docs/file-formats.md` | `panel.json` |
| `packages/dev-panel/AGENTS.md` | 前端的命令（构建、类型检查）、测试与浏览器验收的做法、起服务要记 PID 并结束 |
| `packages/dev-panel/src/web/**/*.md` | 零件的同名文档 |

## 切片

每片在集成分支上单独提交，只按路径暂存，提交前 `git diff --cached --check`；每片自跑包的 `test` 与 `typecheck`。

| 切片 | 内容 | 提交 |
|---|---|---|
| S1 | 核心：`readProjectRecords` 拆分与过渡期判定的缓存、Task 的“当前情况”（README `## 当前状态` 的第一行）、Task 详情、文档树与文档读取、搜索、herdr 的 `session.snapshot` 与流式订阅、面板白名单；假 herdr 补快照与订阅；L1、L2 | `feat(dev-panel): 面板要用的核心读取（w00022 t09）` |
| S2 | 服务端：两个来源、请求校验、路径守卫、缓存与刷新、各接口、`/ws`、`panel.json`、`panel serve`、`panel open`；L3 安全与只读测试 | `feat(dev-panel): 面板服务与只读接口（w00022 t09）` |
| S3 | 前端骨架：依赖、Vite 与 Tailwind 配置、主题、外壳、数据宿主、`LoadState`、首页、Work 页、Task 页；构建脚本与类型检查 | `feat(dev-panel): 面板外壳、首页、Work 与 Task 页（w00022 t09）` |
| S4 | 产物页（iframe 加问题侧栏）、文档页、会话页、checkout 页、搜索页；herdr 状态事件在命名会话里的核实与退路 | `feat(dev-panel): 产物、文档、会话与搜索页（w00022 t09）` |
| S5 | 包文档、零件的同名 `.md`、AGENTS；浏览器验收（临时仓库与真实仓库只读）；性能实测 | 文档一个提交；验收结果不提交，交主 Agent 写进 Task README |

## 验收映射

| 场景 | 覆盖 |
|---|---|
| 1 首页列出全部 Work：w00022 显示真实的状态与目标；w00017 显示“来自分支”；没有字段的显示“未标”；t08 发布的提问在收件箱里；herdr 里的会话状态变化 1 秒内反映到页面 | L3：临时仓库（一个带状态与目标的 Work、一个来自分支的 Work、一个没有字段的 Work、一份发布了提问的产物）上请求 `/api/overview`；假 herdr 推一条状态事件，断言 `/ws` 在 1 秒内推出变化、再取到新状态。浏览器：同一临时仓库的首页；真实仓库只读看 w00022、w00017 与“未标” |
| 2 从 Work 展开 Task、打开产物：产物在第二个来源的 iframe 里渲染，侧栏列出题与已有答复，被取代的题折叠 | L3：`/api/artifact` 的题与状态、iframe 地址指向产物来源；产物来源能取到页面、取不到 `.agents/works/` 之外的文件。浏览器：临时仓库里发布过两版（换过题号、有答复）的产物页 |
| 3 文档页默认看 master；从 Task 进入时切到该 Task 的 checkout，并标出与 master 的差异 | L3：临时仓库加一个改了 Spec 的 worktree，`/api/docs/tree` 与 `/api/docs/file` 在两个 checkout 上的结果与差异。浏览器：从 Task 页进入文档页，看到 checkout 与差异标记 |
| 4 一个会话 idle、它派出的 omp 审查还在跑：会话页显示 idle，下面另列这个运行 | L3：假 herdr 加 `startFakeClaude` 派出的进程（同 t07 场景 7），`/api/sessions` 里会话 idle、运行挂在它下面。浏览器：同一数据的会话页 |
| 5 安全：`Host: evil.example` 被拒；跨来源的 POST 与 WebSocket 升级被拒；`/../.git/config` 与指向仓库外的符号链接被拒；带 `X-Forwarded-For` 的请求被拒 | L3：对两个来源逐条发请求，断言状态码与不泄露内容；另测 `.env`、`node_modules`、编码过的 `..`、缺 CSRF 头的 POST |
| 6 浏览一轮之后，主工作区的 `git status` 与文件哈希不变 | L3：依次请求全部接口与产物来源、跑一次搜索，前后比对 `git status --porcelain --ignored` 与 `.agents/works/`、`.local/agent/`（除 `panel.json`）的文件哈希。真实仓库：浏览器验收前后同样比对 |
| 7 本机 11 个 checkout 下首页首屏不超过 1 秒 | 真实仓库只读：面板预热后，浏览器从导航到首页内容出现的时间，以及 `/api/overview` 的服务端耗时；另记冷启动时间 |

浏览器验收按 [UI 验收分档](../../../../../docs/testing/README.md#ui-验收分档)：首页、Work 页、Task 页、产物页、文档页、会话页、搜索各走一遍实际交互；外加 nbook 明暗两档与 390 宽（面板有自己的窄屏布局）。用 `playwright-cli` 在隔离的浏览器配置里跑，记录计算样式与几何，截图留在本地 `.local/agent/works/w00022-dev-panel/tasks/t09-panel-readonly/shots/`。

## 验证

- `bun run --cwd packages/dev-panel test`、`typecheck`（加上 `vue-tsc -p tsconfig.web.json`）、`build:web`。
- `bun x vitest run --config scripts/vitest.config.ts scripts/ci/dev-panel-records.test.ts scripts/ci/workspace-workflows.test.ts scripts/ci/agent-governance.test.ts`。
- `bun run governance:check`、`bun run docs:check`、`git diff --check`。
- 面板与 Vite 的进程都用会话的后台机制起，记下 PID，验收完结束，日志写到 `.local/agent/works/…/t09-panel-readonly/logs/`；收尾时确认没有残留进程、命名 herdr 会话已删。
- **未验证的边界**：
  - 默认 server 0.9.1 上的 `session.snapshot` 与 `events.subscribe`（决定点 3）；
  - 真实会话上 `agent_status_changed` 会不会推送；
  - 跨设备访问（t13）；
  - Chrome 以外的浏览器（只用 `playwright-cli` 的 Chromium）。

## 不做与风险

- **不做**：任何写入（t10）；通知、发消息与常驻（t11）；终端（t12）；登录、配对与跨设备（t13）；GitHub 视图与开发服务（t14）；产物页的表单脚本注入（t10）。
- **风险**：
  - **herdr 事件不可靠**：没有丢失信号，状态事件可能根本不推。对策是断开即对账、定时对账、必要时轮询。
  - **过渡期判定的缓存失效不全**：执行 worktree 里未提交的记录改动不改变 HEAD，只能靠 30 秒的兜底重算；页面上显示数据的刷新时间。
  - **`fs.watch` 递归监视**：Linux 上的行为与 inotify 句柄上限（`.agents/works/` 有几千个文件）要实测；不行就退回每 5 秒比对一次 `git status --porcelain` 与目录的修改时间。
  - **构建时间**：每次源码变了，第一次 `panel serve` 多花约 2 秒。
  - **iframe 里的产物页**：沙箱里没有同源，用 `localStorage` 的评审板（t03 的就用了）会读写失败，稿子里都包了 try/catch，只是不记住明暗。

## 需要主 Agent 或开发者决定的点

| 点 | 推荐 | 理由 |
|---|---|---|
| 1. t09 到 t13 之间本机要不要登录（Proposal 第八节第 3 条要求回环请求也登录） | ~~t09 不做登录~~ 已撤回：t09 做启动令牌登录（见“设计审查的处理”第 1 条） | 本机另有 两个可登录账户、sshd 在运行，回环对他们开放 |
| 2. 前端构建产物入不入库 | 不入库；`panel serve` 发现源码变了就先构建，`--no-build` 跳过 | 产物有约 500 KB，每次改界面都会搅动；根 `.gitignore` 已忽略 `dist/`；合入后主工作区第一次起面板时自动构建 |
| 3. 默认 herdr 上的 `session.snapshot` 与 `events.subscribe` | 允许面板与验收对默认 server 调这两个只读方法 | 它们不改 herdr 的状态；面板上线后本来就要调；不调就无法核实 0.9.1 上的行为，只能全程轮询 |
| 4. 面板的偏好（明暗、左栏展开）存哪 | 经 `host/prefs.ts` 一处读写 `localStorage`，组件不碰 | 前端规范禁止组件裸写浏览器存储、要求经宿主；面板没有 NeuroBook 的 Storage 服务，偏好也不值得写进仓库或 `.local` |
| 5. 首页列哪些 Work | 状态为 active 与未标的 Work 各一张卡，按最近更新排序；done 与 shelved 收成“其余 N 个 Work” | 首页要回答“哪个 Work 在等我、哪些在动”；22 个 Work 里多数没有状态字段，按“未标”照常列出 |

## 与 Proposal、实施计划的不一致

1. **登录只做一半**：Proposal 第八节第 3 条的“本机浏览器用 `nbdev panel open` 拿一次性登录链接”本片做；设备配对与分级在 t13。
2. **没有 `events_lost`**：Proposal 第七节写“收到 `events_lost` 就重新订阅并对账”，协议 22 没有这个事件，改为连接断开即对账加定时对账；状态事件只能逐格订阅。
3. **面板的 herdr 白名单本片只放只读的五个方法**：Proposal 第八节第 7 条的完整清单在 t11、t12 补齐。
4. **会话页本片没有终端、没有排队的通知**：稿子的右半边是 t12，通知是 t11；“在等你”只认登记的提问，不从终端推断（Proposal 第三节）。
5. **Task 的“当前情况”取 README `## 当前状态` 一节的第一行**：Proposal 第九节列了这一栏，没说从哪读；没有这一节显示“未标”。
6. **GitHub 视图不在本片**（主 Agent 定为 t14）。
7. **零件不进 Component Lab**：组件规范要求应用侧组件在 Lab 登记，面板在别的包里，Lab 挂不了；状态靠浏览器验收里的夹具数据摆出来。
8. **首页不做状态推断**（设计审查第 15 条）：第三轮稿子按“推断”画 Work 的状态与计数，核心没有推断；没有 `status` 的显示“未标”，计数条是“未标”的灰色。超过 30 天没有更新的 Work 与完成、搁置的一起收进“其余 N 个”。
9. **去掉“最近的变化”**：没有数据来源，首页只留收件箱、Work 卡片与一行会话计数。
10. **搜索**：稿子顶栏搜的是 Work、Task、产物、会话（与文档、提交），本片把缓存里 Work、Task、产物标题与会话的匹配放在最前，再搜各 checkout 的文件名与内容；不搜提交。
11. **checkout 页不做“可清理”**：判据在根 `scripts/` 的 `governance:worktree`，本包不能导入根脚本，另写一套会分叉。
12. **收件箱显示提问者的租约是否失效**：`askedBy` 与活动拼起来，失效的划掉（稿子有，计划原先没写）。
13. **产物页不按版本切换页面**：页面文件不按版本保存，切版本只切题表，iframe 上标“页面是当前版本”；版本切换用下拉选择（分段控件把 `v2` 截成了 `v..`）。
14. **`panel serve` 多一个 `--static-dir`**：用现成的前端产物、不构建；服务端测试注入桩页面，命令行测试也用它，不依赖 `dist/web`。

## 设计审查的处理

审查报告见 [`evidences/design-review.txt`](evidences/design-review.txt)（0 阻断、12 重要、8 建议），主 Agent 2026-10-13 定为全部采纳，另加一条 t07 遗留问题。逐条对应如下；与正文不一致时以本节为准。

| 条目 | 处理 | 落在哪片 |
|---|---|---|
| 1 回环对本机其他账户开放 | 本机登录：`panel serve` 生成随机启动令牌，写进权限 600 的 `panel.json`；`panel open` 打开一次性链接 `/login?ticket=<一次性票据>`（票据由令牌派生、用一次作废，5 分钟过期），服务换成 `HttpOnly; SameSite=Strict; Path=/` 的会话 cookie 后重定向到首页；`/api/*` 与 `/ws` 都要求带这个 cookie，缺了回 401，页面本身（`index.html` 与静态资源）不要求 cookie，前端拿到 401 时提示“用 nbdev panel open 打开”。cookie 只认本次服务实例（重启后作废）。设备配对与分级仍在 t13 | S2 |
| 2 文件接口是黑名单、搜索绕过守卫 | `/api/docs/file` 只接受同一 checkout 的 `/api/docs/tree` 列出的路径，其余 404；搜索结果逐行套同一个段检查（`.git`、`node_modules`、`.env*`、`.local`、`workspace` 等开头的段一律丢弃）；`workId`、`taskId`、`artifactId`、`version`、checkout key 只接受缓存里存在的值，不拿来拼路径 | S1、S2 |
| 3 跨站 GET 触发搜索、没有取消与校验 | 二选一定为：所有 `/api/*` 要求 `Sec-Fetch-Site` 为 `same-origin` 或 `none`（缺这个头的按 `none` 处理，只有浏览器跨站请求会带 `cross-site`、`same-site`）；加上第 1 条的 `SameSite=Strict` cookie，跨站请求两道都过不去。搜索全局同一时刻只跑一组，有新搜索或客户端断开（`req.signal`）时立刻结束旧的子进程；`q` 去掉首尾空白后：非空、不含控制字符、长度 2 到 200，否则 400；前端去抖 300 毫秒 | S1、S2、S4 |
| 4 `GIT_LITERAL_PATHSPECS` 让排除失效 | 搜索用单独的 Git 调用（`runSearchGit`）：不带 `GIT_LITERAL_PATHSPECS`，pathspec 由服务端写死（`:(exclude,glob)**/evidences/**`、`**/experiments/**`、`**/node_modules/**`）；文件名搜索的 `ls-files` 结果按 checkout 的 HEAD 缓存；每个 checkout 读满 200 行就结束子进程；结果按 checkout 完成的先后送出，慢的后送 | S1 |
| 5 “该 Task 的 checkout”没有定义 | 定义 **执行 checkout**，候选依次：① README“执行位置”一节写的 worktree 路径或分支；② 目录名匹配 `<Work 编号>-<Task 编号>-*` 的 worktree（多份时都列出）；③ 登记表的 `home`；④ Work 的执行 worktree；⑤ master。`/api/task` 返回候选列表与选中的那个；CheckoutSwitch 列出这些候选；Task 页的提交列表在执行 checkout 上取（`git log -n 20 -- <Task 目录> <候选的改动路径>` 改为取执行 checkout 分支相对 master 的提交，没有分支时取 Task 目录的提交）。场景 3 的夹具改成“记录在 master、代码在 worktree” | S1、S3、S4 |
| 6 活动缓存失效不全 | 有浏览器连着时每 5 秒整份重算活动（租约评估加运行）；记录或会话（herdr）有变化时也触发。租约目录的监视只当加速，目录不存在时先监视 `.local/agent/`（再不存在就只靠 5 秒的重算），面板不建目录 | S2 |
| 7 “代码已更新”按 master HEAD 判断 | 比较 `git rev-parse HEAD:packages/dev-panel`、`HEAD:packages/nb-ui` 与 `HEAD:bun.lock` 三个对象 id，与启动时的不同才提示；`.build-hash` 的输入与之保持一致（见第 10 条） | S2 |
| 8 产物来源 | 地址形如 `/a/<随机前缀>/<checkout key>/.agents/works/…`，前缀在服务启动时生成，只经 `/api/artifact` 交给面板；带前缀的请求回 `Access-Control-Allow-Origin: *`。产物页不按版本切换页面，只切换题表，iframe 上标“页面是当前版本”；磁盘内容的哈希与最新发布的 `contentHash` 不同时标“有未发布的改动”；补上 Work 级产物的地址（`/api/artifact/:workId/-/:artifactId`）。产物来源给 t10 的表单脚本留保留路径 `/a/<前缀>/_nbdev/`（本片回 404） | S2、S4 |
| 9 Tailwind 层叠 | 面板与 nb-ui 一样不分层地引入原子类：`@import "tailwindcss/theme.css"` 加 `@import "tailwindcss/utilities.css"`，preflight 单独放进 `@layer base`；S3 的浏览器验收核对 390 宽时左栏显示与隐藏的计算样式 | S3 |
| 10 `panel serve` 的锁、构建与收口 | 先在 `.local/agent/run/panel.lock`（`.local/agent/` 不存在时建 `run/`；这是面板自己的运行时目录，不算项目数据）取一把面板锁，拿不到报 `panel_running`；先绑定两个端口再构建，预热完成之前 `/api/*` 回 503；构建输出到临时目录，完成后改名替换 `dist/web`；构建失败时有旧产物就用旧的、在 `/api/meta` 标 `buildFailed`，没有旧产物就以 `build_failed` 退出；`.build-hash` 的输入是 `src/web/**`、`vite.config.ts`、`tsconfig.web.json`、`package.json`、nb-ui 包目录（`src/`、`package.json`）与 `bun.lock`；`panel.json` 原子写入（临时文件加改名），退出时只删 pid 与启动时刻都是自己的那份；SIGHUP 与 SIGINT、SIGTERM 一样收口，结束正在跑的 `git grep` 与 `vite build` | S2 |
| 11 场景 5、6 的测法 | 场景 6：浏览前 touch 一个标记文件，浏览后 `find <主工作区> <各 worktree> <git 公共目录> -newer <标记>` 断言为空（排除 `panel.json`、`panel.lock`、`dist/`）。场景 5：用原始套接字发未编码的 `..`、`%2e%2e`、`..%2f`、`%00`、不合法的百分号编码，逐条断言 4xx；URIError 与 NUL 都不能变成 500；单页回退不能对 `/.git/config` 回 200 的 `index.html`（回退只给不带点的路径） | S2 |
| 12 herdr | 对账用 `agents[].state_change_seq` 判断有没有漏事件；全局订阅加 `pane.moved`；换订阅连接时先等新连接回 `subscription_started` 再关旧连接，然后用快照对账一次；重连退避初值 500 毫秒、上限 30 秒、乘 2、加 0 到 20% 的抖动，写进 herdr.md；轮询退路 500 毫秒（有浏览器连着时）；会话页与活动用同一份 herdr 状态（快照加事件）。“真实会话会不会推送事件”记为未验证 | S1、S2 |
| 13 缓存细节 | 30 秒兜底重算 `uncommitted_branch_records`；过渡期判定的缓存键加上登记表的修改时间；`fs.watch` 的事件过滤掉 `evidences/`；重算单飞并合并（进行中又来变化只再排一次），失败时保留上一份、在 `/api/meta` 标错；herdr 不阻塞服务开始监听；30 秒兜底只在有浏览器连着时跑 | S2 |
| 14 宿主与推送 | 回应带各块的 `revision` 与服务实例 id，宿主只接受更新的数据；概览只放会话与运行的计数，明细放 `/api/sessions`；判断“变了没有”只比较显示用到的字段；`usePanelData` 是单例，全应用只有一条 `/ws` | S2、S3 |
| 15 与稿子的对应 | 首页不做状态推断，没有 `status` 的显示“未标”；超过 30 天没有更新的 Work 收进“其余 N 个”（done 与 shelved 也收进去）；去掉“最近的变化”；搜索结果把缓存里 Work、Task、产物标题与会话的匹配放在最前面；checkout 页不做“可清理”；收件箱显示提问者的租约是否失效（`askedBy` 与活动拼起来）。都写进“与 Proposal、实施计划的不一致” | S3、S4 |
| 16 Markdown 与 CSP | DOMPurify 配 `FORBID_TAGS: [style, form, input, button, textarea, select]` 与 `FORBID_ATTR: [style]`；CSP 加 `form-action 'none'`、`base-uri 'none'`、`object-src 'none'`，`img-src` 加产物来源，`connect-src` 显式写出 `ws://<host>:<port>`；链接改写：`.md` 转成文档页，产物目录里的文件转成产物页，图片走产物来源 | S4 |
| 17 文档树与差异 | 树用 `ls-files -z --cached --others --exclude-standard`；差异分两类：分支改的（`master...HEAD` 三点 diff 加工作区状态）与 master 新增、分支还没有的（`HEAD..master` 里新增、三点 diff 里没有的）；这里的“master”指主工作区的工作区（未提交的 master 文档也算），写进 panel.md | S1 |
| 18 路径守卫 | `realpath` 之后对相对路径再做一遍段检查；checkout 的 key 撞名时改用路径哈希；产物来源留 `_nbdev/` 保留路径 | S2 |
| 19 工程与测试 | `tsconfig.json` 排除 `src/web`；服务端测试不依赖 `dist/web`，静态目录可以注入；拆分 `readProjectRecords` 前后，在同一个夹具上对 `status --json` 做一次整份比对（去掉时间字段），带 `--work`、`--task` 的过滤与报错情形 | S1、S2 |
| 20 场景 7 的测法 | 预热完成、herdr 可用；浏览器冷、热各测一组；“首屏”以第一张 Work 卡片渲染完成为准；每组 10 次，报 p50 与最大值，同时记录 `/api/overview` 的服务端耗时与字节数；注明当时本机的负载 | S5 |
| t07 遗留：临时仓库的操作标到真实 pane | 写或清标签之前，确认 pane 的 `cwd` 或 `foreground_cwd` 在被操作仓库的某个 checkout 下；都不在就不写，给 `herdr_tag_skipped`（`reason: other_repository`）；补 L3。`answers --wait` 不带 `--as` 时 `caller_unknown` 出现两次，一并修掉 | S1 |

- **herdr 白名单**：面板用 `HERDR_PANEL_READ_METHODS`（`ping`、`session.snapshot`、`pane.list`、`pane.process_info`、`events.subscribe`），订阅类型由服务端写死，不订 `pane.output_matched`。
- **新错误码**：`panel_not_running`、`panel_running`、`port_in_use`、`unsafe_host`、`build_failed`。

## 实施进度（编码子代理随做随记）

- S1：`e9a38bfff`（拆 `readProjectRecords`、过渡期缓存；拆分前后在同一夹具上整份比对 `status --json`，含 `--work`、`--task`、三种报错与人读输出，完全一致，脚本在会话临时目录 `t09/compare/`）、`93f0a910b`（t07 遗留：pane 不在仓库里不写标签；`caller_unknown` 只给一次）、`86538b608`（执行 checkout、文档树、搜索、herdr 快照与订阅）。
- S2：`cd85e1bad`（面板服务、登录、守卫、缓存与推送、`panel serve`/`panel open`、docs/panel.md）。
- S3：`2c38b87c9`（外壳、首页、Work 与 Task 页）。
- S4：`5fc077df7`（产物、文档、会话、checkout、搜索页；顺带修 vite 入口的解析与产物来源 CSP 的 IPv6）。
- 浏览器冒烟用的临时仓库脚本在会话临时目录 `t09/demo/setup.ts`，浏览器脚本 `t09/browser/smoke.ts`，截图在 `.local/agent/works/w00022-dev-panel/tasks/t09-panel-readonly/shots/`。
- 之后：`b557c0803`（产物页版本切换改用下拉）、`fe4358d4f`（面板前端的文档与包内约定）。
- **验证**：包测试 168 个全过（含 L4，`nbdev-test` 会话用完已删）、typecheck（含 `vue-tsc`）、`build:web`、根上三个测试文件 175 个、`governance:check`、`docs:check`、`git diff --check` 都通过。
- **浏览器验收**（Playwright 加 `/usr/bin/google-chrome-stable`）：临时仓库上逐页截图（1440 明暗两档、390）并走一遍交互（没登录的提示、卡片进 Work 页、Task 表进 Task 页、README 链接进产物页、切 v1 题表、展开已答与已取代、从 Task 的执行 checkout 进文档页、只看有差异的、文档链接改写、顶栏搜索、收件箱进产物页、产物过滤、明暗切换、390 的抽屉与产物页侧栏在下），全部通过、控制台没有错误；390 宽时左栏计算样式 `display: none`、1440 时 `flex`，各页没有横向溢出。真实仓库只读看了首页（w00022 进行中带目标、w00017 来自分支、其余未标）、Work、t80（执行 checkout 按 README 选 `w00017-t80-settings-ui`）、t03 评审板（没发布，iframe 照常渲染）、产物、会话（默认 herdr 0.9.1 已订阅）、checkout、搜索。
- **场景 6（真实仓库）**：浏览与搜索前后 `find <主工作区> <各 worktree> <git 公共目录> -newer <标记>` 只有面板自己的 `panel.json`、`run/panel.lock` 与它们所在的两个目录（以及验收脚本写的截图）；`git status` 前后一致。面板退出后删了 `panel.json` 与锁，留下的空 `run/` 已删。
- **场景 7（真实仓库，11 个 checkout，herdr 可用，负载 0.4）**：冷缓存首屏（第一张 Work 卡片渲染完成）p50 216 毫秒、最大 246；热缓存 p50 101、最大 111；`/api/overview` 本机 p50 1 毫秒、117864 字节；首页资源 9 个共 409 KB（未压缩）。冷启动（绑定端口到预热完成）约 0.87 秒。
