# herdr 适配

nbdev 经 herdr 认会话、写 pane 标签、找运行所在的 pane；面板（t11）还经它往会话的输入框里投通知与文字、发按键；t12 经 herdr 命令行的终端流看实时终端、接管键盘。本文写用到的接口、白名单、投递的判据、终端流、降级方式与版本假设。实现在 `src/herdr/client.ts`、`src/herdr/screens.ts`（可投的判据）、`src/server/delivery.ts`（投递）、`src/server/terminal-stream.ts`（终端流）与 `src/server/terminal-size.ts`（pty 尺寸）。

## socket 与协议

- 位置按顺序取：`HERDR_SOCKET_PATH`；`HERDR_SESSION`（命名会话，`~/.config/herdr/sessions/<名>/herdr.sock`）；默认会话 `~/.config/herdr/herdr.sock`。命令行从调用者的环境变量里取，测试一律指到命名会话或假 socket。
- 协议：一行一个 JSON，请求 `{id, method, params}`，响应 `{id, result}` 或 `{id, error: {code, message}}`。客户端每次调用开一个连接，读到第一个换行为止并核对 `id`。
- 时限：单次调用 2 秒；`agent.prompt` 例外，取它的等待时限（`wait.timeout_ms`）加 2 秒。本地超时报 `client_timeout`，与 herdr 自己判定的 `agent_prompt_stalled`、`timeout` 分开记。`status`、`lease list` 给整个客户端 2.5 秒的总时限，用完之后的调用直接报超时，命令按 herdr 不可用继续。
- 时延：在本机默认 server 0.9.1 上，Bun 客户端的单次调用有一部分（实测 5% 到 50%，随负载变化）要多等约 100 毫秒，原因未查明；改成连接建立前就写请求没有改善（2026-10-12 实测）。所以 `status`、`lease list` 一次调用里 `pane.list` 只取一次，`ping` 与 `pane.list` 并发，减少串行的调用。
- 客户端的三个选项只给一次命令用完即弃的客户端（命令行）开：`budgetMs`（总时限从创建时算起）、`memoizeAvailability`（只 ping 一次）、`memoizePanes`（pane 列表只取一次）。常驻的客户端（面板）不开，否则 herdr 一时不在就永远判为不可用、预算期过后永远超时、pane 列表永远是旧的。

## 白名单

herdr 的 socket 没有鉴权，连上就能调全部方法（含 `server.stop`、`pane.run`）。白名单由调用方显式传入，白名单外的方法在客户端直接拒绝，不发出去：

| 清单 | 方法 | 谁用 |
|---|---|---|
| `HERDR_READ_METHODS` | `ping`、`pane.list`、`pane.process_info` | `status`、`lease list` |
| `HERDR_CLI_METHODS` | 上面三个加 `pane.report_metadata` | 写命令（只为写调用者自己 pane 的标签） |
| `HERDR_PANEL_READ_METHODS` | `HERDR_READ_METHODS` 加 `session.snapshot`、`events.subscribe` | 面板的只读部分（测试里核对面板没有越过它） |
| `HERDR_PANEL_METHODS` | `HERDR_PANEL_READ_METHODS` 加 `agent.get`、`agent.explain`、`agent.read`、`agent.prompt`、`agent.send_keys`；Proposal 第八节第 7 条的其余几个（`agent.list`、`agent.wait`、`pane.get`、`pane.read`）等用到时再加 | 面板（t11 起） |
| `HERDR_PANEL_STREAMS` | 命令行的 `terminal session observe`、`terminal session control`（不在 socket 的 JSON 接口里，见“终端流”） | 面板的网页终端（t12） |

`pane.run`、`pane.send_text`、`pane.send_input`、`server.*`、`workspace.*`、`pane.report_metadata` 都不在面板的清单里，在客户端就被拒绝（`tests/delivery.test.ts` 钉住清单的内容）。终端流是命令行子进程，socket 的白名单管不到它发给 server 的内容，只能靠适配层只拼这两种参数（`streamArgs`：target 只收 terminal id 的写法、尺寸是夹过的整数、takeover 是布尔）。

## 用到的接口

