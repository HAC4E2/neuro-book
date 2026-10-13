# t12 实施计划：herdr 网页终端

草案，交主 Agent 与设计审查（编码子代理 2026-10-13 写）。范围以 [实施计划的 t12 一节](../t03-design/plan.md#t12-herdr-网页终端)（场景 1 到 5）与本目录的 [README](README.md) 为准；设计依据是 [Proposal](../../../../../docs/proposals/dev-panel.md) 第七节（herdr 网页终端）、第八节（访问与安全，其中第 7 条白名单、第 9 条审计）与决定 7；终端流的行为依据 t03 的 [会话托管调研](../t03-design/session-hosting-research.md) 第二节（方案 A）与第一节末的缺口 1、3、4，以及本计划开写前在命名会话里的实测（下文“计划前的实测”）；界面依据 t03 [评审板](../t03-design/artifacts/review/index.html) 第三轮的会话页（`r3/sessions.html`：“观看中”“你已接管键盘”两种状态条）；已有代码是 t11 合入的集成分支 `0e3a40c9e`（herdr 客户端与白名单、会话页的屏幕与输入框与按键、审计、投递判据、按 pane 的互斥）。

## Context

- **要解决的问题**：t11 之后，会话页只能看一份屏幕末尾的快照（`agent.read --source visible`，打开时与发送后各读一次），只能经 `agent.prompt` 发整段文字、经 `agent.send_keys` 发固定的几个键。开发者要在面板里看会话的实时终端，必要时接管键盘直接操作（决定 7），离开时把控制权交还；手机上要能读、能发。
- **前提**：t04、t06 到 t11 已在集成分支上（t11 推到 `0e3a40c9e`）。已有：
  - `src/herdr/client.ts`：socket 客户端与 `HERDR_PANEL_METHODS`（名单外的方法在客户端拒绝）；
  - `src/server/herdr-monitor.ts`：快照、订阅、对账、按需轮询；
  - `src/server/delivery.ts`、`src/server/notifier.ts`：投递判据、通知循环、按 pane 的互斥 `PaneLocks`；
  - `src/server/session-io.ts`：会话页的屏幕末尾、输入框（`agent.prompt`）、按键（`agent.send_keys`，两步确认、Ctrl+C 限速）；
  - `src/core/audit.ts`：审计（意图加结果两行、`actionId`、串行写），审计没初始化时不开放替开发者打字的动作；
  - 面板登录（cookie）、`/ws` 推送、Host、Origin、`Sec-Fetch-Site` 与 CSRF 的校验。
- **工作方式**：同前。集成分支 `feat/w00022-dev-panel`，每片单独提交，编码子代理不 push。测试与演示只用假 herdr 与命名 herdr 会话 `nbdev-test`；**不对默认 herdr 里的任何真实 pane 起 control、接管或输入**，只有开发者在场的验收例外。开发者在主工作区起的面板（端口 4400、4401）与它的 `panel.json`、锁都不碰；演示面板一律用临时仓库、避开这两个端口。
- **范围**：xterm.js 渲染 herdr 的终端帧；每个浏览器连接一个子进程；接管键盘、resize、输入、释放；按键按钮；手机的纯文本视图加输入框；接管前的提示；审计。**不做**：鼠标事件；在面板里启动新会话；跨设备（t13，开发者 2026-10-13 定别的设备登录后与本机权限相同）。

## 计划前的实测（2026-10-13，命名会话 `nbdev-test`）

为把接口写准，在命名会话里起 bash pane 与名为 `claude` 的假界面（t11 L4 的 `tests/fixtures/fake-claude-tui.py`）做了几项探测，用完已停 server、删会话，没有残留进程。对默认 server 没有起 observe 或 control。脚本在会话临时目录 `t12/`（不入库）。

| 项 | 结果 |
|---|---|
| 命令行 | `herdr terminal session observe <target> [--cols N] [--rows N]`、`herdr terminal session control <target> [--takeover] [--cols N] [--rows N]`；**target 必须写在选项前面**（写在后面报“unknown option”、退出码 2）。客户端 0.9.3 |
| socket | 不带 `--session` 时认 `HERDR_SOCKET_PATH`：面板可以把自己用的 socket 交给子进程，子进程的环境只给 `HOME`、`PATH`、`HERDR_SOCKET_PATH` |
| 帧 | stdout 一行一个 JSON：`{"type":"terminal.frame","seq":N,"full":bool,"width":W,"height":H,"encoding":"ansi","bytes":"<base64>"}`；第一帧 `full: true`（以 `\e[2J\e[1;1H` 重画整屏），之后是增量。帧里的私有模式只有 `?2026`（同步输出）与 `?25`（光标显隐），**没有应用开的模式**：假界面开了 bracketed paste（`?2004h`），帧里没有 |
| 结束 | `{"type":"terminal.closed","reason":"…"}` 后退出码 0。原因原文：`detached`（`terminal.release` 或 stdin 关掉）、`terminal attach taken over`（被别人 `--takeover`）、`terminal attach failed: terminal <id> already has an attached client; retry with --takeover`（已有控制者时不带 takeover） |
| 输入 | stdin 一行一个 JSON：`{"type":"terminal.input","text":"…"}` 或 `{"type":"terminal.input","bytes":"<base64>"}`（二选一）；`{"type":"terminal.resize","cols":C,"rows":R}`；`{"type":"terminal.release"}`。写错的行只在 stderr 报“input ignored”，进程不退 |
| 尺寸 | control 一连上就把真实终端改成它的 `--cols`、`--rows`（`stty size` 立刻变）；**不带尺寸时用缺省的 120×40，不是原来的尺寸**；`terminal.resize` 立刻生效；释放后尺寸保持。observe 只按自己的视口出帧，不改真实尺寸；视口比真实终端大时补空白、小时裁掉右下，帧里分不出哪些是补的；不带尺寸时也是 120×40 |
| 真实尺寸 | `pane.get` 的 `scroll.viewport_rows` 是真实行数（control 改了尺寸它跟着变）；列数拿不到。`pane.layout` 给的是 herdr 布局里这格的矩形，只在 TUI 决定尺寸时等于真实尺寸 |
| 控制者 | 同一终端同时只有一个 control；TUI 客户端不占这个名额。在 pty 里挂上 TUI（100×30）之后，web 的 control 不断、尺寸不回；**TUI 里打的字照样进 pane**；control 释放后 TUI 把尺寸改回它的布局（27 行） |
| 控制期间的 API 写入 | control 连着的时候，`agent.prompt` 照样粘贴加回车写进 pane，`agent.send_keys` 也照样写；读屏判定（`agent.explain`）照常。也就是说，**接管只独占“控制端”这个名额并改尺寸，不独占输入** |
| 收口 | `terminal.release`、stdin 关掉、SIGTERM、SIGKILL 之后控制权都释放（随后不带 takeover 的 control 能连上）。observe **不读 stdin，stdin 关掉不退出；读端消失以后、pane 有输出时也没有退出**（孤儿会一直留着）。用 `setpriv --pdeathsig TERM -- herdr …` 起：Bun 父进程被 SIGKILL 后子进程随即被收掉；直接起的同一命令留了下来 |
| 开销 | 一个 observe 子进程常驻内存约 6.6 MB、1 个线程；100×30 的整屏帧约 5.8 KB（base64 之后）。control 写入到 observe 收到帧约 3 毫秒 |
| 读历史 | 假界面上 `agent.read --source recent_unwrapped` 可用；但真实 Claude 跑在备用屏上，读多于可见行要滚动它的界面、工作中直接报错（t11 设计审查 S4），这一条没有在真实 Claude 上试 |

没有验证、留给实施的 S0（见切片）：target 写 terminal id 行不行；默认 server 0.9.1 上 observe 与 control 能不能用；多个 observe 时 herdr server 的开销；TUI 改尺寸时有没有事件。

## 设计审查的处理

设计审查（`evidences/design-review.txt`，0 阻断、2 重要、17 建议）全部采纳，主 Agent 的处理意见见本节。**本节与下文正文冲突时以本节为准**，正文保留为草案原貌；“与 Proposal、实施计划的不一致”“风险”“需要开发者批准或参与”“推迟”四节已按本节改写。

### 尺寸（I1、S1）

- **真实尺寸从 pane 的 pty 读**：`pane.process_info` 取 `shell_pid` → `readlink /proc/<shell_pid>/fd/0` 得到 `/dev/pts/N`（只认这个形状）→ `stty -F /dev/pts/N size`（只读的 `TIOCGWINSZ`，不改终端；面板不是会话首进程，打开 tty 不会成为它的控制终端）。审查实测与 pane 里的 `stty size` 一致；`pane.layout` 的矩形含边框、TUI 不挂时是无头缺省值，**不再用**，也不进白名单。
- **读不到**（pid 没了、fd 0 不是 pty、`stty` 失败）：观看照常，observe 用 120×40，状态条写“尺寸不确定，可能裁切”；接管照常；**释放时不改回尺寸**，释放行记 `restored: false`，状态条写明原因。
- **观看**期间每 5 秒按上面的办法复查（审查实测 TUI 改尺寸没有任何事件），变了就重起 observe。
- **接管期间不复查、没有“重新适配”按钮**（S1）：审查在开发者现在的组合（0.9.1 server 加 0.9.3 TUI）上实测，control 连着时 TUI 改窗口、移焦点都改不动这格的尺寸；release 之后 TUI 立刻改回自己的布局。
- 决定点 7 改为：尺寸来源换成 pty，读到了就在释放前改回，读不到就不改回。

### S0 与 0.9.1（I2、S13）

- **删掉“对默认 server 的真实 pane 起 observe”**，开发者先前对它的同意不再用。改用主工作区不入库的 0.9.1 二进制 `.local/agent/works/w00022-dev-panel/tasks/t12-web-terminal/herdr-0.9.1/herdr`（只读，不改不动）：在命名会话里把它当 server 起，用 0.9.3 客户端核对两条流；L4 加一组 0.9.1 server 的用例，路径不在时跳过并写明原因，二进制不进仓库。
- **bracketed paste 已核对**（S13，2026-10-13，在 pty 里起真实的 `claude` 2.1.296 与 `omp`，不发提示词，Claude 的费用一直是 `$0.0000`，录下启动后 8 秒的输出）：两者启动后都开着 `?2004h`（Claude 中途关过一次又重开，最后是开着）。Claude 另开了鼠标跟踪（`?1000h` 等）与备用屏，omp 关了应用光标键（`?1l`）。所以 Agent pane 在 xterm 本地打开 bracketed paste 成立。
- 对默认 herdr 只做只读的 socket 调用（`ping`、`session.snapshot`、`pane.list`、`pane.process_info`、`agent.get`），不起任何流。

### 子进程与收口（S2、S3、S4、S12、S17）

- **背压**（S2）：`ws.getBufferedAmount()` 超过 1 MiB 就暂停读这条连接的子进程 stdout，WebSocket 的 `drain` 回调里降到阈值以下再继续读；observe 与 control 同一做法，不重起、不释放。herdr 读端跟不上时自己合并帧（审查 E11）；Bun 停读之后还会先攒约几百 KB（实测 240 到 370 KB）才把背压传给子进程，所以一条连接的面板内存上限约 1 MiB 加 0.5 MiB。`send` 的返回值逐帧检查，丢了（返回 0）就关连接让页面重连，不带着缺帧的画面继续。
- **systemd 停止**（S3）：`install-service` 生成的单元加 `KillMode=mixed`（只给面板 SIGTERM，等它收口完再 SIGKILL 剩下的），注释写原因；补 L2 核对单元内容。`stop()` 先把中枢标成“正在退出”：此后子进程退出一律记 `panel_exit`，不回到观看、不重起；正在接管的先改回尺寸、release，再收子进程。
- **结束原因的归类**（S4）只看三样：第一行是帧还是 `terminal.closed`；这条流是不是我们发过 release 的；结束之后按 terminal id 在 herdr 的 pane 列表里这个终端还在不在。原因原文只作显示与日志。
  - 接管握手：不带 takeover、第一行就是 closed、终端还在 → `need_confirm`（“可能有别的程序在控制”）；终端不在 → `pane_closed`；带 takeover 仍是 closed → `error`，显示原文。
  - 接管中流结束、不是我们 release 的：终端还在 → `taken_over`（显示“被别处接管或断开”）；不在 → `pane_closed`。
  - 观看中流结束：终端还在 → 重起一次 observe（连续 3 次第一行就结束则关连接 4404）；不在 → 4404。
  - L3 的假命令行故意换一种原因文案，断言归类不变。
- **socket**（S12）：`terminal session` 命令不连 `HERDR_SOCKET_PATH` 指的 JSON 接口，而是连旁边推出来的 `<socket 去掉 .sock>-client.sock`（TUI 的私有协议），不在就直接失败、不退回默认会话；`sun_path` 最长 108 字节，推出来的路径超长会报错。写进 `docs/herdr.md`；L4 核对命名会话推出的路径不超过 107 字节。白名单管不到命令行发给 server 的内容，只能靠只拼两种参数。
- **审计里只有接管、没有释放**（S17）：`docs/file-formats.md` 写明“`takeover` 结果为 `attached`、同一 `actionId` 没有 `release` 行：面板在接管中异常退出，控制权已随子进程（pdeathsig）释放，尺寸没有改回”；面板启动时不补写。

### 按 terminal id 记（S5）

- 子进程的 target 一律用 terminal id（审查实测 0.9.1、0.9.3 都可以，pane 跨 workspace 移动换 pane id 时流不断）。
- 中枢的连接表、“正在接管”的登记、通知的 `waiting_takeover`、接口的 `pane_controlled` 都以 terminal id 为键。
- **t11 的 `PaneLocks` 改按 terminal id 加锁**，三处取 terminal id 的办法：
  - 自动通知：任务视图本来就从监视器的 pane 列表找到 pane，带上它的 `terminalId`；
  - 手动发送：目标会话也从 pane 列表找（候选本来就来自那里）；
  - 会话页的文字与按键：URL 里是 pane id，按监视器的 pane 列表换成 terminal id；列表里没有（刚出现的 pane）时退回用 `pane:<pane id>` 作键。锁内的 `agent.get` 拿到真正的 terminal id 后再查一次“正被接管”，作最后一道。
- 同一面板里两个浏览器换手时，不先改回原尺寸再按新尺寸接管：把“接管前的尺寸”交给新的接管者，释放时再改回。

### 连接与安全（S6、S9、S10、S16）

- **升级前**只做与 `/ws` 相同的五道安全校验（转发头、Host、登录、`Sec-Fetch-Site`、`Origin`），失败回 HTTP 4xx。**升级之后**立刻核 pane 是本仓库里 herdr 认得出的 Agent pane、terminal id 对得上、上限，不过就以 4403、4404、4409 关闭并带原因，页面显示原因。
- **审计只挡接管**：审计不可用时 `takeover` 回 `{t: "error", code: "audit_unavailable"}`，连接照常观看。
- **页面切到后台**（S9）：接管先释放；观看也停（页面关掉终端连接），切回来再连，第一帧就是整屏。
- **t13 预留**（S10）：每条终端连接记下升级时的登录会话 id（`PanelAuth` 加 `sessionOf(cookie)`）与设备（t12 一律 `local`）；中枢提供“关掉某个登录会话的全部终端连接（接管先释放）”的入口，t12 只在面板退出时用；审计行的 `device` 与 `state` 消息里的控制者都从连接取。
- **websocket 回调按连接种类分派**（S16）：`SocketData` 带 `kind: "panel" | "terminal"`。终端连接不进广播集合、不发 `hello`、不计入 `clientConnected`（不开 500 毫秒的 pane 轮询）；`/ws/terminal` 的 `Origin` 核对与 `/ws` 相同。
- **断线重连**沿用 `/ws` 的做法：先取 `/api/meta`，回 401 就停止重连。

### 接管的握手与范围（S7、S8、S14）

- **握手有时限**（S7）：等第一行最多 5 秒，超时就按收口阶梯结束子进程、回 `error: takeover_timeout`、审计结果 `failed`。握手期间占着这格的锁，5 秒之后一定放开；L3 用“连上之后一行都不出”的假命令行测，并断言之后同一格的自动通知照常发出。
- **只对 Agent pane**（S8）：t12 的观看与接管都只开放给本仓库里 herdr 认得出 Agent（有会话键）的 pane；普通 shell pane 推迟到 t14，与“在跑”的开发服务一起做。观看也限 Agent pane 的理由：会话页只列 Agent pane，没有 shell pane 的入口；Agent pane 有会话键，页面看到的与服务端核对的是同一个会话，换了会话（`/clear`）能发现；shell pane 的入口、按钮与字节表要一起设计，归 t14。
- **措辞**（S14）：herdr 不拦任何 API 写入。接管期间 herdr 那边的键盘、别的程序、会话自己的 herdr 命令行（`herdr agent prompt`、`pane send-text`）都能写进这格；面板只保证自己不发。接管提示写“herdr 那边（键盘与其它程序）照样能写进来”。

### 前端（S15）

- 终端配色在运行时读：在一个带暗色主题作用域的探针元素上 `getComputedStyle` 读背景、前景、光标、选区与红、绿、黄、蓝四个状态色；其余 ANSI 色用 xterm.js 的缺省值，不写字面颜色；`TerminalView.md` 写明。

### 验收（S11、S16）

- 场景 3 的判据换成能区分“已释放”的两条：不带 takeover 的 control 能连上；在 pty 里挂一个 TUI，TUI 改窗口尺寸之后 pane 的 `stty size` 跟着变（接管中不变）。不用“TUI 打字进 pane”。
- 补 L3 的失败路径：握手超时（S7）、尺寸读不到时不改回（I1）、原因文案变了归类不变（S4）、hidden 后 1 秒内收掉子进程（S9）、`stop()` 期间子进程先退出记 `panel_exit`（S3）、背压时内存有上限且帧序号连续（S2）。
- **开发者在场那一步**（S11）改成：
  1. 用常驻的面板（或前台 `nbdev panel serve`）打开会话页，选一格自己挑的、空闲的 Claude 会话，看实时终端是否与 herdr 里的一致；
  2. 点“接管键盘”，读提示后确认；看 herdr 那边这格的尺寸是否变成网页的尺寸；
  3. 在网页终端里用输入法打一句中文，确认会话的输入框里出现了，再用 Backspace 删掉；Esc 按钮只按一次，若打开了菜单再按一次 Esc 关掉；
  4. 切到别的标签页再切回来：状态条应是“观看中”，没有自动重新接管；herdr 那边尺寸改回原样；
  5. 把观察告诉主 Agent；主 Agent 核对 `~/.config/nbdev/audit.jsonl` 里有这次的 `takeover` 意图、结果与 `release`（原因 `hidden`），释放行没有输入内容。

### 决定点的改动

- 2：同意。`docs/panel.md` 写明与 t11 决定点 6（输入框与通知的文字全文进审计）为什么不同：那是一条一条、开发者看着发出的消息；接管是连续的键盘流，会有 sudo、ssh 的密码，Proposal 第八节第 9 条本来就写“文字或长度”。也写明跨设备之后审计回答不了“打了什么”。
- 5：只开放本仓库里的 Agent pane，普通 shell pane 推迟到 t14（S8）。
- 7：尺寸来源换成 pty，读不到就不改回（I1）。
- 9：先不带 `--takeover`、请开发者确认再抢；归类不看原因文案（S4）。
- 其余照推荐。

### 切片（替换正文的切片表）

| 切片 | 内容 |
|---|---|
| S0 探针 | 已做：bracketed paste（见上）。实施中做：假界面 pane 的 `/proc/<shell_pid>/fd/0` 是 pty 且 `stty -F` 与 pane 里一致；0.9.1 二进制当 server 时两条流可用（并入 L4） |
| S1 herdr 流适配 | `src/herdr/streams.ts`（白名单的两种参数、terminal id 作 target、`setpriv`、三个环境变量、逐行解析、暂停读、收口阶梯）；`src/server/terminal-size.ts`（pty 尺寸）；`NBDEV_HERDR_BIN`；`install-service` 加 `NBDEV_HERDR_BIN` 与 `KillMode=mixed`；`PaneLocks` 改按 terminal id；新错误码 `pane_controlled` |
| S2 终端中枢 | `src/server/terminal-hub.ts`、`/ws/terminal` 与按种类分派的 websocket 回调、`PanelAuth.sessionOf`、通知与会话页的互斥、`/api/meta.terminal` |
| S3 前端 | xterm.js、`TerminalView`、`TerminalTextView`、`TakeoverDialog`、宿主模块；会话页接上 |
| S4 文档 | herdr、panel、file-formats、cli |
| S5 验收 | L4（0.9.3 与 0.9.1 两组）、浏览器（临时仓库加命名会话） |

## 关键设计

### 一、子进程：只用 herdr 命令行的两条流

- **命令**：观看用 `herdr terminal session observe <target> --cols C --rows R`；接管用 `herdr terminal session control <target> [--takeover] --cols C --rows R`。终端流不在 socket 的 JSON 接口里，只能经命令行子进程拿到（调研第一节）。
- **起法**：`setpriv --pdeathsig TERM -- <herdr 的绝对路径> terminal session …`，`Bun.spawn`，stdin、stdout、stderr 都是管道，不需要 pty（调研实测）。
  - 环境只给 `HOME`、`PATH`、`HERDR_SOCKET_PATH=<面板用的 socket>`，不继承面板的其它变量（`HERDR_SESSION`、`CLAUDE*` 等）。
  - herdr 的路径：环境变量 `NBDEV_HERDR_BIN`，没有就 `Bun.which("herdr")`。`install-service` 生成的单元加一行 `Environment=NBDEV_HERDR_BIN=<安装时的绝对路径>`：用户管理器的 `PATH` 不保证有 `~/.local/bin`（t11 S6）。
  - 没有 `setpriv`（util-linux）时终端功能整个关掉，`/api/meta` 写明原因：没有它，面板异常退出会留下收不掉的 observe（实测）。
- **白名单**：适配层只拼这两种参数（`observe`、`control`，参数只来自校验过的 pane、整数尺寸与布尔的 takeover），不接受任意子命令；新常量 `HERDR_PANEL_STREAMS` 钉在测试里。另给面板的 socket 白名单加两个只读方法 `pane.get`（真实行数、terminal id）与 `pane.layout`（布局里的列数）。
- **解析**：逐行 `JSON.parse`，只认 `terminal.frame` 与 `terminal.closed`；字段不对的行丢掉并记日志（不按原因文案分支：`closed` 的原因只用于显示，归类按“这条流是不是我们自己 release 的、有没有发过 takeover”）。帧的 `bytes` 不解码，原样转给浏览器。stderr 收进面板日志（截断）。
- **一个浏览器连接一个子进程**：连接处在“观看”时是 observe，处在“接管”时是 control（control 自己也出帧，接管期间不再要 observe）。
- **收子进程**：
  - 连接关闭、标签页关掉、切到后台的释放、面板退出，都走同一个收口：control 先 `terminal.release`、关 stdin；observe 直接 SIGTERM；1 秒不退再 SIGKILL，等到 `exit` 才算收完。
  - 面板被 SIGKILL 时靠 `pdeathsig`；作为服务运行时 systemd 停单元也会收整个 cgroup。
  - control 被收掉以后控制权一定释放（实测四种方式都释放）。

### 二、观看

- **尺寸**：observe 的视口要等于真实终端的尺寸，否则裁切或补空白（实测）。行数取 `pane.get` 的 `viewport_rows`；列数取 `pane.layout` 里这格的宽度；这格正被本面板接管时取接管的尺寸（面板自己设的，记在内存里）。都取不到时用 120×40，状态条写“尺寸不确定，可能裁切”。
- 观看期间每 5 秒看一次这两个值（只在有人看这格时），变了就重起 observe（新的第一帧是整屏）；本面板接管或释放改了尺寸时，立刻通知看这格的其它连接重起。
- **多个浏览器看同一格**：各起各的 observe，互不干扰，不改尺寸（调研与实测）。资源按连接算：每个约 6.6 MB 内存、1 个线程，加上 herdr server 为每个观看者算增量的开销（S0 测）。上限：一格最多 4 个连接，整个面板最多 16 个，超了拒绝并写明原因。
- **背压**：浏览器读得慢、WebSocket 积压超过 1 MiB 时，结束这个 observe，等积压清空后重起（新的第一帧是整屏）；增量帧丢不得，丢了画面就错。接管期间积压时只停读、不丢帧（control 不能重起而不重新抢控制权），积压超过 4 MiB 就释放并回到观看。
- **断线重连**：重起一个 observe，第一帧就是整屏，面板不缓存屏幕。重连之后只恢复观看，**不自动重新接管**。

### 三、接管键盘

- **前提**：审计可用（与 t11 的文字、按键一样，没初始化就不开放）；pane 在本仓库的 checkout 里；页面看到的 terminal id（Agent pane 另加会话键）与紧贴接管前读到的一致。
- **接管前的提示**（模态，两步确认）：
  - 终端会改成网页的尺寸（显示 C×R 与现在的尺寸），herdr 那边会重排；释放时改回现在的尺寸；
  - **接管期间 herdr 里的键盘照样能打进这个 pane**，两边的输入会混在一起（实测 TUI 不被锁）；
  - 接管期间面板不自动投递通知；
  - 切到别的标签页、关掉页面、断线、15 分钟没有输入，都会自动释放。
- **时序**（服务端，在这格 pane 的互斥 `PaneLocks` 里做，等进行中的通知或按键发完）：
  1. 记下接管前的尺寸（行数 `pane.get`，列数 `pane.layout`），写审计意图；
  2. 起 control，**先不带 `--takeover`**，`--cols`、`--rows` 取网页终端按字号算出的列数与行数；
  3. 第一行是帧：接管成功，结束这个连接的 observe，记下“这格由本面板的这个连接控制”，写审计结果，通知看这格的其它连接按新尺寸重起；
  4. 第一行是“already has an attached client”：别处（本面板之外的程序）已经在控制。把这句告诉页面，开发者再确认一次“抢过来”，才带 `--takeover` 重来。本面板另一个浏览器在控制时，提示写“另一个浏览器正在接管（何时起）”，确认后服务端先按“被接管”收掉那边，再接管；
  5. 键盘输入：页面把 xterm.js 的 `onData` 原样发来，服务端转成 `terminal.input` 的 `text`；
  6. 窗口尺寸变化：页面去抖 150 毫秒后发 `resize`，服务端夹在 20 到 400 列、5 到 200 行，转成 `terminal.resize`。
- **释放**（任何原因都走同一个收口）：
  - 先 `terminal.resize` 回接管前的尺寸（知道的话）；
  - 再 `terminal.release`，关 stdin，等子进程退出（不退就按上面的 SIGTERM、SIGKILL）；
  - 写审计的释放行；这个连接还开着就回到观看；通知看这格的其它连接按恢复后的尺寸重起；触发一次通知现算。
  - 原因记为：`user`（点释放）、`hidden`（页面切到后台）、`disconnect`（连接关闭）、`heartbeat`（15 秒没有心跳）、`idle`（15 分钟没有输入）、`taken_over`（被别人接管）、`pane_closed`（流以别的原因结束）、`panel_exit`（面板退出）。
- **离开、切后台、断线**：
  - 页面 `visibilitychange` 变成 hidden 时立刻发 `release`；`pagehide` 时关连接；
  - 接管期间页面每 5 秒发一次心跳，服务端 15 秒没收到就释放（网络断了但 TCP 还没断的情形）；
  - 连接关闭（Bun 的 WebSocket 空闲超时设 30 秒，浏览器会自动回 ping）就释放；
  - 面板退出时先释放全部接管、再收 observe。
- **被接管的提示**：
  - 别人带 `--takeover` 抢走时，我们的 control 收到“terminal attach taken over”：页面状态条变成“已被别处接管，回到观看”，并以 `taken_over` 写释放行；
  - 本面板的两个浏览器之间由服务端直接告诉被抢的那一边是谁抢的（设备在 t13 之前一律是 `local`，写开始时间）；
  - **herdr 的 TUI 收不到任何提示**（它不是控制端，herdr 也没有给它推的接口）。开发者在 TUI 那边看到的是这格的尺寸变了。是否另用 herdr 的 `notification.show` 在 TUI 上弹一条，见决定点 8（推荐不做）。
- **按键按钮在接管期间**：Esc、Ctrl+C、Shift+Tab、上、下、y、n、Enter 改成单击即发（接管期间键盘本来就直通，再两步确认没有意义），经终端连接发给服务端：Agent pane 用 `agent.send_keys`（herdr 按应用当前的模式编码，比网页自己拼字节准），普通 shell pane 用标准字节走 `terminal.input`。接管期间的按键不再逐条写审计，计入释放行的统计。
- **接管的对象**：本仓库 checkout 里的 pane，Agent 与普通 shell 都可以（例如开发服务的终端要按 Ctrl+C）；身份按 terminal id 核对，Agent pane 另核会话键。

### 四、与 t11 的互斥

实测：control 连着时 `agent.prompt` 照样把指针消息粘贴加回车写进 pane，和开发者正在键盘上打的字混在一起。所以互斥只能由面板自己保证：

- **通知**：`Notifier` 看到这格正被本面板接管，任务状态记为新的 `waiting_takeover`（“你正在接管这个会话，释放后再通知”），不自动投递；释放时触发一次现算，之后照常走稳定 3 秒与正向白名单。
- **手动发送与会话页的输入框**：这格被接管时回 409 `pane_controlled`（新错误码，退出码 3）；接管者自己的页面在接管期间隐藏输入框（直接在终端里打）。
- **会话页的按键接口**（`POST /api/sessions/:pane/keys`）：这格被接管时一律回 409 `pane_controlled`；接管者的按钮走终端连接（见上）。
- **先后**：接管、通知、文字、按键都在同一把按 pane 的互斥里排队：接管要等进行中的投递结束才开始；接管开始后，排在后面的投递在互斥里看到“被接管”就不发。
- **接管期间 `agent.prompt` 会怎样**（写进计划与 `docs/herdr.md`）：herdr 不拦，照样写；读屏与状态照常。本面板之外的程序（另一个面板、命令行脚本）调 `agent.prompt` 不受这条互斥约束；当前没有这样的程序。

### 五、安全与审计

- **谁能看、谁能接管**：登录了的浏览器。t13 之前只有本机（以及开发者用 SSH 端口转发过来的设备）能登录；开发者已定别的设备登录后与本机权限相同，所以不分级。只对本仓库 checkout 里的 pane 开放观看与接管（与 t11 “只投本仓库的 pane”一致，见决定点 5）。
- **WebSocket**：新开 `/ws/terminal?pane=<pane>&terminal=<terminal id>`，一个终端视图一条连接，连接关掉就收子进程、释放控制权（见决定点 1）。升级前做与 `/ws` 完全相同的校验：转发头拒绝、Host 白名单、登录 cookie、`Sec-Fetch-Site` 只认 same-origin 与 none、`Origin` 必须是本面板（拒绝 `null` 与缺省）。浏览器的 WebSocket 不能带自定义头，CSRF 由 `Origin` 加 `SameSite=Strict` 的 cookie 挡。接管是连接上的一条消息，不是单独的 HTTP 接口。
- **审计**（`~/.config/nbdev/audit.jsonl`，沿用 t11 的意图加结果）：
  - `takeover` 意图：pane、terminal id、会话键、请求的尺寸、接管前的尺寸、是否 `--takeover`；结果：`attached`、`controlled_elsewhere`、`failed`。
  - `release` 一行（与接管同一个 `actionId`）：原因、时长、输入条数、输入字节数、回车次数、粘贴次数与字节数、resize 次数、按钮次数。
  - **键盘内容不逐条写**（推荐，见决定点 2）：键盘流里会有密码与令牌，写进审计就把它们落了盘；审计要回答的是“谁在什么时候接管了哪个会话多久、打了多少”。需要内容时去会话的 transcript 与终端看。
  - 观看不写审计，只记面板日志（观看不往会话里写任何东西）。
- **终端帧里有屏幕上的一切，包括秘密**：密钥、令牌、开发者粘贴的内容都会经帧到浏览器。面板不缓存、不落盘、不写日志（日志只记帧数与字节数）；帧只在登录过的连接上传；验收截图只在临时仓库加命名会话上取。跨设备时（t13）帧会经 SSH 隧道或 Tailscale 到别的设备，与“面板登录等于 SSH 登录”（Proposal 第八节）一致。这一条写进 `docs/panel.md`。
- **输入的限制**：一条输入最多 64 KiB；只在接管状态下接受；尺寸是整数且在范围内；消息类型白名单，未知类型关连接（4400）。

### 六、前端：xterm.js

- **依赖**：`@xterm/xterm` 6.0.0、`@xterm/addon-fit` 0.11.0（都在 2025-12-22 发布，精确版本，不用 `^`）。不用 WebGL 与 canvas 插件，用 xterm.js 的 DOM 渲染（帧小、刷新慢，够用）；不加 `addon-unicode11`：帧里每个宽字符前都带绝对定位（调研实测），字宽表不一致也不会错位。
- **零件** `TerminalView`（同名 `.md`）：只吃 props 与发事件，WebSocket 与心跳在页面的宿主模块 `host/terminal-socket.ts` 里。
  - 观看：`disableStdin`，xterm 的尺寸跟着帧的 `width`、`height`（`term.resize`），字号按容器宽度缩放，最小 9px，再窄就在终端框里横向滚动；
  - 接管：字号固定 13px，用 fit 插件按容器算列数与行数，作为接管与 resize 的尺寸；
  - `scrollback: 0`：帧只是一屏，xterm 自己攒的回滚会误导人。
- **主题**：终端块一律暗色（评审板第三轮的做法），配色从 nb-ui 暗色的 token 取（背景、前景、光标、选区、状态色映射到 16 色），在 `host/terminal-theme.ts` 里集中定义；字体 `"Noto Sans Mono CJK SC", "Sarasa Mono SC", var(--font-mono), monospace`。页面的明暗切换不影响终端块。
- **帧里不带应用的终端模式**（调研缺口 4，实测）：
  - 光标键：xterm.js 默认发 `ESC [ A` 这一类；Claude 与 omp 都认（S0 用假界面核对一次 Claude 的 Ink 认不认 `ESC O A` 以外的写法，按钮走 `agent.send_keys` 不受影响）。
  - 粘贴：应用开没开 bracketed paste，网页不知道。Claude 与 omp 的 pane，页面在 xterm 本地打开 `?2004h`（只写给 xterm 自己，不发给 pane），粘贴就会被包起来，多行不会逐行回车；普通 shell 的 pane 不包，多行粘贴先弹确认“会逐行执行”。粘贴的文字先去掉 Esc 与其它 C0 控制字符（换行、制表符除外），挡住用 `\e[201~` 提前结束粘贴的路子。
  - 鼠标：帧里不开鼠标模式，xterm.js 不会发鼠标事件；拖动是本地选择文字（不做鼠标事件，Proposal 第七节）。
- **浏览器吞键**：
  - Ctrl+W、Ctrl+T、Ctrl+N 在 Chrome 里拦不住，状态条写明，并提示用 Alt+Backspace 删词；
  - Ctrl+C：有选中文字时复制、不发；没有时发 `\x03`；另给 Ctrl+Shift+C 复制、Ctrl+Shift+V 粘贴；
  - 按钮补上 Esc、Ctrl+C、Shift+Tab、上、下、y、n、Enter（不接管时仍走 t11 的按键接口与两步确认）。
- **中文输入法**：xterm.js 用隐藏的 textarea 接组合输入，提交之后才发给 pane。桌面 Chrome 加 fcitx5 只能由开发者在场时验；自动化用 Playwright 的 `insertText` 模拟“提交一段文字”。长一点的中文仍推荐用输入框（`agent.prompt`，带投递判据）。
- **超链接**：帧里有 OSC 8。`linkHandler` 只放行 `http`、`https`，用 `noopener,noreferrer` 在新标签页打开，别的协议忽略。
- **会话页的版式**：桌面上用实时终端取代 t11 会话详情里的屏幕末尾快照。上面是状态条（“观看中：只读的实时画面，键盘在别处”与“接管键盘”按钮；或“你已接管键盘：按键原样发给会话；终端按网页尺寸 C×R；离开这一页自动释放”与“释放”按钮，照第三轮稿），下面是按钮；观看时下面还有 t11 的输入框。两步确认要的“屏幕末尾”照旧经 `agent.read --source visible` 取（不从帧里拼，屏幕判断以 herdr 读到的为准）。

### 七、手机

- **判定**：视口窄于 768px，或 `(pointer: coarse)`。
- **纯文本视图为主**：文字直接来自同一条 observe 流——页面里起一个不挂到 DOM 的 xterm 实例解析帧，按 200 毫秒节流把它缓冲区里的行转成文字，放进可换行的 `<pre>`。实时，不调 `agent.read`，不会滚动 Claude 的界面。
- **更早的输出**：
  - omp 的 pane 给“更早的输出”按钮，调 `agent.read --source recent_unwrapped`（omp 有普通回滚，读它没有副作用）；
  - Claude 的 pane 不给：它在备用屏上，读多于可见行要滚动它的界面、工作中直接报错（t11 设计审查 S4）。这与 Proposal 第七节写的 `recent-unwrapped` 不同，见“与 Proposal、实施计划的不一致”。
- **输入框**：就是 t11 会话页的那一个（同一个零件 `SessionConsole` 的输入框、同一个接口 `POST /api/sessions/:pane/prompt`、同一套投递判据与两步确认），不另做一个。按键按钮也一样。
- **手机上不给“接管键盘”**（推荐，见决定点 3）：xterm.js 上的中文输入法不稳、屏幕太小，接管还会把真实终端改成手机的尺寸。需要时可以点“终端画面”只看。

### 八、资源、日志与收口小结

- 每个连接一个子进程（约 6.6 MB），一格最多 4 个、面板最多 16 个连接；没有人看就没有子进程。
- 观看期间每格每 5 秒 `pane.get` 加 `pane.layout` 各一次（herdr 日志多两行），没人看不调。
- 面板 `stop()`：先关 `/ws/terminal` 的新连接，释放全部接管（各自改回尺寸、写释放行），收全部 observe，再走 t11 的收口（等进行中的投递）。整体仍在单元的 `TimeoutStopSec=30` 之内。

## 切片

每片在集成分支上单独提交，只按路径暂存，提交前 `git diff --cached --check`；每片自跑包的 `test`、`typecheck`、`build:web`。

| 切片 | 内容 | 测试 |
|---|---|---|
| S0 探针（结论写进“实施进度”与 `docs/herdr.md`，不入库代码） | 命名会话里：target 写 terminal id 行不行（pane 跨 workspace 移动会换 pane id）；4 个 observe 时 herdr server 的 CPU 与内存（`yes` 刷屏 10 秒）；TUI 改尺寸时有没有 `pane.updated` 之类的事件；假界面上 Claude 风格的方向键写法。默认 server 0.9.1 上 observe 能不能用，**要开发者同意**才对一格空闲的真实 pane 起一次只读的 observe（见“需要开发者批准或参与”）；control 不在默认 server 上试 | 无 |
| S1 herdr 流适配 | `src/herdr/streams.ts`：`HERDR_PANEL_STREAMS`、herdr 路径解析、`setpriv` 检查、起子进程（环境只给三个变量）、逐行解析、`send(input、resize、release)`、收口阶梯；`HERDR_PANEL_METHODS` 加 `pane.get`、`pane.layout`，客户端加 `paneGet`、`paneLayout`；`install-service` 的单元加 `NBDEV_HERDR_BIN`；新错误码 `pane_controlled` | L1：帧与结束行的解析、坏行、输入编码、尺寸夹取。L3：`tests/fake-herdr-cli.ts`（可执行的假 `herdr`，按状态目录模拟 observe、control、已有控制者、takeover、release、stdin 关闭）；子进程的环境只有三个变量；收口阶梯；白名单钉住 |
| S2 终端中枢 | `src/server/terminal-hub.ts`：连接表、观看的尺寸（`pane.get`、`pane.layout`、本面板的接管尺寸）、5 秒复查与重起、上限、背压重同步、接管与释放的状态机（互斥、先不带 takeover、确认后抢、恢复尺寸、心跳与空闲释放、被接管）、审计、`stop()`；`serve.ts` 的 `/ws/terminal` 升级与校验；`Notifier` 的 `waiting_takeover`；`session-io` 的 `pane_controlled`；`/api/meta` 加 `terminal: {available, reason}` | L3：`tests/panel-terminal.test.ts`，用假 herdr（socket）加假 herdr 命令行，经真实的 WebSocket 连接测（见“验收”） |
| S3 前端 | 依赖 `@xterm/xterm`、`@xterm/addon-fit`；零件 `TerminalView`、`TerminalTextView`、`TakeoverDialog`（各带同名 `.md`）；宿主 `host/terminal-socket.ts`（连接、心跳、`visibilitychange` 与 `pagehide`、重连只恢复观看）、`host/terminal-theme.ts`、`host/terminal-input.ts`（粘贴清洗、Ctrl+C 判断，纯函数）；会话页与 `SessionConsole` 接上实时终端、手机的文字视图、接管期间隐藏输入框；通知状态行加 `waiting_takeover` | L1：`host/terminal-input.ts`。浏览器验收（临时仓库加命名会话） |
| S4 文档 | `docs/herdr.md`（两条流的协议与实测、控制期间 API 写入照常、TUI 不被锁、向 herdr 提的需求）、`docs/panel.md`（终端、`/ws/terminal`、接管与释放、帧里有秘密、手机）、`docs/file-formats.md`（审计的 `takeover`、`release`）、`docs/cli.md`（`pane_controlled`） | `governance:check`、`docs:check` |
| S5 验收 | L4（命名会话）；浏览器；开发者在场的真实 pane 接管 | 见下 |

## 接口与数据

```text
WS /ws/terminal?pane=<pane id>&terminal=<terminal id>
  升级前：转发头、Host、登录、Sec-Fetch-Site、Origin；pane 在本仓库、terminal id 对得上；上限
  服务端 → 页面（JSON 文本消息）
    {t: "state", mode: "watch" | "control", cols, rows, sizeKnown, controller: null | {by: "this" | "other_browser" | "elsewhere", since}}
    {t: "frame", seq, full, w, h, b}        // b 是帧的 base64，原样转发
    {t: "need_confirm", reason: "controlled_elsewhere" | "other_browser", detail}
    {t: "released", reason}                 // 回到观看之前
    {t: "error", code, message}
  页面 → 服务端
    {t: "takeover", cols, rows, expectedSession: string | null, force: boolean}
    {t: "input", data: string}              // 只在接管时；≤ 64 KiB
    {t: "resize", cols, rows}               // 只在接管时
    {t: "key", key: "up"|"down"|"shift+tab"|"enter"|"esc"|"ctrl+c"|"y"|"n"}   // 只在接管时
    {t: "release"}
    {t: "alive"}                            // 接管期间每 5 秒
  关闭码：1001 面板退出；4400 消息不对；4403 pane 不在本仓库或审计不可用；4404 pane 或终端没了；4409 超过上限

GET  /api/sessions/:paneId/history?session=   // 只给 omp：agent.read recent_unwrapped；Claude 回 409 history_unavailable
POST /api/sessions/:paneId/prompt、/keys       // t11 的接口；这格被接管时回 409 pane_controlled
GET  /api/meta                                 // 加 terminal: {available, reason}（没有 setpriv、找不到 herdr）
```

- 新错误码：`pane_controlled`（3，这格正被接管）、`history_unavailable`（3，Claude 不给读历史）。
- 审计的 `action` 加 `takeover`、`release`（格式见“安全与审计”）。
- `Notifier` 的任务状态加 `waiting_takeover`（计入“排队”，不计入“要处理”）。
- 核心库不动（终端只在面板服务里）；`src/index.ts` 不导出新东西。

## 验收场景与测法

不对默认 herdr 里的任何真实 pane 起 control、接管或输入，开发者在场的那一步除外。L4 与浏览器都在命名会话 `nbdev-test` 里做，用完停 server、删会话。浏览器只在临时仓库上，面板的 `HERDR_SOCKET_PATH` 指命名会话的 socket，端口避开 4400、4401。

| 场景 | 测法 |
|---|---|
| 1 两个浏览器同时看同一个 pane：在 pane 里输入后，两边都在约 20 毫秒内更新，herdr 那边的尺寸不变 | **L4**：bash pane 起两个 observe，`pane send-text` 写一行，量两边收到帧的时刻（记录数值；超过 50 毫秒算失败）；前后 `pane.get` 的行数与 `stty size` 不变。**L3**：两个 WebSocket 各起一个子进程，帧各自转发，关掉一个只收掉它自己的。**浏览器**：两个页面看同一格，量从 `send-text` 到两边页面上出现文字的时间（含渲染，记录数值，超过 300 毫秒算失败） |
| 2 一边点接管：终端尺寸变成网页的列数与行数（`stty size` 可见）；另一个控制者收到“被接管”的提示 | **L4**：control 以 90×25 连上后 `stty size` 是 `25 90`；第二个 control 不带 takeover 收到“already has an attached client”；带 takeover 后第一个收到“taken over”。面板层：经 WebSocket 接管，`stty size` 等于请求的尺寸；另一个浏览器连接先接管、这边确认后抢过来，那边收到 `released: taken_over`。**L3**：先不带 takeover、需要确认、确认后带 takeover；互斥里排在进行中的投递后面；审计意图与结果。**浏览器**：接管前的提示、状态条两种样子、被抢那边的提示 |
| 3 关闭接管的标签页：控制权释放，herdr TUI 能重新操作 | **L4**：WebSocket 关掉后 2 秒内 control 子进程退出（看 `/proc`），随后不带 takeover 的 control 能连上；释放前改回接管前的尺寸（`stty size` 等于接管前）；在 pty 里挂一个 TUI，释放后 TUI 把尺寸改回它的布局、TUI 打字进 pane。另测心跳超时、`visibilitychange`（浏览器）、面板 `stop()` 都会释放。**浏览器**：关掉标签页，服务端的释放行原因是 `disconnect` |
| 4 接管状态下输入中文、点 Esc 与 Ctrl+C 按钮：会话收到对应的输入 | **L4**：名为 `claude` 的假界面（记下收到的字节）：经 WebSocket 接管，`input` 发“中文”收到 UTF-8 字节；按钮 Esc、Ctrl+C 经 `agent.send_keys` 收到 `\x1b`、`\x03`；本地开了 `?2004h` 时粘贴被 `\e[200~ … \e[201~` 包住，带 Esc 的粘贴被清洗。**浏览器**：Playwright 在 xterm 的输入区 `insertText('中文')`，假界面收到。真实输入法只在开发者在场时验 |
| 5 390px 视口下，纯文本视图可读，输入框能发送 | **浏览器**：390×844，会话页默认纯文本视图，文字随 pane 输出更新、不横向溢出；没有“接管键盘”按钮；输入框经 t11 的接口发出（假界面收到）。omp 的“更早的输出”在 L3 用假 herdr 测（命名会话里没有真实 omp） |
| 互斥（t11） | **L3**：接管期间通知任务是 `waiting_takeover`、没有 `agent.prompt`；释放后稳定 3 秒照常投递；接管期间别的浏览器的文字与按键回 409 `pane_controlled` |
| 收口 | **L3**：连接关闭、`stop()`、超过上限、背压都收子进程；没有 `setpriv` 时终端关掉。**L4**：Bun 进程被 SIGKILL 之后 observe 与 control 子进程都不在 |
| 审计 | **L3**：接管一次、输入几条、释放：一行意图、一行结果、一行释放（统计对得上），没有输入内容；观看不写 |

**开发者在场的那一步**（真实 pane，默认 server 0.9.1）：

1. 合入后，用常驻的面板（或前台 `nbdev panel serve`）打开会话页，选一格开发者自己挑的、空闲的 Claude 会话，看实时终端是否与 herdr 里的一致。
2. 点“接管键盘”，读提示后确认；看 herdr 那边这格的尺寸是否变成网页的尺寸。
3. 在网页终端里用输入法打一句中文（不要回车，或者打完按 Esc 清掉），按一次 Esc 按钮。
4. 切到别的标签页再切回来：应已自动释放、回到观看；herdr 那边尺寸改回原样。
5. 把观察（尺寸重排是否顺畅、输入法是否正常、TUI 那边有没有异样）告诉主 Agent，记进 Task README。

## 决定点

| # | 问题 | 推荐 |
|---|---|---|
| 1 | 终端走现有的 `/ws` 还是新开一条 | 新开 `/ws/terminal`，一个终端视图一条连接：连接的生命周期就是子进程与控制权的生命周期，关连接即释放；校验与 `/ws` 相同 |
| 2 | 键盘输入要不要逐条写审计 | 不写内容，只在释放行写统计（条数、字节数、回车、粘贴、按钮、时长）；接管与释放各有记录。键盘流里有密码与令牌 |
| 3 | 手机上给不给接管 | 不给（窄于 768px 或粗指针）；手机用纯文本视图加 t11 的输入框与按钮，可切到“终端画面”只看 |
| 4 | 接管期间的按钮是否还要两步确认 | 单击即发（键盘本来就直通），Agent pane 走 `agent.send_keys`、普通 shell 走字节；不接管时仍是 t11 的两步确认 |
| 5 | 能看、能接管哪些 pane | 本仓库 checkout 里的 pane，Agent 与普通 shell 都可以；别的仓库的 pane 只在列表里列出，不能看终端 |
| 6 | 什么时候自动释放 | 页面切到后台立刻释放（Proposal）；另加 15 秒没有心跳、15 分钟没有输入 |
| 7 | 释放时要不要改回接管前的尺寸 | 改回（TUI 挂着时它也会自己改回，没挂着时不改回就一直停在网页的尺寸） |
| 8 | 要不要在 herdr 的 TUI 上提示“网页接管了” | t12 不做（要给面板的白名单加 `notification.show`，会在开发者的 TUI 上弹东西）；写进向 herdr 提的需求 |
| 9 | 别处已经在控制时 | 先不带 `--takeover`，失败就请开发者确认“抢过来”，不静默抢别人的控制权 |
| 10 | Claude 的手机文字视图用不用 `recent_unwrapped` | 不用，改用 observe 流里的当前屏幕（不滚动 Claude 的界面）；omp 才给“更早的输出” |
| 11 | xterm.js 用哪个版本 | `@xterm/xterm` 6.0.0、`@xterm/addon-fit` 0.11.0，精确版本 |
| 12 | 没有 `setpriv` 时怎么办 | 终端功能关掉并写明原因，不退而求其次（孤儿 observe 收不掉） |

## 与 Proposal、实施计划的不一致

1. **接管不独占输入**：Proposal 第七节与调研写“同一终端同时只能有一个控制者”，容易读成“接管之后只有网页能打字”。实测 herdr 不拦任何 API 写入：接管期间 herdr 那边的键盘、别的程序与会话自己的 herdr 命令行都能写进这格（S14）。本计划把这一点写进接管提示，面板只保证自己不发。
2. **手机的纯文本视图不用 `recent_unwrapped`**（Claude）：Proposal 第七节与实施计划写 `agent.read --source recent-unwrapped`；本计划对 Claude 用 observe 流里的当前屏幕，只对 omp 给“更早的输出”（决定点 10）。
3. **接管期间按钮不两步确认**：t11 的按键两步确认只用于不接管时（决定点 4）。
4. **释放时改回尺寸**：Proposal 没有写；本计划在读得到 pty 尺寸时改回，读不到不改回（决定点 7，I1）。
5. **白名单不加 `pane.layout`**：尺寸从 pty 读（`pane.process_info` 已在白名单，读 `/proc` 与 `stty -F` 在面板本机做）。
6. **多一个本机依赖 `setpriv`**（util-linux）：Proposal 没有提；没有它终端功能关掉（决定点 12）。
7. **自动释放多两条**：15 秒没有心跳、15 分钟没有输入（决定点 6）；页面切到后台时观看也停（S9）。
8. **场景 1 的“约 20 毫秒”**：L4 量的是 herdr 到面板子进程（实测约 3 毫秒）；浏览器里含渲染，按 300 毫秒判，数值照实记。
9. **只对 Agent pane**：实施计划写“会话的实时终端”，本计划只开放 herdr 认得出 Agent 的 pane，普通 shell pane 推迟到 t14（S8）。
10. **systemd 单元加 `KillMode=mixed`**（S3）：t11 的单元没有写。
11. **t11 的按 pane 互斥改按 terminal id**（S5）。

## 风险

按影响排序，前两条是我认为最大的两处。

1. **接管不独占输入**：
   - 起因：herdr 只限制“控制端”只有一个，不拦 API 写入；TUI、别的程序、会话自己的 herdr 命令行在接管期间都能写进 pane。尺寸不会被 TUI 改回（审查在 0.9.1 加 0.9.3 TUI 上实测），只有输入会混。
   - 最坏的情况：开发者以为键盘被网页独占，另一边的输入混进来。
   - 缓解：接管提示写明；面板自己的自动投递与文字、按键在接管期间全部停下（按 terminal id 判断）。
   - 剩下的：TUI 那边收不到任何提示。写进向 herdr 提的需求（control 的只输入模式、接管时通知别的客户端）。
2. **子进程与控制权收不干净**：
   - 起因：observe 不读 stdin，读端没了也不退出，面板异常退出就留下孤儿；作为 systemd 服务停止时缺省会同时给子进程 SIGTERM，来不及改回尺寸；浏览器断线不一定马上让服务端知道。
   - 缓解：子进程一律经 `setpriv --pdeathsig TERM` 起，没有 `setpriv` 就不开终端；单元加 `KillMode=mixed`；连接关闭、`stop()`、超上限都走同一个收口阶梯；接管期间 15 秒没有心跳就释放；页面切后台时观看也停。L3、L4 都断言子进程真的退了（看 `/proc`）。审计里“有接管、没有释放”的含义写进文档。
3. **尺寸读不到**：shell 的 pid 没了、fd 0 不是 pty 时只能按 120×40 看，释放时不改回。状态条写明；向 herdr 要列数。
4. **帧里不带应用的终端模式**：Claude 与 omp 实测开着 bracketed paste，本地打开；粘贴先清洗；按钮走 `agent.send_keys`。
5. **浏览器与输入法**：Ctrl+W、Ctrl+T 拦不住；xterm.js 上的中文输入法只能人验。缓解：按钮、提示，长文字推荐输入框。
6. **默认 server 0.9.1**：两条流已在同一个 0.9.1 二进制（命名会话里）上验证；真实 pane 只在开发者在场那一步碰。
7. **帧里有秘密**：见“安全与审计”。面板不落盘，但浏览器里有；跨设备之后范围更大（t13）。

## 需要开发者批准或参与

| 事项 | 时机 | 性质 |
|---|---|---|
| 接管不独占输入（herdr 那边的键盘与其它程序照样能写）、TUI 收不到提示：这是 herdr 的现状，按本计划提示开发者，不另做 | 实施前 | 知情 |
| 决定点 2（键盘内容不进审计；跨设备之后审计回答不了“打了什么”）、3（手机不给接管）、5（只开放本仓库的 Agent pane，shell pane 推迟到 t14）、10（Claude 的手机视图不用 `recent_unwrapped`） | 实施前 | 范围与隐私的取舍，按推荐先定，待确认 |
| 真实 pane 上接管一次键盘（步骤见“设计审查的处理”的验收一节） | 合入后 | 开发者参与 |
| 已装 systemd 单元的话，t12 合入后重装一次（单元多 `NBDEV_HERDR_BIN` 与 `KillMode=mixed`） | 合入后 | 用户级服务 |

依赖安装（`@xterm/xterm`、`@xterm/addon-fit`）、本地提交、命名会话里的测试，都属于本地可逆操作，按 P-005 不再逐项询问。对默认 server 起 observe 的那一项已经删掉（I2）。

## 推迟（不在 t12）

- 鼠标事件（要 server 0.9.2 以上）；在面板里启动新会话；
- 普通 shell pane 的观看与接管（t14，与“在跑”的开发服务一起，S8）；
- Claude 的完整历史（要读会话 jsonl，Proposal 第一版不读）；
- 在 herdr 的 TUI 上弹“网页接管了”的通知（决定点 8）；
- 观看别的仓库的 pane（决定点 5）；
- 手机上接管（决定点 3）；
- `terminal.scroll`（滚动 herdr 那边的视口）、多格并排的终端墙、终端录像与回放；
- 断线后自动重新接管。

## 实施进度（编码子代理随做随记）

- 2026-10-13：计划写完，交设计审查。计划前的实测见上；命名会话已删，没有残留进程，没有对默认 server 起 observe 或 control。
- 2026-10-13：设计审查的处理写进上面一节；S0 的 bracketed paste 已核对（真实 `claude`、`omp` 都开着 `?2004h`，没有模型调用）。
- S1 herdr 流适配：`9cc93dc96`（另加 `setsid`：子进程自成会话，前台运行时终端的 Ctrl+C 不会同时打到它）。S2 终端中枢：`73e55ae7c`（L3 `tests/panel-terminal.test.ts` 13 条、`tests/terminal-stream.test.ts` 7 条；实现中发现子进程已死、`exited` 未兑现时写 stdin 会抛 EPIPE，已按“写不进去”处理）。
- S3 前端：`1e46624e4`（`@xterm/xterm` 6.0.0、`@xterm/addon-fit` 0.11.0 精确版本）。浏览器验收在临时仓库与命名会话 `nbdev-test` 的假界面上跑，24 项全过、控制台没有错误；截图在本地 `.local/agent/works/w00022-dev-panel/tasks/t12-web-terminal/shots/`。演示宿主已停，命名会话已删，没有残留进程。
- S3 补：`27dcbf6f6`（omp 的更早输出 `GET /api/sessions/:pane/history`，`recent_unwrapped` 1000 行，Claude 回 409 `history_unavailable`；手机文字视图每 200 毫秒更新；读屏不再因“正被接管”回 `pane_controlled`：另一个浏览器这时打开会话页要看屏幕）。`f1c4018af` 修三处：27dcbf6f6 的会话页在立即执行的 watch 里用到后声明的状态，页面初始化报 TDZ（浏览器验收发现）；连接推过帧之后才挂上的视图（手机文字视图切到终端画面）拿不到整屏，加 `resync`（观看时重起 observe）；读尺寸期间另一次重起已起 observe 时会起第二个、旧的成孤儿（L3 加断言，去掉修正时 3 个子进程）。
- S4 文档：`985a02871`、`305c3f1d4`（`docs/herdr.md` 的“终端流（t12）”、`docs/panel.md` 的“网页终端（t12）”、`docs/file-formats.md` 审计、`docs/cli.md` 错误码，包 `AGENTS.md` 的 L4 一句）。`governance:check`、`docs:check` 无失败。
- S5 L4：`b7a1b1916`（`tests/herdr-live.test.ts` 的 t12 一组，server 0.9.3 与 0.9.1 各一次，都通过）：pty 尺寸与 pane 里 `stty size` 一致；两个 observe 同时看，control 打字到两边都收到帧 3 到 20 毫秒，观看不改尺寸；control 改尺寸、已有控制者时不带 takeover 第一行就是结束、带 takeover 抢走、resize、改回后 release、之后不带 takeover 能连上；TUI（0.9.3 客户端，100×30）挂着时接管中改窗口 pane 尺寸不变，释放后 TUI 改回布局、再改窗口 pane 跟着变；父进程被 SIGKILL 后 observe 与 control 退出、控制权释放；client socket 路径不超过 107 字节。
- 全量验证（2026-10-13）：包 `bun test` 279 条全过，`typecheck`、`build:web` 通过；根 vitest 3 个文件 177 条、Node 下 `dev-panel-records` 5 条通过；浏览器验收重跑（假界面 22 项全过、控制台没有错误；omp 的更早输出在假 herdr 上 390 宽与 1440 宽各验一次）。演示宿主都已停，命名会话已删，没有残留进程。

## 实现审查的修正

实现审查（[`evidences/impl-review.txt`](evidences/impl-review.txt)，0 阻断、2 重要、6 建议）全部采纳，集成分支上每条单独提交（未 push）：

| 条 | 提交 | 改了什么 |
|---|---|---|
| F1 字距被拉开 | `609c01ed8` | 交给 xterm 的字体串不含 CSS 变量：挂载时读 `--font-mono` 的计算值拼成具体字体（`host/terminal-font.ts`），canvas 仍不接受就换缺省等宽字体；按量出的格宽与字号之比缩观看字号（5 到 14px，容器变了就重算）。L1 断言字体串不含 `var(`；浏览器断言格宽约为字号的一半 |
| F3 接管尺寸 | `be9723042` | 接管尺寸按接管后的终端框量（临时套上 70vh 的框高与 13px 再量，同步改回）；“抢过来”沿用第一次量的尺寸 |
| F2、F8（前端） | `9cbe33674` | 接管中窗口变窄仍留在终端视图（选这种而不是自动释放：缩窄窗口不等于离开，键盘还在这个页面上；释放入口与接管提示都在，终端按窄框 resize），释放后才换文字视图；手机的终端画面加“回到文字视图”；接管中按钮的 `aria-label` 与 `title` 写接管中的说明（Ctrl+C 接管中不限速，说明里去掉“3 秒”） |
| F4 握手中关连接 | `45bbb65b8` | 起 control 之前再查一次连接与退出；control 已接上才关的，照常释放、改回尺寸，审计记 `attached` 加 `disconnect` 的释放行；握手期间 `close` 不插手，由握手收尾。L3 用假命令行的两个延时（`observeExitDelayMs`、`controlDelayMs`）复现 e08 的两种时机 |
| F5 observe 第一行就结束 | `aa83bb62e` | 没出一帧就结束（含第一行就是 `terminal.closed`）都计入连续 3 次，到了回 4404；`closed` 的原文进面板日志。L3 复现 e13 |
| F6 审计的设备 | `8c7012ad7` | 结果行与释放行的设备取自连接 |
| F8（服务端与文档） | `29a0817ce` | 读不到 pty 尺寸时把原因记进面板日志（同一终端只记一次）；恢复 `stop()` 注释的理由；`panel.md` 的互斥说明改成与接管提示一致 |
| F7 补测试 | `72799b957` | `waiting_takeover` 与释放后投递；读不到尺寸不改回；心跳与空闲释放（接管时限改成可注入的选项）；S7 改为断言自动通知；“1 秒内”照实断言；面板层 L4（0.9.3、0.9.1 两组）：经 WebSocket 接管后 pty 是请求的尺寸，关连接后约 60 毫秒 control 退出、尺寸改回 |

- 验收表场景 1 的 L4 测法已按实际改写：用同尺寸 control 打字作刺激，`pane.send_text` 的数只记录不判（理由见 `docs/herdr.md` 的“时延与开销”）。
- 验证（2026-10-13）：包 `bun test` 288 条全过（含 L4 两组），`typecheck`、`build:web` 通过；根 vitest 3 个文件 177 条、Node 下 `dev-panel-records` 5 条通过；`governance:check`、`docs:check` 无失败。浏览器复测在临时仓库加命名会话上：原验收 22 项与修正复测 15 项全过、控制台没有错误；截图 `t12-fix-*` 在本地 `shots/`。演示宿主已停，命名会话已删，Chrome 的临时数据放在 `/dev/shm` 并已删除。
