# 面板

开发者项目面板的合同：两个来源、登录、请求校验与路径守卫、接口、缓存与刷新、`panel serve` 与 `panel open`、前端构建。命令行合同见 [cli.md](cli.md)，文件格式见 [file-formats.md](file-formats.md)，herdr 的订阅与对账见 [herdr.md](herdr.md#面板的订阅与对账)。本片（t09）只读，不写任何项目数据。

## 两个来源

| 来源 | 地址 | 内容 |
|---|---|---|
| 面板 | `127.0.0.1:4400` | 前端页面（`dist/web`，单页路由回退到 `index.html`）、`/api/*` 的 JSON、`/ws` 的推送、`/login` 的一次性登录 |
| 产物 | `127.0.0.1:4401` | 只读的静态文件：`/a/<随机前缀>/<checkout key>/.agents/works/…`，只给 `.agents/works/` 下的文件，没有接口 |

- **只绑回环**：`--host` 只接受 `127.0.0.1` 与 `localhost`，别的地址（含 `0.0.0.0` 与 `::1`）报 `unsafe_host`；这台机器上绑不了的地址也报 `unsafe_host`。不收 IPv6：本机的 `lo` 关了 IPv6，有 IPv6 的机器上 Chrome 的 CSP 也写不了 IPv6 字面量，产物页嵌不进来。端口被占报 `port_in_use`，不自动换端口。
- **产物来源的随机前缀**在服务启动时生成，只经 `/api/artifact` 交给面板：网页猜不到地址，读不走只在本机、或只在未推送分支上的产物；有了它才能回 `Access-Control-Allow-Origin: *`（沙箱 iframe 是不透明来源，模块脚本、`fetch` 与字体都按 CORS 取）。`/a/<前缀>/_nbdev/` 是留给 t10 表单脚本的保留路径，本片回 404。
- 产物来源与面板来源用同一种主机名：请求是 `localhost:4400` 时，iframe 指 `localhost:4401`。

## 登录

回环对本机的其他账户与浏览器里的任意网页都开放（本机另有可登录的账户），所以 `/api/*` 与 `/ws` 都要登录。设备配对与分级在 t13。

1. `panel serve` 生成启动令牌，写进权限 600 的 `.local/agent/panel.json`。
2. `panel open` 读它、签一张一次性票据（`<nonce>.<过期时刻>.<HMAC>`，5 分钟过期，用一次作废），用 `xdg-open` 打开 `/login?ticket=…`（`--print` 只打印链接）。
3. 服务核对票据，换成会话 cookie（`nbdev_panel_<面板端口>`，`HttpOnly; SameSite=Strict; Path=/`），重定向到 `/`。会话只在本次服务实例里有效，重启面板后要重新 `panel open`。cookie 名带端口：cookie 不按端口区分，同一个浏览器登录两个面板（不同仓库，或开发时的演示面板）时，名字相同就会互相踢下线。

页面本身与静态资源不要求登录；`/api/*` 没登录回 401（`unauthorized`），前端据此提示“用 nbdev panel open 打开”。

## 请求校验

两个来源都按顺序做，失败一律 4xx，不进业务逻辑：

1. 带转发头（`Forwarded`、`X-Forwarded-*`、`X-Real-IP`、`Tailscale-User-Login`、`Tailscale-User-Name`）的拒绝（403）：跨设备上线之前不接受经代理转进来的请求。
2. `Host` 必须是本来源的 `127.0.0.1:<port>` 或 `localhost:<port>`（421，防 DNS 重绑定；Bun 按 `Host` 头拼 `req.url`，所以直接比 `Host` 头）。
3. URL 解析器先按规范折叠 `.` 与 `..`（含 `%2e` 写法），折叠后的路径照常过下面的检查，所以 `/../x` 等同 `/x`、出不了根（`/../../etc/passwd` 落到单页回退，回 `index.html`，不是那个文件）。剩下的段逐段解码：编码过的 `/` 与 `\`、解码出 NUL、不合法的百分号编码与空段回 400，不让解码错误变成 500。
4. 面板来源，按这个顺序：
   - `/api/*` 与 `/ws`（不论方法）先要求 `Sec-Fetch-Site` 是 `same-origin` 或 `none`（缺这个头的按 `none` 处理，只有浏览器的跨站请求会带 `cross-site`、`same-site`），再要求登录 cookie（401）。跨站的 `<img src=…/api/search?q=…>` 两道都过不去。
   - 然后，非 `GET`、`HEAD` 的请求要求同源的 `Origin` 加 `X-Nbdev-Csrf` 头（值是服务启动时生成、写进页面 `<meta name="nbdev-csrf">` 的随机令牌）。CSRF 令牌写在不要求登录的 `index.html` 里，本机任何账户都读得到：它只防浏览器里的跨站请求，不是本机账户之间的秘密，写请求靠的是前一步的登录。本片没有写接口，通过校验后回 405。
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

全是 `GET`。JSON 接口的外壳是 `{schema: "nbdev.panel-api/v1", ok, data, warnings, errors, instance, revisions}`：`instance` 是服务实例 id（重启后变），`revisions` 是各块数据（`records`、`activity`、`sessions`）的版本号；前端只接受更新的数据。预热完成之前回 503（`warming_up`），`/api/meta` 除外。

| 接口 | 内容 |
|---|---|
| `/api/meta` | 实例 id、启动时刻、是否预热完成、`codeChanged`（面板代码已更新，重启后生效）、前端构建是否失败、herdr 的状态、各块数据的刷新时刻与错误、产物来源的地址 |
| `/api/overview` | 首页与左栏：各 Work 与 Task 的摘要（状态、目标、最近更新、当前情况、来源、待答数、谁在动）、收件箱（提问带 `askedBy` 与 `askerActive`：提问者的租约是否还有效）、会话的计数（明细在 `/api/sessions`） |
| `/api/work/:workId` | Work 页：完整的 Work（Task 表、产物与文档类产物、谁在动）与相关会话 |
| `/api/task/:workId/:taskId` | Task 页：Task 摘要、README 原文、证据（第一层）、链到的 Spec、执行 checkout 的候选与选中的、执行 checkout 上的提交 |
| `/api/artifacts` | 产物列表：有发布记录的（设计稿、讲解与报告、审查、提问集）与没发布的、文档类产物、各 Task 的证据数 |
| `/api/artifact/:workId/:taskId/:artifactId?version=` | 产物页：版本列表、题与状态（`version` 只切换题表）、答复、确认、iframe 地址（产物来源上磁盘里的当前页面）、`unpublishedChanges`（磁盘内容与最新一版的 `contentHash` 不同）。Work 级产物的 `taskId` 写 `-` |
| `/api/docs/tree?checkout=` | 文档树（按类型分组）；不是主工作区时附与 master 的差异（见下） |
| `/api/docs/file?checkout=&path=` | 一份文档：原文、frontmatter、标题、这个 checkout 上最近 5 次提交、哪些已检出的分支改了它（`changedIn`） |
| `/api/sessions` | herdr 的状态（可用、订阅还是轮询、漏事件数）与 pane（是否开在本仓库里）、会话持有的租约与它的运行、无主的运行、checkout 列表（是哪个 Work 的执行 worktree） |
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

## 缓存与刷新

页面请求只读内存里的缓存，从不现算整份 `status`。分三块各自刷新，变了就经 `/ws` 推“哪块变了”；只有显示用到的字段变了才增加 revision（运行的子进程数随时在变，不算）。每块的重算单飞并合并（进行中又来变化只再排一次）；失败时保留上一份，在 `/api/meta` 的 `parts.<块>.error` 标出。

- **记录**（Work、Task、收件箱、撞号）：`fs.watch` 递归监视主工作区的 `.agents/works/`（去抖 300 毫秒，过滤 `evidences/`）；每 5 秒看一次 `git worktree list` 与 master 的 sha，变了才重算（过渡期判定的已提交部分按 master 与各 checkout 的 HEAD 缓存）；有浏览器连着时每 30 秒兜底整份重算，顺带重算各 worktree 未提交的记录改动。
- **活动**（租约、会话、运行）：租约是否有效是读取时现算的（会话退出、过期、Task 关闭都不碰租约文件），所以有浏览器连着时每 5 秒整份重算；记录或会话变化时也重算。监视租约目录只当加速，目录不存在时先监视 `.local/agent/`，都不在就只靠 5 秒的重算；面板不建这些目录。
- **会话**：见 [herdr.md](herdr.md#面板的订阅与对账)。herdr 不阻塞服务开始监听。
- **代码已更新**：每 5 秒比较 `git rev-parse HEAD:packages/dev-panel`、`HEAD:packages/nb-ui`、`HEAD:bun.lock` 与启动时的，不同就在 `/api/meta` 标 `codeChanged`。只改记录的提交不会触发。

## `panel serve` 与 `panel open`

`panel serve` 在前台运行：

1. 在 `.local/agent/run/panel.lock` 取面板锁（同一个主工作区已有面板在跑时报 `panel_running`）。
2. 绑定两个端口（被占时立刻报 `port_in_use`），写 `panel.json`；预热完成之前 `/api/*` 回 503，页面回“正在启动”。
3. 构建前端（见下；`--no-build` 跳过、用现有的 `dist/web`，`--static-dir` 用现成的产物目录），预热（记录与活动各算一遍），开始监视。
4. 收到 SIGINT、SIGTERM 或 SIGHUP 时收口：结束正在跑的 `git grep` 与 `vite build`，停服务，删自己的 `panel.json`，放锁，退出码 0。

`panel open` 读 `panel.json`，面板不在跑时报 `panel_not_running`；在跑就签一次性票据，用 `xdg-open` 打开登录链接（`--print` 只打印）。

## 前端构建

产物不入库（根 `.gitignore` 已忽略 `dist/`），`panel serve` 发现输入变了就先构建：

- 输入：面板的 `src/web/`、`vite.config.ts`、`tsconfig.web.json`、`package.json`，nb-ui 的 `src/` 与 `package.json`（面板直接用 nb-ui 的源码），根 `bun.lock`。哈希写进 `dist/web/.build-hash`，一致就不构建。
- 输出到临时目录，成功后改名替换 `dist/web`：正在跑的面板的页面不会指向已被删掉的资源。
- 失败时有旧产物就用旧的（`/api/meta` 的 `build.failed`、命令的 `build_failed` 警告）；没有旧产物报 `build_failed`（退出码 1）。
- 合入 `master` 后由主工作区的代码运行，构建产物也在主工作区的包目录里；常驻与 systemd 单元在 t11。

## 前端

Vue 3 加 Vite（`src/web/`，产物 `dist/web/`），`vue-router` 用 history 模式（服务端回退到 `index.html`）。组件来自 nb-ui，主题是 nbook（`installTheme` 加 `applyColorway`，不经 Nuxt），明暗跟随系统，可在顶栏切换。面板自己的原子类与 nb-ui 一样不分层地引入（`tailwindcss/theme.css` 加 `tailwindcss/utilities.css`，preflight 单独放进 `@layer base`）：nb-ui.css 的原子类不在 `@layer` 里，分层的原子类会输给它，`hidden md:flex` 这类写法就失效了。

| 路由 | 页面 | 依据 |
|---|---|---|
| `/` | 首页：收件箱在上（提问带提问者，提问者的租约已失效时划掉）；进行中与未标的 Work 卡片，按最近更新排序；完成、搁置与超过 30 天没有更新的收进“其余 N 个” | t03 第三轮首页 A |
| `/work/:workId` | Work 页：目标、Task 表、现在谁在动、Work 级的文档与产物 | t03 第三轮 Work 页 |
| `/work/:workId/task/:taskId` | Task 页：当前情况、README、执行 checkout 的候选与它上面的提交、产物与文档类产物、链到的 Spec、证据、谁在动 | Proposal 第九节 |
| `/artifacts` | 产物列表：按类分组，可过滤 | t03 第二轮产物页 |
| `/artifact/:workId/:taskId/:artifactId` | 产物页：左边是产物来源上的沙箱 iframe（`sandbox="allow-scripts allow-forms allow-popups"`，不给同源），右边是问题侧栏；切版本只切题表，iframe 上标“页面是当前版本”；Work 级产物的 `taskId` 写 `-` | t03 第二轮产物页 |
| `/docs?checkout=&path=&prefer=` | 文档页：左边按类型的树与 checkout 切换（不是主工作区时标出来、列出与 master 的差异，可以只看有差异的），右边渲染 Markdown；`prefer` 是从 Task 页带来的执行 checkout 候选 | t03 第二轮文档页 |
| `/live/sessions` | 会话：持有租约或运行的会话（状态与运行分开列）、无主的运行、本仓库里的其它 Agent pane、不在本仓库的会话、herdr 的状态 | t03 第三轮会话页左半边 |
| `/live/checkouts` | checkout：分支、HEAD、是哪个 Work 的执行 worktree、路径 | Proposal 第九节 |
| `/search?q=` | 搜索结果：流式出现，按 checkout 分组，截断时标出 | t03 第二轮顶栏 |

- **外壳**：左栏（首页与收件箱、工作的 Work › Task 树、产物、文档、现场）、顶栏（搜索、推送是否连着、代码已更新、前端构建失败、herdr 的状态、数据的新旧、明暗）。390 宽时左栏收进抽屉（nb-ui 的 `Drawer`）。
- **数据宿主**（`src/web/host/panel-data.ts`）：单例，全应用只有一条 `/ws`。页面经 `useResource(path, parts)` 取数，推送说哪块变了就重取订阅了它的资源；只接受最后一次请求的回应，且回应的 revision 不比已接受的旧；服务重启（实例 id 变了）或推送重连后全部重取。加载态延时 200 毫秒出现。`/api/*` 回 401 时整个面板只显示“用 nbdev panel open 打开”。
- **偏好**（明暗、左栏各 Work 的展开）只经 `src/web/host/prefs.ts` 一处读写 `localStorage`（键带 `nbdev-panel:` 前缀，读写包 try/catch）；组件不碰浏览器存储。`127.0.0.1` 与 `localhost` 各有一份偏好。
- **Markdown**（`src/web/host/markdown.ts`）：`marked` 转 HTML，DOMPurify 清洗（`FORBID_TAGS: style、form、input、button、textarea、select、iframe、object、embed`，`FORBID_ATTR: style`），再改写链接：相对路径按文档所在目录解析成仓库路径，`.md` 转成文档页，产物目录转成产物页，`.agents/works/` 下的其它文件与图片走产物来源（`/api/meta` 的 `artifactBase`），其余仓库文件面板不提供，链接去掉、图片不显示。
- **零件**（`src/web/parts/`）：`LoadState`、`StatusChip`、`StatusBar`、`LeaseChip`、`EphemeralFrame`、`BranchNote`、`WorkCard`、`InboxList`、`TaskTable`、`MarkdownView`、`QuestionPanel`、`ArtifactList`、`DocTree`、`CheckoutSwitch`、`SessionList`、`RunList`、`SearchResults`，各有同名 `.md`。零件只吃 props、只发事件；页面与外壳是宿主。零件不进 Component Lab（Lab 在 NeuroBook 应用里，挂面板的组件就要让产品包依赖开发工具），状态在浏览器验收里用临时仓库的数据摆出来。
- **画法**（t03 第三轮已定）：持久的照常画实线的面；临时的（会话、租约、谁在动、运行）一律信息色虚线框，角上标“临时”，单独的租约是虚线胶囊，失效的划掉。没有字段的值显示“未标”；面板不推断状态，所以多数 Work 的计数条是“未标”的灰色。