| 方法 | 用途 | 关键字段 |
|---|---|---|
| `ping` | 判断 herdr 是否可用 | `version` |
| `pane.list` | 各 pane 上是哪个 Agent 会话、状态 | `pane_id`、`terminal_id`、`agent`、`agent_status`、`agent_session {agent, kind, value}`；Claude 的 `value` 是会话 id，omp 的是会话文件路径 |
| `pane.process_info` | pane 的 shell 与前台进程（运行归属、omp 的主进程、写标签前确认调用者在这格 pane 的前台） | `shell_pid`、`foreground_process_group_id`、`foreground_processes[].pid`；pane 不存在为 `pane_not_found` |
| `pane.report_metadata` | 写或清 `work`、`task` 两个 token | `source: "nbdev"`、`tokens`（值为 `null` 即清除）、`ttl_ms: 86400000` |
| `session.snapshot`（面板） | 全部 pane、所在 workspace 与各 Agent 的状态序号 | `{type: "session_snapshot", snapshot: {version, workspaces[], panes[], agents[]}}`；`panes[]` 带 `cwd`、`foreground_cwd`、`agent_status`、`agent_session`，`agents[]` 带 `state_change_seq` |
| `events.subscribe`（面板） | pane 增减与状态变化的推送 | 单独一条长连接：先回 `{id, result: {type: "subscription_started"}}`，之后每行一个 `{event, data}`；订阅类型由面板写死，不订带终端正文的 `pane.output_matched` |
| `agent.get`（面板） | 投递前后核对一格的会话、目录、状态与状态序号 | `{type: "agent_info", agent: {pane_id, agent, agent_status, agent_session, cwd, foreground_cwd, focused, state_change_seq}}`；没有 Agent 为 `agent_not_found` |
| `agent.explain`（面板） | Claude 的输入框是不是认得出的空（正向白名单） | `explain.matched_rule` 是对象 `{id, priority, region, state}`；`fallback_reason`；`evaluated_rules[]` 里 `live_prompt_box` 的 `evidence.region_preview`；omp 没有检测清单，`screen_detection_skipped: true` |
| `agent.read`（面板） | 读屏：交叉核对与会话页的屏幕末尾；omp 的更早输出（t12） | `source: "visible"`、`format: "ansi"`，不带 `lines`（`recent` 加行数会滚动 Claude 的界面，工作中还会报错）；回 `{type: "pane_read", read: {text, …}}`。只对 omp：`source: "recent_unwrapped"`、`lines: 1000`（omp 是普通回滚，读它没有副作用） |
| `agent.prompt`（面板） | 投一行文字：粘贴、约 300 毫秒后回车 | `text`、`wait: {until: ["working", "blocked"], timeout_ms: 10000}`；在 `blocked` 时回 `agent_blocked` 且一个字节都不写；等到点回 `agent_prompt_stalled` 或 `timeout`；成功回 `{type: "agent_prompted", agent}` |
| `agent.send_keys`（面板） | 发按键 | `keys: [逻辑键名]`；一批里有不认识的键名整批回 `invalid_key`、都不发 |

认调用者与 `status` 都直接用 `pane.list` 带的 `agent`、`agent_session`、`agent_status`，不调 `agent.list`、`agent.get`；各 pane 的 `process_info` 并发调用，单个失败就跳过这格并给 `herdr_partial` 警告。`agent.*` 只有面板在投递时用。

## 会话身份与是否还在

- herdr 里的会话以 `agent_session.value` 认人，pane id 只是线索：pane 跨 workspace 移动会换 id。
- herdr 记的“pane 上是哪个会话”由 Agent 的钩子上报，会被同一格 pane 里嵌套的 `claude -p`、Claude 的后台副本改写。所以 nbdev 不按 herdr 判会话是否结束，而是看会话进程（pid 加启动时刻）；herdr 的列表里找不到只表示不能通知（`managed: false`）。
- 一格 bash pane 要在 herdr 里成为 Claude 会话，需用集成同样的 source 上报：`pane report-agent <pane> --source herdr:claude --agent claude --state idle --agent-session-id <id>`；单独用 `report-agent-session` 不会让它出现在 `agent.list` 里（2026-10-12 在 0.9.3 的命名会话里实测，L4 测试就这样扮）。

## 运行的归属

`status` 列出“运行”（会话派出、在后台完成的事）时，只认 Agent 工具派出的进程：

