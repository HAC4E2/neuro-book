# 面板

开发者项目面板的合同：两个来源、登录、请求校验与路径守卫、接口、写接口（t10）、通知与会话页（t11）、审计（t11）、缓存与刷新、`panel serve` 与 `panel open`、常驻（t11）、前端构建。命令行合同见 [cli.md](cli.md)，文件格式见 [file-formats.md](file-formats.md)，herdr 的订阅与对账见 [herdr.md](herdr.md#面板的订阅与对账)，投递的判据见 [herdr.md](herdr.md#投递t11)。读接口与 t09 相同；t10 加了答复、新建、状态切换与编辑的写接口，与命令行走同一个核心函数、同一把锁、同一种路径限定的提交；t11 加了答复之后通知提问的会话、会话页的屏幕与输入框与按键、审计与 systemd 用户服务。

## 两个来源

| 来源 | 地址 | 内容 |
|---|---|---|
| 面板 | `127.0.0.1:4400` | 前端页面（`dist/web`，单页路由回退到 `index.html`）、`/api/*` 的 JSON、`/ws` 的推送、`/login` 的一次性登录 |
| 产物 | `127.0.0.1:4401` | 只读的静态文件：`/a/<随机前缀>/<checkout key>/.agents/works/…`，只给 `.agents/works/` 下的文件，没有接口 |

- **只绑回环**：`--host` 只接受 `127.0.0.1` 与 `localhost`，别的地址（含 `0.0.0.0` 与 `::1`）报 `unsafe_host`；这台机器上绑不了的地址也报 `unsafe_host`。不收 IPv6：本机的 `lo` 关了 IPv6，有 IPv6 的机器上 Chrome 的 CSP 也写不了 IPv6 字面量，产物页嵌不进来。端口被占报 `port_in_use`，不自动换端口。
- **产物来源的随机前缀**在服务启动时生成，只经 `/api/artifact` 交给面板：网页猜不到地址，读不走只在本机、或只在未推送分支上的产物；有了它才能回 `Access-Control-Allow-Origin: *`（沙箱 iframe 是不透明来源，模块脚本、`fetch` 与字体都按 CORS 取）。`/a/<前缀>/_nbdev/` 是保留路径，回 404（t10 不做页内答复，留着不让它与 checkout key 撞名）。
- 产物来源与面板来源用同一种主机名：请求是 `localhost:4400` 时，iframe 指 `localhost:4401`。

## 登录

回环对本机的其他账户与浏览器里的任意网页都开放（本机另有可登录的账户），所以 `/api/*` 与 `/ws` 都要登录。设备配对与分级在 t13。

1. `panel serve` 生成启动令牌，写进权限 600 的 `.local/agent/panel.json`。
2. `panel open` 读它、签一张一次性票据（`<nonce>.<过期时刻>.<HMAC>`，5 分钟过期，用一次作废），写一页跳转页再用 `xdg-open` 打开（见下）；`--print` 只打印登录链接 `/login?ticket=…`。
3. 服务核对票据，换成会话 cookie（`nbdev_panel_<面板端口>`，`HttpOnly; SameSite=Strict; Path=/`），重定向到 `/`。会话只在本次服务实例里有效，重启面板后要重新 `panel open`。cookie 名带端口：cookie 不按端口区分，同一个浏览器登录两个面板（不同仓库，或开发时的演示面板）时，名字相同就会互相踢下线。

页面本身与静态资源不要求登录；`/api/*` 没登录回 401（`unauthorized`），前端据此提示“用 nbdev panel open 打开”。

## 请求校验

两个来源都按顺序做，失败一律 4xx，不进业务逻辑：

1. 带转发头（`Forwarded`、`X-Forwarded-*`、`X-Real-IP`、`Tailscale-User-Login`、`Tailscale-User-Name`）的拒绝（403）：跨设备上线之前不接受经代理转进来的请求。
2. `Host` 必须是本来源的 `127.0.0.1:<port>` 或 `localhost:<port>`（421，防 DNS 重绑定；Bun 按 `Host` 头拼 `req.url`，所以直接比 `Host` 头）。
3. URL 解析器先按规范折叠 `.` 与 `..`（含 `%2e` 写法），折叠后的路径照常过下面的检查，所以 `/../x` 等同 `/x`、出不了根（`/../../etc/passwd` 落到单页回退，回 `index.html`，不是那个文件）。剩下的段逐段解码：编码过的 `/` 与 `\`、解码出 NUL、不合法的百分号编码与空段回 400，不让解码错误变成 500。
4. 面板来源，按这个顺序：
   - `/api/*` 与 `/ws`（不论方法）先要求 `Sec-Fetch-Site` 是 `same-origin` 或 `none`（缺这个头的按 `none` 处理，只有浏览器的跨站请求会带 `cross-site`、`same-site`），再要求登录 cookie（401）。跨站的 `<img src=…/api/search?q=…>` 两道都过不去。
   - 然后，非 `GET`、`HEAD` 的请求要求同源的 `Origin` 加 `X-Nbdev-Csrf` 头（值是服务启动时生成、写进页面 `<meta name="nbdev-csrf">` 的随机令牌）。CSRF 令牌写在不要求登录的 `index.html` 里，本机任何账户都读得到：它只防浏览器里的跨站请求，不是本机账户之间的秘密，写请求靠的是前一步的登录。通过之后 `/api/*` 交给写接口（见“写接口”），没有对应的写路由回 405；`/api` 之外的写请求一律 405。
   - `/ws` 的升级要求 `Origin` 是面板自己的来源（缺失与 `null` 都拒绝）。
5. 产物来源只接受 `GET`、`HEAD`（405）。

响应头：面板来源的页面带 `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: <产物来源>; connect-src 'self' ws://<host>; frame-src <产物来源>; frame-ancestors 'none'; form-action 'none'; base-uri 'none'; object-src 'none'`；产物来源带 `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups; frame-ancestors <面板来源>`。两边都带 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`。

## 路径守卫

面板的文件类接口与产物来源共用：

- **段检查**（`src/core/paths.ts`）：路径相对某个 checkout 的根，拒绝 `..`、`.`、空段、绝对路径、NUL，任何一段是 `.git`、`node_modules` 或以 `.env` 开头，以及第一段是 `.local`、`workspace`、`logs`、`server`（本机数据）。
- **真实路径**：`realpath` 之后必须仍在这个 checkout 的根下，并对真实路径的相对部分再做一遍段检查（仓库里指向 `.git/config` 或 `.env` 的符号链接也拿不到）；只给普通文件。
- **白名单**：`/api/docs/file` 只接受这个 checkout 的文档树（`/api/docs/tree`）或记录（Work 与 Task 的 README、文档类产物）列出的路径，其余 404；产物来源只给 `.agents/works/` 下的文件。
- **id 参数**：`workId`、`taskId`、`artifactId`、`version` 与 checkout key 只接受缓存里存在的值，不拿来拼路径。checkout key：主工作区是 `main`，worktree 用目录名，撞名时改用路径哈希（`h-<12 位>`）。
- 单页路由回退只给最后一段不带点、各段不以点开头的路径：`/.git/config`、`/x.js` 不会拿到 `index.html`。

## 接口

读接口全是 `GET`（写接口见下一节）。JSON 接口的外壳是 `{schema: "nbdev.panel-api/v1", ok, data, warnings, errors, instance, revisions}`：`instance` 是服务实例 id（重启后变），`revisions` 是各块数据（`records`、`activity`、`sessions`、`notify`）的版本号；前端只接受更新的数据。预热完成之前回 503（`warming_up`），`/api/meta` 除外。

| 接口 | 内容 |
|---|---|
| `/api/meta` | 实例 id、启动时刻、是否预热完成、`codeChanged`（面板代码已更新，重启后生效）、`service`（`{unit, restartCommand}`：作为 systemd 服务运行时的单元名与重启命令，前台运行时都是 null，见“常驻”）、前端构建是否失败、herdr 的状态（含 `autoNotify`：这个版本是否自动投递通知）、`audit`（`{enabled, initAt}` 或 `{enabled: false, reason, detail}`）、`notify`（`{pending, attention}`：排队的与要开发者处理的任务数）、各块数据的刷新时刻与错误、产物来源的地址、`mainWritable`（`{ok, code, message}`：主工作区现在能不能写，不在 master 或正在合并、变基时不能，前端据此隐藏写入口） |
| `/api/overview` | 首页与左栏：各 Work 与 Task 的摘要（状态、目标、最近更新、当前情况、来源、待答数、谁在动）、收件箱（提问带 `askedBy` 与 `askerActive`：提问者的租约是否还有效）、会话的计数（明细在 `/api/sessions`） |
| `/api/work/:workId` | Work 页：完整的 Work（Task 表、产物与文档类产物、谁在动）与相关会话；`readmeHash`（README 的 sha256，状态切换带它） |
| `/api/task/:workId/:taskId` | Task 页：Task 摘要（含 `readmeHash`）、README 原文、证据（第一层）、链到的 Spec、执行 checkout 的候选与选中的、执行 checkout 上的提交 |
| `/api/artifacts` | 产物列表：有发布记录的（设计稿、讲解与报告、审查、提问集）与没发布的、文档类产物、各 Task 的证据数 |
| `/api/artifact/:workId/:taskId/:artifactId?version=` | 产物页：版本列表、题与状态（`version` 只切换题表）、答复、确认、iframe 地址（产物来源上磁盘里的当前页面）、`unpublishedChanges`（磁盘内容与最新一版的 `contentHash` 不同）、记录来源（`source`、`branch`）。Work 级产物的 `taskId` 写 `-` |
| `/api/docs/tree?checkout=` | 文档树（按类型分组）；不是主工作区时附与 master 的差异（见下） |
| `/api/docs/file?checkout=&path=` | 一份文档：原文、frontmatter、标题、这个 checkout 上最近 5 次提交、哪些已检出的分支改了它（`changedIn`） |
| `/api/files?path=` | 编辑页：主工作区里一个文件的原文与 sha256、种类（Work README、Task README、文档类产物、主工作区文档）、能不能编辑与原因、未提交的改动（已暂存与工作区分开）、是不是暂存区里一次改名的一端、改过它的分支、根级治理入口的非空行上限。编辑白名单之外的路径回 404 |
| `/api/sessions` | herdr 的状态（可用、订阅还是轮询、漏事件数）与 pane（是否开在本仓库里）、会话持有的租约与它的运行、无主的运行、checkout 列表（是哪个 Work 的执行 worktree） |
| `/api/notify?workId=&taskId=` | 通知任务（`jobs`）与最近 24 小时的尝试（`recent`，同一次尝试的意图与结果合成一条，只有意图的标 `intentOnly`）、审计状态、这个 herdr 版本是否自动投递；两个参数可选（见“通知与会话页”） |
| `/api/sessions/:paneId/screen?session=` | 一格会话的屏幕末尾（`agent.read` 的 `visible`，去掉转义的最后 60 行）与状态；`session` 是页面看到的会话键，对不上回 409 `session_changed` |
| `/api/search?q=&checkout=` | 搜索，NDJSON 流（见下） |
| `/ws` | 先推 `{type: "hello", instance, revisions}`，之后每块数据变了推 `{type: "changed", instance, parts, revisions}` |

### Task 的执行 checkout

记录从哪里读（`TaskView.checkout`）与代码在哪里改不是一回事。执行 checkout 的候选依次是：README“执行位置”一节里写的 worktree 路径或分支（行内代码）；目录名匹配 `<Work 编号>-<Task 编号>-*` 的 worktree；登记表的 `home`；Work 的执行 worktree；主工作区。同一份 checkout 只按最先命中的规则列一次，选第一个。Task 页的提交在执行 checkout 上取：worktree 里是它的分支相对 master 新增的提交，主工作区里是碰过 Task 目录的提交，各最多 20 个。

### 文档树与差异

- 文档是这些位置的 Markdown（`git ls-files --cached --others --exclude-standard`）：`docs/`（Spec、Proposal、模块、规范、测试、意图）、各处 `docs/adr/`、`packages/*/docs/` 与包根的 `CONTEXT.md`、`README.md`、`.agents/skills/`、`vitepress/`、各处 `AGENTS.md` 与 `CLAUDE.md`、仓库根的 Markdown；路径里有 `node_modules`、`evidences`、`experiments`、`dist` 的不算。Work 与 Task 目录里的 Markdown 由记录索引，不在树里。磁盘上不是普通文件的不列：符号链接（读文档也经路径守卫，指向 `.env` 或仓库外的链接读不到），以及工作区里已删掉、还没暂存删除的文件（差异里记成 `deleted`）。
- 这里的“master”指主工作区的工作区（含未提交的文档），不是 `master` 引用。非主工作区的差异分两类：分支改的（`master...HEAD` 的三点 diff 加工作区里没提交的：`added`、`modified`、`deleted`）；master 有、这里没有、也不是分支删的（`master_only`，分支分出之后 master 新增的）。

### 搜索

- 范围：已检出的 checkout（缺省全部，`checkout=` 只选一个），文件名与内容。`q` 去掉首尾空白后要非空、不含控制字符、长度 2 到 200，否则 400。
- 最先送缓存里 Work、Task、产物标题与会话的匹配（`{type: "record"}`）；再在各 checkout 上并发搜文件名（`ls-files` 的结果按 checkout 的 HEAD 缓存）与内容（`git grep -I -n -i -F --untracked --exclude-standard`），逐条送 `{type: "hit", checkout, kind, path, line, text}`，每个 checkout 做完送 `{type: "checkout_done", count, truncated, elapsedMs, error}`（先做完的先送），最后 `{type: "end", truncated, aborted, elapsedMs}`。
- 排除 `**/evidences/**`、`**/experiments/**`、`**/node_modules/**`；搜索用单独的 Git 调用（不带 `GIT_LITERAL_PATHSPECS`，pathspec 由服务端写死，用户输入只经 `-e`）。结果逐行套段检查。
- 每个 checkout 的文件名与内容各最多 200 条，读满就结束子进程；5 秒截断。全局同一时刻只跑一组：有新搜索或客户端断开就结束旧的子进程，被取代的那组最后一行带 `aborted: true`。

## 写接口

每个接口直接调命令行用的同一个核心函数，取同一把锁（`.local/agent/registry.json.lock`），在 master 上做路径限定的提交。面板以开发者身份写（调用者种类 `developer`，`device` 在 t13 之前一律 `local`）：不取租约；提交信息标“面板”（`面板新建`、`面板编辑`、`面板记下`，状态改动加“（面板）”）；登记表新号的 `by` 是 `{key: "developer:local", agent: "developer", label: "local", 其余 null}`；答复的 `submittedBy` 是 `{kind: "developer", device: "local"}`，`submittedAt` 是服务端收到请求的时刻。

| 接口 | 核心函数 | 请求体（JSON）| 上限 |
|---|---|---|---|
| `POST /api/answers` | `submitAnswer`（`requireLatest`） | `{workId, taskId, artifactId, version, values, comments?, note?}` | 256 KiB |
| `POST /api/works` | `createWork` | `{slug, title, goal, issue?, taskSlug, taskTitle?, taskStatus?}` | 16 KiB |
| `POST /api/works/:workId/tasks` | `createTask` | `{slug, title, goal?, status?}` | 16 KiB |
| `POST /api/works/:workId/status` | `setRecordStatus` | `{status, expectedHash, includeUncommitted?}` | 4 KiB |
| `POST /api/works/:workId/tasks/:taskId/status` | `setTaskStatus` | 同上 | 4 KiB |
| `PUT /api/files?path=` | `editRecordFile` | `{content, baseHash, includeUncommitted?}` | 2 MiB（内容 1 MiB） |
| `POST /api/preview/work`、`/api/preview/task` | `previewCreateWork`、`previewCreateTask`（不取锁、不写文件） | 同新建；`/task` 另带 `workId`；字段可以不全 | 16 KiB |

**每个写请求的校验**（在“请求校验”第 4 条之后，失败一律 4xx，不进核心函数）：`Content-Type` 必须是 `application/json`（415 `unsupported_media_type`）；请求体按上表限长，读到上限就停（413 `payload_too_large`）；必须是 JSON 对象，只收列出的字段（多出的、拼错的字段名 400 `usage`，`details.field`），类型不对、缺必填 400；路径参数与请求体里的 `workId`、`taskId`、`artifactId` 只接受缓存里存在的值（404）；题号按题号格式校验、存进无原型的对象。写进记录的文字拒绝 C0 控制字符（允许制表符），换行只在正文类字段（目标、说明、备注、文字答复、编辑内容）里允许（核心的规则，命令行一致）：标题报 `invalid_title`，其余报 `invalid_text`。

**HTTP 状态**：用法错误 400，冲突 409，找不到 404，`lock_timeout` 与 `warming_up` 503（确定什么都没写），其余运行失败 500。写入成功但提交失败（`commit.reason` 为 `git_lock_timeout` 或 `git_failed`）回 500 `commit_failed`，`details.writtenPaths` 与 `data.commit` 列出已写的文件；`nothing_to_commit`（内容或状态没变）回 200，`data.changed: false`。成功时 `data` 是核心的结果加 `changed` 与 `commit`。

**并发与时序**：

- 写请求等锁沿用 t06 定的 30 秒，持锁者还可能等 `index.lock` 10 秒。面板来源的 `idleTimeout` 设 60 秒，不在等锁时切断连接（Bun 1.4.2 实测默认的 10 秒会切断没有请求体的请求）。
- 取到锁之后、写第一个文件之前看一次请求是否已断开：断开了就放锁、什么都不写（`request_aborted`，只进面板日志），免得开发者看不到结果再按一次就多领一个号。写了之后才断开的照常提交。
- 写成功后，等记录与活动各重算一次（这次重算在写入之后开始）再回应，回应的 `revisions` 已包含这次写入：前端拿到回应就能打开新建的 Work。
- **哈希绑定**：状态切换带 `expectedHash`、编辑带 `baseHash`（开发者看到的那一版的 sha256，必填）。核心在锁内先比哈希（不一致 409 `hash_mismatch`，`details.currentHash`），再查暂存的改名（目标是暂存区里一次改名或复制的一端时 409 `staged_rename`，不给放行），再查未提交改动（409 `uncommitted_changes`，`details` 带 `currentHash`、`status`、`staged`、`unstaged`、`untracked`）。开发者看过差异、选“连同这些改动一起提交”后，前端带 `includeUncommitted: true` 与 `currentHash` 重发（待决问题 8）；这些改动会以面板的名义提交进 master。
- **落位之后的核对**：`git add` 之前重读本次写入的每个文件，与写入的内容不同（别的进程在这之间改了它）就不提交，409 `changed_after_write`（`details.writtenPaths`），你的改动留在工作区。提交里的 blob 与写入内容不同时给警告 `commit_included_foreign_changes`。
- 答复只收针对最新一版的（`requireLatest`，锁内比对，否则 409 `stale_version`，`details.latestVersion`）；Work 级产物没有发布记录，不能答。

**编辑**（`editRecordFile`）：只改主工作区里已有的文件，不新建、不删除、不改名；worktree 上的文件不给改（写事务的锁与提交只覆盖主工作区）。在锁内判定能不能改：段检查合格（与“路径守卫”相同）、从仓库根到文件每一段都不是符号链接、是普通文件，再按类——Work 与 Task 的 README（记录来源是 master、README 已提交；来自分支的报 `branch_maintained_record`）、Work 与 Task 目录第一层的文档类产物（在重算的记录索引里逐字出现）、主工作区的文档（在重算的文档树里逐字出现）；不合格 409 `not_editable`（`details.reason`）。README 的新内容在锁内校验：frontmatter 能解析，`schema`、`workId` 或 `taskId`、`issueId`、`status` 与原文相同（改状态要用状态切换），不新增治理检查禁止的旧字段，否则 400 `invalid_record_edit`（`details.problems`）；有改动时核心把 `updated` 改成当天。编辑其它文档不碰 README。

**审计**：每个写接口在写事务之后补一行审计结果（见“审计”）；审计没初始化时跳过，初始化过却写不进去时照常回应、给警告 `audit_write_failed`。

## 通知与会话页（t11）

答复之后，面板给提问的会话的输入框里投一行指针消息，会话照着读答复、记进 Task 并确认。会话页能看一格会话的屏幕末尾、往它的输入框里发文字、发按键。投什么、什么时候投、什么时候不投，判据见 [herdr.md](herdr.md#投递t11)。t11 不做 steer，也不做“会话工作中仍然发送”：会话在工作时一律排队，只投给空闲、且输入框认出为空的会话。

**通知任务**不落盘，每次现算；`.local/agent/run/notify/` 只记“对哪几份答复、向哪个会话做过什么”（格式见 [file-formats.md](file-formats.md#通知的尝试记录)）。

- 一条任务的键是（Task、提问者会话）。它覆盖的答复：这个 Task 里开发者提交的、对这个会话问的至少一道题有取值、还没对它办完的答复（代录的答复是会话自己写的，不通知）。提问者取题第一次出现的那一版的 provenance。
- 一份答复对提问者 X 算办完：尝试记录里有对 X 的 `delivered`、`delivered_into_blocked`、`delivered_maybe_wrong_session`、`uncertain` 或 `skipped`（手动另选会话发的，也算 X 这一份）；只有意图、没有结果的按 `uncertain` 算（面板在投递途中退出，界面提示看终端）；或者覆盖它的确认的 provenance 会话键就是 X。别的会话的确认不算 X 办完；确认没有 provenance（换了机器、删了 `.local`）时退回“已确认就算办完”，这时可能漏通知。`run/notify/` 丢了，办完的最多重发一次。
- **启用时刻**是审计初始化的时刻（`init.json`）。答复 id 里的时刻早于它的只进 `legacy`，不自动发、可以手动发；审计没初始化时任务都是 `audit_unavailable`，不发。
- **什么时候现算**：记录、活动、会话变了，写接口成功之后（第二份答复不改变记录缓存的指纹，不会经推送触发），以及每 15 秒兜底。有排队的任务、没有浏览器时 herdr 的兜底轮询放慢到 15 秒。
- **任务的状态**（`jobs[].state`）：

| 状态 | 含义 | 界面 |
|---|---|---|
| `ready` | 空闲，稳定 3 秒、判定可投之后自动发 | “几秒内通知” |
| `waiting_idle` | 在工作 | “已排队：这一轮结束后通知” |
| `waiting_blocked` | 在等确认 | “在等确认，排着” |
| `waiting_input` | 空闲但输入框不是认得出的空（`waitReason`、`screen`）；状态序号变了（`agent.get`，不读屏）或过了 15 秒才重读屏幕 | 原因与屏幕末尾，可手动发 |
| `unknown_status` | 状态未知，不自动投 | 可手动发（仍要空闲） |
| `waiting_herdr` | herdr 不可用 | 排着 |
| `replaced` | 提问者不在 herdr 里，它提问时所在的 pane 上换了一个本仓库里的会话（`replacedBy`） | 小窗：发给现在的会话，或不通知 |
| `no_target` | 提问者不在 herdr 里（结束了、外部会话） | 列出持有这个 Task 有效租约、在 herdr 里、pane 在本仓库的会话（`alternatives`），各一个“通知它”；没有就写“会话下次读答复时会看到” |
| `not_in_repository` | 提问者的 pane 已不在本仓库 | 不自动通知，可选别的会话 |
| `manual_only` | 这个 herdr 版本不自动投递（只放行 0.9.1 与 0.9.3） | 可手动发 |
| `legacy` | 只有早于启用时刻的答复 | 可手动发 |
| `audit_unavailable` | 审计不可用 | 提示初始化 |

- **按会话键找提问者**，与租约是否有效、是否续接无关；pane id 只用来判“会话已更换”。
- **指针消息**（一行，不放答复正文；与根 `AGENTS.md` 里 `[nbdev]` 那一句逐字对应）：`[nbdev] <W>/<T> 有 N 题新的开发者答复（产物 a、b）。对括号里列出的每个产物，运行 nbdev answers <W> <T> <产物> --json 读答复并把决定写进 Task 记录；再运行 nbdev answers ack <W> <T> <产物> --through <该次输出里的 cursor>。`
  - 按产物逐个读、逐个确认：Task 级的 `answers --json` 会列出没有答复的产物（报告、未答的提问集），对它们 `ack` 报 `no_answers`，输出也成倍变长。
  - 读答复不带 `--unacked`：别的会话先确认之后，这个会话照样读得到与自己有关的答复。
  - 手动发给提问者时连旧答复一起（`manualMessage`）。
- 同一格 pane 的所有发送（通知、文字、按键）在面板里经一把按 pane 的互斥串行。收到 SIGTERM 时先等进行中的投递结束（上限为等待时限加 2 秒），再收口。

**接口**（写请求的校验同“写接口”，在它之前已核过转发头、Host、登录、`Sec-Fetch-Site`、Origin 与 CSRF）：

| 接口 | 请求体（JSON） | 结果 |
|---|---|---|
| `POST /api/notify/send` | `{workId, taskId, sessionKey, target: {paneId, sessionKey}, confirmScreen?}`：`sessionKey` 是提问者（任务的键），`target` 只能是这条任务列出的会话（提问者本人、`replacedBy`、`alternatives`），否则 409 `session_changed`（`details.reason: not_a_candidate`） | `{result, code, message}`；`result` 见尝试记录 |
| `POST /api/notify/skip` | `{workId, taskId, sessionKey}` | 记 `skipped`，这些答复（连旧答复）对这个提问者办完 |
| `POST /api/sessions/:paneId/prompt` | `{text, expectedSession, confirmScreen?}`：最长 4000 字，拒绝 C0 控制字符（允许换行与制表符） | `{result, code, message}` |
| `POST /api/sessions/:paneId/keys` | `{keys, expectedSession, confirmed?}`：一次 1 到 4 个，只收 `up`、`down`、`shift+tab`、`enter`、`esc`、`ctrl+c`、`y`、`n`（其它 400 `key_not_allowed`）；除上、下之外都要 `confirmed: true`（只防前端误发，确认框在前端）；一次最多一个 `ctrl+c`，同一格 3 秒内第二次 409 `key_rate_limited`（调 herdr 之前记账） | `{sent}` |

- **顺序**：字段与长度、键名白名单 → 审计可用（否则 409 `audit_unavailable`，什么都不调）→ Ctrl+C 限速 → `agent.get` 核对会话键（`expectedSession` 为空或 pane 上没有会话一律拒绝）、pane 在本仓库、文字还要求空闲 → 写审计意图（写不进去就不发）→ 调 herdr → 写审计结果。
- **文字与手动发送的两步确认**：正向白名单不过时回 409 `not_deliverable`，`details.screen` 是屏幕末尾；开发者看过之后带 `confirmScreen: true` 再发，紧贴投递的核对照做。
- **HTTP 状态**：用法 400，冲突 409（`session_changed`、`agent_busy`：在工作、在等确认或状态未知、`not_in_repository`、`not_deliverable`、`audit_unavailable`、`key_rate_limited`），找不到 404（`question_not_found`：没有这条任务），`herdr_unavailable` 503。投递本身的结果（`delivered_into_blocked`、`uncertain` 等）在 200 的 `data.result` 里。

## 审计

`${XDG_CONFIG_HOME:-~/.config}/nbdev/audit.jsonl`：只追加，一行一个 JSON（格式见 [file-formats.md](file-formats.md#审计)）。不放 `.local/agent/`：Agent 能读写那里。

- **初始化**：包脚本 `bun run --cwd packages/dev-panel audit-init`（不进 nbdev 的命令面）建目录（700）、空的 `audit.jsonl`（600）与 `init.json`（启用时刻）；开发者亲手运行它就是授权。面板与命令行都不建这个目录。已经初始化过再运行不改启用时刻。
- **可用**：目录与文件都在、都是属主为自己的普通目录与文件、权限不宽于 700 与 600、`init.json` 读得出。每次写之前核对，不符合按 `audit_unavailable` 处理并写明原因（`reason`：`not_initialized`、`not_regular`、`bad_owner`、`bad_mode`、`unreadable`）。
- **审计不可用时**：通知、文字、按键都不开放（409 `audit_unavailable`，界面提示）；写仓库照常（未初始化时不补审计，初始化过却写不进去时给警告 `audit_write_failed`）。
- **写什么**：通知、文字、按键各写一行意图（`phase: "intent"`）、一行结果（`phase: "result"`），用同一个 `actionId` 关联，意图写成了才调 herdr；写仓库（`answer`、`create_work`、`create_task`、`status`、`edit`）在写事务之后只写一行结果（提交 sha 或失败理由、路径，不记文件内容）。文字与通知的全文进审计（决定点 6：开发者知情，秘密会进审计）。
- 面板进程里只有一个写者，排队串行，每行一次 `O_APPEND` 追加。

## 缓存与刷新

页面请求只读内存里的缓存，从不现算整份 `status`。分四块各自刷新，变了就经 `/ws` 推“哪块变了”；只有显示用到的字段变了才增加 revision（运行的子进程数随时在变，不算）。每块的重算单飞并合并（进行中又来变化只再排一次）；失败时保留上一份，在 `/api/meta` 的 `parts.<块>.error` 标出。

- **记录**（Work、Task、收件箱、撞号）：`fs.watch` 递归监视主工作区的 `.agents/works/`（去抖 300 毫秒，过滤 `evidences/`）；每 5 秒看一次 `git worktree list` 与 master 的 sha，变了才重算（过渡期判定的已提交部分按 master 与各 checkout 的 HEAD 缓存）；有浏览器连着时每 30 秒兜底整份重算，顺带重算各 worktree 未提交的记录改动。
- **活动**（租约、会话、运行）：租约是否有效是读取时现算的（会话退出、过期、Task 关闭都不碰租约文件），所以有浏览器连着时每 5 秒整份重算；记录或会话变化时也重算。监视租约目录只当加速，目录不存在时先监视 `.local/agent/`，都不在就只靠 5 秒的重算；面板不建这些目录。
- **会话**：见 [herdr.md](herdr.md#面板的订阅与对账)。herdr 不阻塞服务开始监听。
- **通知**：通知任务的列表或状态变了（见“通知与会话页”）。通知自己的变化不再触发通知的现算。
- 重算单飞并合并：进行中又被要求重算时排一次在后面，等它的调用方拿到的是这次之后才开始的结果（写接口据此等到包含自己写入的数据）。
- **代码已更新**：每 5 秒比较 `git rev-parse HEAD:packages/dev-panel`、`HEAD:packages/nb-ui`、`HEAD:bun.lock` 与启动时的，不同就在 `/api/meta` 标 `codeChanged`。只改记录的提交不会触发。顶栏的提示写出重启命令：作为服务运行时是 `systemctl --user restart <单元>`，前台运行时是“在终端重启 nbdev panel serve”。不放重启按钮：面板不经 HTTP 结束自己。

## `panel serve` 与 `panel open`

`panel serve` 在前台运行：

1. 在 `.local/agent/run/panel.lock` 取面板锁（同一个主工作区已有面板在跑时报 `panel_running`）。
2. 绑定两个端口（被占时立刻报 `port_in_use`），写 `panel.json`；预热完成之前 `/api/*` 回 503，页面回“正在启动”。
3. 构建前端（见下；`--no-build` 跳过、用现有的 `dist/web`，`--static-dir` 用现成的产物目录），预热（记录与活动各算一遍），开始监视。
4. 收到 SIGINT、SIGTERM 或 SIGHUP 时收口：结束正在跑的 `git grep` 与 `vite build`，等进行中的投递结束（上限 12 秒），停服务，删自己的 `panel.json`，放锁，退出码 0。

`panel open` 读 `panel.json`，面板不在跑时报 `panel_not_running`；在跑就签一次性票据：

- 不带 `--print`：票据不进任何进程的命令行（`/proc/<pid>/cmdline` 对本机所有账户可读，别的账户能抢先兑换）。写一页跳转页 `open-<随机>.html`（独占创建、权限 600，内容只是 `location.replace(<登录链接>)`），目录是 `$XDG_RUNTIME_DIR/nbdev/`，没有这个变量时用主工作区的 `.local/agent/run/panel-open/`，目录权限 700；只把它的 `file://` 路径交给 `xdg-open`。每次 `panel open` 顺手删掉该目录里超过 10 分钟的跳转页（票据早已过期）。JSON 的 `data` 带 `page`（跳转页路径），`loginUrl` 为 null。
- `--print`：只打印登录链接（`data.loginUrl`），不写跳转页、不开浏览器。链接打印在自己的终端里，由开发者决定往哪儿粘。

## 常驻（t11）

包脚本把面板装成 systemd 用户服务（不进 nbdev 的命令面）：

```text
bun run --cwd packages/dev-panel install-service [-- --dry-run] [--port 4400] [--artifact-port 4401] [--target <checkout>] [--force] [--json]
bun run --cwd packages/dev-panel install-service -- --uninstall [--force] [--json]
```

- 单元 `nbdev-panel-<主工作区目录名>.service`（本机是 `nbdev-panel-neuro-book.service`），写在 `${XDG_CONFIG_HOME:-~/.config}/systemd/user/`；一个主工作区一个面板。安装写单元、`systemctl --user daemon-reload`、`enable --now`；卸载 `disable --now`、删单元、`daemon-reload`。`--dry-run` 只打印将写的文件与命令。
- `ExecStart` 是运行安装脚本的 bun 的绝对路径加主工作区 `packages/dev-panel/src/cli.ts` 的绝对路径，不经 shim（shim 可以被指到 worktree；用户管理器的 `PATH` 不保证有 `~/.local/bin`）。`Environment=NBDEV_PANEL_UNIT=<单元名>`：面板只凭它判断自己是服务（`INVOCATION_ID` 在 KDE 的终端标签页里也有）。`Restart=on-failure`，`RestartPreventExitStatus=2 3`（用法错误与冲突重启也不会好），`TimeoutStopSec=30`；没有 `After=default.target`。
- 同名文件不是本脚本写的（靠文件头的标记行认）不覆盖、不删，除非 `--force`；面板已经在跑时先提示停掉（`panel_running`）。`systemctl` 失败报 `systemctl_failed`。
- 日志 `journalctl --user -u <单元>`，停止 `systemctl --user stop <单元>`。服务写的 `panel.json` 照旧在主工作区的 `.local/agent/`，`nbdev panel open` 用法不变；重启之后要重新 `panel open`。本机 `Linger=yes`，注销后服务照常。

## 前端构建

产物不入库（根 `.gitignore` 已忽略 `dist/`），`panel serve` 发现输入变了就先构建：

- 输入：面板的 `src/web/`、`vite.config.ts`、`tsconfig.web.json`、`package.json`，nb-ui 整个包目录（排除 `node_modules`、`.nuxt`、`.output`、`playground`；面板直接用 nb-ui 的源码，还用到它的 `themes/` 与提交在包里的 `dist/nb-ui.css`），根 `bun.lock`。哈希写进 `dist/web/.build-hash`，一致就不构建。
- 输出到临时目录，成功后改名替换 `dist/web`：正在跑的面板的页面不会指向已被删掉的资源。
- 失败时有旧产物就用旧的（`/api/meta` 的 `build.failed`、命令的 `build_failed` 警告）；没有旧产物报 `build_failed`（退出码 1）。
- 合入 `master` 后由主工作区的代码运行，构建产物也在主工作区的包目录里；常驻见“常驻”。

## 前端

Vue 3 加 Vite（`src/web/`，产物 `dist/web/`），`vue-router` 用 history 模式（服务端回退到 `index.html`）。组件来自 nb-ui，主题是 nbook（`installTheme` 加 `applyColorway`，不经 Nuxt），明暗跟随系统，可在顶栏切换。面板自己的原子类与 nb-ui 一样不分层地引入（`tailwindcss/theme.css` 加 `tailwindcss/utilities.css`，preflight 单独放进 `@layer base`）：nb-ui.css 的原子类不在 `@layer` 里，分层的原子类会输给它，`hidden md:flex` 这类写法就失效了。

| 路由 | 页面 | 依据 |
|---|---|---|
| `/` | 首页：收件箱在上（提问带提问者，提问者的租约已失效时划掉）；进行中与未标的 Work 卡片，按最近更新排序；完成、搁置与超过 30 天没有更新的收进“其余 N 个” | t03 第三轮首页 A |
| `/work/:workId` | Work 页：目标、Task 表、现在谁在动、Work 级的文档与产物；状态切换、编辑 README、新建 Task 的入口 | t03 第三轮 Work 页 |
| `/work/:workId/task/:taskId` | Task 页：当前情况、README、执行 checkout 的候选与它上面的提交、产物与文档类产物、链到的 Spec、证据、谁在动；状态切换、编辑 README 的入口 | Proposal 第九节 |
| `/artifacts` | 产物列表：按类分组，可过滤 | t03 第二轮产物页 |
| `/artifact/:workId/:taskId/:artifactId` | 产物页：左边是产物来源上的沙箱 iframe（`sandbox="allow-scripts allow-forms allow-popups"`，不给同源），右边是答复表单与问题侧栏；切版本只切题表，iframe 上标“页面是当前版本”；Work 级产物的 `taskId` 写 `-`。答复成功后侧栏多一块“通知”：这份答复要通知谁、在等什么、发出去了没有，随推送更新；提问的会话已经换了时弹小窗一次（t11） | t03 第二轮产物页 |
| `/docs?checkout=&path=&prefer=` | 文档页：左边按类型的树与 checkout 切换（不是主工作区时标出来、列出与 master 的差异，可以只看有差异的），右边渲染 Markdown；`prefer` 是从 Task 页带来的执行 checkout 候选 | t03 第二轮文档页 |
| `/live/sessions?pane=` | 会话：最上面是通知（排队的、要处理的、最近 24 小时发过的，t11）；持有租约或运行的会话（状态与运行分开列）、无主的运行、本仓库里的其它 Agent pane、不在本仓库的会话、herdr 的状态。`?pane=` 选中一格会话，显示屏幕末尾（打开时与每次发送后各读一次，不轮询）、输入框与按键（t11） | t03 第三轮会话页左半边 |
| `/live/checkouts` | checkout：分支、HEAD、是哪个 Work 的执行 worktree、路径 | Proposal 第九节 |
| `/search?q=` | 搜索结果：流式出现，按 checkout 分组，截断时标出 | t03 第二轮顶栏 |
| `/new?workId=` | 新建 Work 或 Task：表单与随填随变的预览（预计领到的号、要写的文件与内容、提交信息；号以提交时为准）；结果区写实际领到的 id，与预览不同时多一行说明 | t03 第三轮新建表单 |
| `/edit?path=` | 编辑主工作区里的一个文件：编辑与预览、打开时就提醒哪些分支改过它、根级治理入口显示非空行数与上限 | t10 |

- **外壳**：左栏（首页与收件箱、工作的 Work › Task 树、新建、产物、文档、现场）、顶栏（搜索、推送是否连着、代码已更新与重启命令、通知要处理的计数（会话已更换、没有可通知的会话，以及没点“知道了”的醒目尝试；点了去会话页）、审计未开启、前端构建失败、herdr 的状态、数据的新旧、明暗）。390 宽时左栏收进抽屉（nb-ui 的 `Drawer`）。
- **数据宿主**（`src/web/host/panel-data.ts`）：单例，全应用只有一条 `/ws`。页面经 `useResource(path, parts)` 取数，推送说哪块变了就重取订阅了它的资源；只接受最后一次请求的回应，且回应的 revision 不比已接受的旧；服务重启（实例 id 变了）或推送重连后全部重取。加载态延时 200 毫秒出现。`/api/*` 回 401 时整个面板只显示“用 nbdev panel open 打开”。`/ws` 断开后、每次重连之前先取一次 `/api/meta`：浏览器拿不到升级失败的状态码，面板重启后旧 cookie 作废，只靠重连会一直停在旧数据上；探测回 401 就显示上面那句并停止重连，否则照常重连（重连后的 `hello` 全部重取）。
- **偏好**（明暗、左栏各 Work 的展开、通知里“知道了”的尝试）只经 `src/web/host/prefs.ts` 一处读写 `localStorage`（键带 `nbdev-panel:` 前缀，读写包 try/catch）；组件不碰浏览器存储。`127.0.0.1` 与 `localhost` 各有一份偏好。
- **Markdown**（`src/web/host/markdown.ts`）：`marked` 转 HTML，DOMPurify 清洗（`FORBID_TAGS: style、form、input、button、textarea、select、iframe、object、embed`，`FORBID_ATTR: style`），再改写链接：相对路径按文档所在目录解析成仓库路径，`.md` 转成文档页，产物目录转成产物页，`.agents/works/` 下的其它文件与图片走产物来源（`/api/meta` 的 `artifactBase`），其余仓库文件面板不提供，链接去掉、图片不显示。
- **零件**（`src/web/parts/`）：`LoadState`、`StatusChip`、`StatusBar`、`LeaseChip`、`EphemeralFrame`、`BranchNote`、`WorkCard`、`InboxList`、`TaskTable`、`MarkdownView`、`QuestionPanel`、`ArtifactList`、`DocTree`、`CheckoutSwitch`、`SessionList`、`RunList`、`SearchResults`，t10 加 `AnswerForm`、`StatusSwitch`、`NewWorkForm`、`NewTaskForm`、`CreatePreview`、`DiffView`、`UncommittedDialog`、`FileEditor`、`WriteNotice`，t11 加 `NotifyStatus`、`ReplacedDialog`、`ScreenConfirmDialog`、`SessionConsole`，各有同名 `.md`。零件只吃 props、只发事件；页面与外壳是宿主。去别的页的入口是真实链接（`<a href>`，地址都由 `host/routes.ts` 拼），普通左键点击时零件 `preventDefault` 并发 `navigate`，由页面 `router.push`；中键与带修饰键的点击交给浏览器（新标签页、复制地址）。零件不进 Component Lab（Lab 在 NeuroBook 应用里，挂面板的组件就要让产品包依赖开发工具），状态在浏览器验收里用临时仓库的数据摆出来。
- **画法**（t03 第三轮已定）：持久的照常画实线的面；临时的（会话、租约、谁在动、运行）一律信息色虚线框，角上标“临时”，单独的租约是虚线胶囊，失效的划掉。没有字段的值显示“未标”；面板不推断状态，所以多数 Work 的计数条是“未标”的灰色。
- **写入的界面**（t10）：零件不发请求；写请求、预览请求、300 毫秒去抖、“2 秒后提示在等别的写入完成”的定时器、`beforeunload`、复制到剪贴板都在页面里（`host/writes.ts`、`host/status-change.ts`）。写请求的错误保留 `details` 与 `data`。字段校验直接导入核心的纯函数（`validateAnswerValue`、`SLUG_PATTERN`、标题与控制字符的规则），不复制规则。主工作区不能写、记录来自分支时，写入口隐藏或只读并写明原因。外壳不监听也不接受来自产物 iframe 的消息：答复只经侧栏表单。错误码到界面动作：

| 情形 | 界面 |
|---|---|
| 提交中 | 按钮禁用；2 秒后提示“在等别的写入完成” |
| 200 | 成功；`changed: false` 写“内容没变，没有提交”；警告照列 |
| 400 | 字段级错误显示在字段旁（`details.field`、`details.problems`） |
| 409 `hash_mismatch` | 状态切换：重新取数并说明；编辑：取现在的版本，与打开时的原文按行比（前端算，`host/line-diff.ts`），显示“别人改了什么”，给“载入新版本（丢掉我的改动）”与“复制我的改动” |
| 409 `uncommitted_changes` | 差异对话框（已暂存与工作区分两段），“取消”与“连同这些改动一起提交” |
| 409 `staged_rename`、`changed_after_write` | 说明原因，不给提交；后者列出已写入未提交的路径 |
| 409 其它（`branch_maintained_record`、`main_not_on_master`、`main_busy`、`work_not_committed`、`task_not_committed`、`task_closed`、`question_closed`、`artifact_closed`、`stale_version`、`not_editable`） | 显示错误说明；数据已过时的（`stale_version`、`question_closed` 等）重新取数 |
| 503 `lock_timeout`、`warming_up` | 什么都没写，给“重试” |
| 500 `commit_failed` | “已写入、没有提交”，列出路径与补救办法 |
| 网络错误、连接被断开 | “结果未知”，不给“重试”，按页面核对一次：产物页与状态切换重新取数；编辑页重取文件，变了就显示差异并写明“多半是你刚才那次保存已经生效”，没变就写“没有生效，可以再保存”；新建页锁住表单，直到开发者确认上一次建好了没有 |

- **编辑页的未保存改动**：站内跳转（左栏、链接、改 `?path=`）用 `onBeforeRouteLeave`、`onBeforeRouteUpdate` 拦，关标签页与刷新用 `beforeunload` 拦。保存成功后编辑器换成服务端写下的最终文本与新哈希（README 的 `updated` 被核心改过）。