0. 调用 nbdev 的那条命令自己不算：它的父进程链，以及与它同一进程组的管道伙伴（`nbdev status | head` 里的 `head`）。
1. 进程环境里有 `CLAUDE_PID` 与可信的 `CLAUDE_CODE_SESSION_ID`：归那个 Claude 会话（嵌套的归外层）。这里不要求 `CLAUDE_PID` 是它的祖先：会话派出的长进程常被收养到 1，父进程链会断。
2. 有 `OMPCODE=1`，且 `HERDR_PANE_ID` 指向一格现存、有 Agent 的 pane：归那格 pane 上的会话。
3. 其余（只有 `HERDR_PANE_ID` 的也算）沿父进程链向上：先碰到 Agent 进程的是 Agent 的内部进程（MCP 服务、omp 的 broker），不列；碰到有 Agent 的 pane 的 shell 或前台进程，归那个会话；碰到普通 shell pane，归无主并带 pane。
4. 链走到底也没碰到 pane：
   - 带 Claude 的工具标记、但那个会话不可信（会话进程已不在，例如会话结束或 `claude --resume` 换了进程之后还在跑的开发服务、omp 审查）：列为无主，带 `sessionHint`（标记里的会话键）与 `sessionAlive: false`；
   - 进程在用户级 systemd 的服务单元里（`…/app.slice/<unit>.service`，单元名不以 `app-` 开头）：列为无主并带单元名，例如 `systemd-run --user --unit=…` 起的长驻进程；
   - 其余不列，只计入 `ignoredProcesses`。
5. `HERDR_PANE_ID` 指向 `pane.list` 里没有的 pane，视为没有线索。

看不见的：脱离终端又没有任何工具标记的进程（codex 守护进程、`claude bg-pty-host`、Claude 的 daemon 与 spare）、VS Code 的进程与 VS Code 终端里起的进程、别的终端模拟器里起的进程。它们要么不是运行，要么 nbdev 无从知道是谁起的。会话已经结束、但带着它的 Claude 工具标记的进程看得见，见上面第 4 条。

运行的 `checkout` 取 cwd 所在的最深的 checkout（worktree 在主工作区的 `.worktree/` 下）。`command` 是运行树根进程的命令行；根进程是 Claude Bash 工具的包装（`zsh -c source …/shell-snapshots/… && … && eval '<命令>'`）时显示 eval 里的命令，取不到就显示第一个后代的命令行。

## 面板的订阅与对账

面板常驻一份 herdr 状态（快照加订阅），会话页与活动（谁在动、运行的归属）共用它，不再各自调 `pane.list`。

- **订阅**：全局订阅 `pane.created`、`pane.closed`、`pane.updated`、`pane.moved`、`pane.exited`、`pane.agent_detected`、`workspace.created`、`workspace.closed`、`workspace.renamed`；`pane.agent_status_changed` 只能逐格订阅，每格有 Agent 的 pane 订一条。pane 集合变了（含 `pane.moved`：跨 workspace 移动会换 id）就开一条新的订阅连接，等它回 `subscription_started` 再关旧的，然后用快照对账一次。
- **没有 `events_lost`**：协议 22 没有这个事件。订阅连接断开就当作可能漏了事件：退避重连，重连后用快照对账。herdr 不可用时用同样的退避重试快照。
- **退避的规则**：初值 500 毫秒、每次乘 2、上限 30 秒，再加 0 到 20% 的抖动。重试只有一条链：已经排着一次重试时，新的失败只计数、不再排第二次；30 秒的对账在重试期间（herdr 不可用、订阅断了还没重连）跳过。退避计数只在订阅连上并稳定保持 10 秒之后清零，快照对账成功不清零：“连上就断”的订阅因此按退避逐次拉长，不会停在 500 毫秒。累计的失败次数在 `/api/sessions` 的 `herdr.retries`。
- 会话的 revision 只在显示用到的字段变化时增加（各 pane 的状态、Agent、会话、目录、workspace 名与 herdr 是否可用）；订阅与轮询之间的切换不单独推送。
- **对账**：每 30 秒一次快照。某格 Agent 的 `state_change_seq` 与记下的不同、而面板手上的状态又不是快照里的，就是漏了状态事件，计进 `/api/sessions` 的 `herdr.missedEvents`。
- **状态序号**：`state_change_seq` 是 herdr 全服务器共用的一个计数，哪一格 Agent 变了状态，就取下一个值记在那一格上（t11 验收后用默认 server 0.9.1 的只读快照核实：各格的值散落在同一区间、互不重复；server 0.9.3 与 0.9.1 的命名会话里由 `tests/herdr-live.test.ts` 钉住：后变状态的那一格序号更大，与各自变了几次无关；带观察的投递在两个版本上都记得出 `passed_blocked`，别的会话同时变状态时仍是 `delivered`）。同一格前后相等就是没变过，对账、空闲稳定与紧贴投递的复核都只这样比；差值却数不出这一格变了几次，别的会话同时变状态也会推高它。要知道一格中途经过了哪些状态，只能看它的 `pane.agent_status_changed`。
- **事件为主、轮询兜底**：0.9.3 的命名会话里，名为 `claude` 的假 TUI 改状态约 0.2 秒就推 `pane.agent_status_changed`（t11 S0；默认 server 0.9.1 上没有可观察的状态变化，没有实测）。有浏览器连着时另外每 500 毫秒轮询一次 `pane.list`；没有浏览器、只有待发的通知时放慢到 15 秒，herdr 日志一天多约 5800 次请求、约 2 MB。新出现或消失的 pane 触发快照对账。
- **会话 id 变了不推事件**：`/clear`、`/compact`、`--resume` 之后 pane 上的会话 id 会变（S0 用 `report-agent-session --session-start-source clear|compact|resume` 都改掉了 id），herdr 不为此推任何事件。面板靠轮询与 30 秒的对账发现，投递前的 `agent.get` 是最后一道核对。
- herdr 不阻塞面板开始服务：面板先用“herdr 不可用”的状态起来，快照随后补上。

## 投递（t11）

面板替开发者往会话的输入框里打字只有三种：答复之后的通知（一行指针消息）、会话页输入框里的文字、会话页的按键。herdr 粘贴之后固定约 300 毫秒才写回车，回车前不复查状态，所以从最后一次读屏到回车之间的窗口缩不掉；判据要在投之前把能看到的都挡住，投之后再查一次有没有出事。

**一次投递前的判定**（文字；按键只做第 1、2 条的身份与仓库核对，任何状态都能发）：

1. **找会话**：按会话键（`<agent>:<agent_session.value>`）在 herdr 里找 pane，与租约是否有效、是否续接无关。找不到时，提问时记下的 pane 上若是另一个会话，判“会话已更换”；否则判“已结束”。
2. **只投本仓库的 pane**（`cwd` 或 `foreground_cwd` 在本仓库的某个 checkout 里），状态必须是 `idle` 或 `done`：`working` 排队，`blocked` 排队并提示“在等确认”，`unknown` 不自动投。
3. **空闲稳定**（自动通知）：第一次看到空闲时记下 `agent.get` 的 `state_change_seq` 与时刻；之后序号不变、且过了 3 秒才投（防状态抖动，不是对误判的缓解）。
4. **正向白名单**：只在认出“空输入框”时投，认不出就不投。
   - Claude：`agent.explain` 命中 `live_prompt_box`、没有 `fallback_reason`，清单里还有这条规则（远程更新可能改掉它）；读屏交叉核对：`visible` 的 ANSI 屏幕上夹在两条横线之间、以 `❯` 开头的那一行，`❯` 之后去掉空白只能是空的，或者只有紧跟着的一整段暗色文字（占位或建议文字），暗色之前或之后再有任何字都算有字；且这条规则的 `region_preview` 与这一行 `❯` 之后的全部文字一致（去掉空白比较）。SGR 按标准解析：`38`、`48`、`58` 后面的 `5;n`、`2;r;g;b` 与冒号写法是颜色值，整段跳过，只有独立的参数 `2` 才是暗色（Claude 给 `ultrathink` 上 RGB 彩虹色，herdr 读屏时写成 `38;2;r;g;b`，曾被误当成暗色占位，t11 实现审查第 1 条）。
   - omp：没有检测清单，按 S0 对真实 omp 的取样：最后一行是 `╰─` 且后面没有字、上一行是状态栏。
   - 认不出的确认界面（退路 `default_known_agent_idle_fallback`、状态仍是 idle）、详细记录视图（`transcript_viewer`）、模型选择（`model_picker_menu`）、`/` 命令表、输入框里有字都不投；这几种 herdr 自己照样会写入粘贴加回车。
5. **聚焦的那一格**（`focused: true`，开发者的键盘最可能在那里）：隔 1 秒再读一次，两次都可投才投。
6. **紧贴投递再核一次**：`agent.get` 的会话键、目录、状态与 `state_change_seq` 都与判定时相同，才调 `agent.prompt`。

**投递之后**：调 `agent.prompt` 之前先从面板的订阅收下这一格在投递窗口里的 `pane.agent_status_changed`；先看 `agent.prompt` 的返回体，约 500 毫秒后再 `agent.get` 一次。
- 会话键变了记 `delivered_maybe_wrong_session`；
- 状态是 `blocked` 且 `state_change_seq` 与投递前不同，记 `delivered_into_blocked`（回车可能确认了刚弹出的确认界面，界面醒目提示马上看终端）；
- 返回体里是 `blocked`，或窗口里这一格的状态事件出现过 `blocked`，也记 `delivered_into_blocked`（`code: passed_blocked`）：确认界面弹出后又被回车确认，会话已回到 working，只看最后的状态看不出来。herdr 没认出的 `blocked` 不会有事件，这种照样看不出来；
- 面板这时的订阅没订着这一格（还没连上、断线重连中、pane 刚出现还没换连接），或者窗口里订阅断过，记 `delivered` 加 `code: unwatched`：投递照样算办完，只剩前两条核对，界面注明没核对确认界面。不再用状态序号的差值退而求其次，它数不出这一格变了几次（见“状态序号”）；
- herdr 回 `agent_prompt_stalled`、`timeout` 或本地 `client_timeout` 都记 `uncertain`：已经写入，不重发。

**手动发送**（会话已更换后发给新会话、没有可通知的会话时选一个、旧答复、这个版本不自动投）与会话页的文字过同样的判据，只是不要求“空闲稳定”；正向白名单不过时先把屏幕末尾给开发者看，确认之后才发。

**按键的逻辑名与字节**（0.9.3，S0 用 raw 模式的假 TUI 核实）：

| 键名 | 字节 | 面板的按钮 |
|---|---|---|
| `up`、`down` | `\x1b[A`、`\x1b[B` | 单击即发 |
| `shift+tab` | `\x1b[Z` | 两步确认（切换权限模式） |
| `enter` | `\r` | 两步确认（会确认确认界面上的缺省项） |
| `esc` | `\x1b` | 两步确认 |
| `ctrl+c` | `\x03` | 两步确认；同一格 3 秒内只允许一次（Claude 连按两次会退出） |
| `y`、`n` | 原样 | 两步确认；**能不能回答 Claude 的确认界面没有核实** |

**S0 的取样**（只读或在命名会话 `nbdev-test` 里，不发提示词、不产生模型调用）：

- 真实 Claude 2.1.296：空输入框里有暗色的占位文字 `Try "…"`，`live_prompt_box` 的预览里也带着它（`detection` 的文字不带转义，`visible` 的 ANSI 才看得出 `\x1b[2m`），判据因此认暗色文字为空；`?` 快捷键说明打开时输入框仍空，可投；第一次进目录的信任确认判 `blocked`（`live_blocked_form`）。退出要连按两次 Ctrl+C。
- 真实 omp：见上面的判据；`/` 命令表的最后一行是菜单项。Ctrl+C 两次不退出，Ctrl+D 退出。
- 默认 server 0.9.1 上一格真实 Claude 的输入框里有开发者没发出的半截字，`live_prompt_box` 照样命中、预览不空：正向判据挡住了它。
- 样本在 `tests/fixtures/screens.json`（`src/herdr/screens.test.ts` 用）。

**向 herdr 提的需求**（这几条做了，判据才能真正闭合）：写回车之前复查 `blocked`；`agent.prompt` 带期望的会话 id 与状态，不符就不写；会话 id 变化推一条事件；`ping` 报 API 能力；不认识的参数报错而不是静默忽略。

## 终端流（t12）

网页终端的画面与键盘不走 socket 的 JSON 接口，走 herdr 命令行的两条流，一个浏览器连接一个子进程（面板怎么用见 [panel.md](panel.md#网页终端t12)）。下面是客户端 0.9.3 的行为，2026-10-13 在命名会话里实测（计划前的探测、设计审查与 L4）；标了 L4 的几条在 server 0.9.3 与 0.9.1 上都核对过（`tests/herdr-live.test.ts`，两组）。

- **命令**：`herdr terminal session observe <terminal id> --cols C --rows R`（只看）、`herdr terminal session control <terminal id> [--takeover] --cols C --rows R`（控制端）。target 必须写在选项前面（写在后面报 unknown option、退出码 2）；target 一律用 terminal id，pane 跨 workspace 移动换 pane id 时流不断（设计审查在 0.9.1 与 0.9.3 上实测）。
- **起法**：`setpriv --pdeathsig TERM -- setsid <herdr> terminal session …`，stdin、stdout、stderr 都是管道，不要 pty。环境只给 `HOME`、`PATH`、`HERDR_SOCKET_PATH`。
  - `setpriv --pdeathsig`：observe 不读 stdin，stdin 关掉不退出，读端没了、pane 有输出时也不退出；面板被 SIGKILL 时只有 pdeathsig 收得掉它（L4：父进程被 SIGKILL 之后 observe 与 control 都退出，控制权随之释放）。pdeathsig 跨 exec 保留。
  - `setsid`：子进程自成一个会话。前台运行 `panel serve` 时终端里的 Ctrl+C 打给整个前台进程组，没有它子进程会与面板同时收到 SIGINT，面板来不及先改回尺寸再 release。
  - 找不到 `setpriv` 或 `setsid`（util-linux）时终端功能整个关掉（`/api/meta` 的 `terminal.reason`）。herdr 的路径先看 `NBDEV_HERDR_BIN`（绝对路径），再找 `PATH`。
- **连的是哪个 socket**：`terminal session` 不连 `HERDR_SOCKET_PATH` 指的 JSON 接口，而是连旁边推出来的 `<socket 去掉 .sock>-client.sock`（TUI 的私有协议），不在就直接失败，不退回默认会话。`sun_path` 最长 108 字节，推出来的路径太长会报错；命名会话 `nbdev-test` 推出来的路径不超过 107 字节（L4 核对）。
- **输出**：stdout 一行一个 JSON。
  - 帧：`{"type":"terminal.frame","seq":N,"full":bool,"width":W,"height":H,"encoding":"ansi","bytes":"<base64>"}`。第一帧 `full: true`（以 `\e[2J\e[1;1H` 重画整屏），之后是增量；面板不解码，原样转给浏览器。
  - 结束：`{"type":"terminal.closed","reason":"…"}` 之后退出码 0。原因原文只作显示与日志，归类不看它（见下）。
  - 帧里的私有模式只有 `?2026`（同步输出）与 `?25`（光标显隐），**没有应用开的模式**：应用开了 bracketed paste（`?2004h`）、鼠标跟踪，帧里都没有。真实 Claude 2.1.296 与 omp 启动后都开着 `?2004h`（S0 在 pty 里录下启动后 8 秒的输出，没发提示词、没有模型调用），所以网页给 Agent pane 在本地打开 bracketed paste。
- **输入**：stdin 一行一个 JSON：`{"type":"terminal.input","text":"…"}`、`{"type":"terminal.resize","cols":C,"rows":R}`、`{"type":"terminal.release"}`。写错的行只在 stderr 报 input ignored，进程不退。
- **尺寸**：
  - control 一连上就把真实终端改成它的 `--cols`、`--rows`（`stty size` 立刻变），`terminal.resize` 立刻生效，release 之后尺寸保持；不带尺寸时用缺省的 120×40，不是原来的尺寸。所以面板在释放前先发一次 resize 改回接管前的尺寸。
  - observe 只按自己的视口出帧，不改真实尺寸；视口比真实终端大时补空白、小时裁掉右下，帧里分不出哪些是补的。所以观看要先知道真实尺寸。
  - 真实尺寸从 pane 的 pty 读：`pane.process_info` 的 `shell_pid` → `/proc/<pid>/fd/0` 指向的 `/dev/pts/N` → `stty -F /dev/pts/N size`（只读的 `TIOCGWINSZ`）。L4 核对它与 pane 里 `stty size` 一致。`pane.get` 的 `viewport_rows` 只有行数，`pane.layout` 是含边框的布局格子、TUI 不挂时是无头缺省值，都不用。读不到时按 120×40 看，释放时不改回。
  - TUI 改窗口尺寸不推任何事件，所以观看期间每 5 秒复查一次 pty 尺寸。
- **控制者只有一个**：同一终端同时只有一个 control；TUI 客户端不占这个名额。已有控制者时不带 `--takeover` 的 control 第一行就是结束（原文是 already has an attached client），带 `--takeover` 的抢走、前一个收到结束（原文是 taken over）。`terminal.release`、关 stdin、SIGTERM、SIGKILL 之后控制权都释放（随后不带 takeover 的 control 能连上）。
- **结束原因的归类**只看三样：第一行是帧还是结束、这条流是不是我们发过 release 的、结束之后按 terminal id 在 pane 列表里这个终端还在不在。不看原因文案（L3 的假命令行换一种文案，归类不变）。
- **接管不独占输入**：control 连着的时候，`agent.prompt` 照样把粘贴加回车写进 pane，`agent.send_keys` 也照样写，读屏判定照常；TUI 里打的字照样进 pane。herdr 只限制“控制端只有一个”并改尺寸。所以面板与 t11 的互斥由面板自己保证（这格被本面板接管时通知、文字、按键都不发，见 [panel.md](panel.md#网页终端t12)），本面板之外的程序调 `agent.prompt` 不受约束。
- **TUI 在接管中改不动尺寸**：TUI 挂着时，control 连着期间 TUI 改窗口、移焦点都改不动这格的尺寸；release 之后 TUI 立刻按自己的布局改回，之后 TUI 改窗口 pane 跟着变（L4 在两种 server 上都核对，客户端 0.9.3 是开发者现在的组合）。**TUI 收不到任何“网页在接管”的提示**，开发者在 TUI 那边只看到尺寸变了。
- **时延与开销**：control 打字到两个 observe 都收到帧 3 到 20 毫秒（L4 记录，两种 server 相同）。经 Bun 的 socket 调 `pane.send_text` 再到收到帧，三次实测 19、106、110 毫秒：时而多出约 100 毫秒，与上面“时延”一条的现象相符，原因同样未查明，所以 L4 不拿它判。一个 observe 子进程常驻约 6.6 MB、1 个线程；100×30 的整屏帧约 5.8 KB（base64 之后）。herdr 读端跟不上时自己合并帧。

**向 herdr 提的需求**（终端流）：control 的只输入模式或接管时通知别的客户端（TUI 能看到“网页在接管”）；pane 的真实列数（现在只能读 pty）；尺寸变化推事件；observe 在读端消失时退出；`ping` 报终端流的能力。

## 版本与降级

| 能力 | 0.9.1（本机默认 server） | 0.9.3（命名会话） |
|---|---|---|
| `agent.get`、`agent.explain`、`agent.read`（`detection`、`visible`） | 有，字段与 0.9.3 相同（S0 只读核对） | 有 |
| `agent.prompt`、`agent.send_keys` | 二进制里有；S0 不对默认 server 投递，没有实测 | 实测（S0、L4） |
| `pane.agent_status_changed` 推送 | 没有实测 | 约 0.2 秒 |
| 终端流（`terminal session observe`、`control`，客户端 0.9.3） | 在命名会话里用同一份 0.9.1 二进制当 server 实测可用（L4，行为同右） | 实测（L4） |
| `ping` 的 capabilities | 不含 API 能力 | 不含 API 能力 |

`ping` 报不出 API 能力，herdr 又静默忽略不认识的参数，所以只能按版本放行：0.9.1 与 0.9.3 自动投递通知；其它版本只给手动发送（`/api/meta` 的 `herdr.autoNotify` 为 false），判据照旧。

- 本机默认 server 是 0.9.1（协议 22），客户端 0.9.3。上面的方法与字段按客户端 0.9.3 自带的 schema 与实测写成；`pane.report_metadata` 的 `tokens` 与 `ttl_ms` 在 0.9.3 的命名会话里实测可写可清，**在默认 server 0.9.1 上没有实测**：它的二进制里有这些字段名，但若对不认识的字段静默忽略，nbdev 收不到错误。各项能力按 server 版本判断，合入后由主 Agent 在真实会话上核对。
- herdr 不可用（socket 不存在、拒绝连接、超时）：命令照常完成。认不出只靠 `HERDR_PANE_ID` 的调用者（给 `herdr_unavailable` 警告）；租约只按会话进程与 24 小时判断；运行只按 Claude 的工具标记归属。
- 写标签失败只给 `herdr_tag_failed` 警告，标签只用于显示，以租约文件为准。写之前先看 pane 列表里这格的 `cwd` 与 `foreground_cwd`：都不在被操作仓库的某个 checkout 里时不写（`herdr_tag_skipped`，`reason: other_repository`；在测试的临时仓库里运行 nbdev 时，调用者的 pane 是真实的工作 pane）；调用者的会话进程不在那格 pane 的前台时也不写（`herdr_tag_skipped`）。
