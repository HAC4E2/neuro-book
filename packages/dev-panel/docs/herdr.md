# herdr 适配

nbdev 经 herdr 认会话、写 pane 标签、找运行所在的 pane。本文写用到的接口、白名单、降级方式与版本假设。实现在 `src/herdr/client.ts`。

## socket 与协议

- 位置按顺序取：`HERDR_SOCKET_PATH`；`HERDR_SESSION`（命名会话，`~/.config/herdr/sessions/<名>/herdr.sock`）；默认会话 `~/.config/herdr/herdr.sock`。命令行从调用者的环境变量里取，测试一律指到命名会话或假 socket。
- 协议：一行一个 JSON，请求 `{id, method, params}`，响应 `{id, result}` 或 `{id, error: {code, message}}`。客户端每次调用开一个连接，读到第一个换行为止并核对 `id`。
- 时限：单次调用 2 秒；`status`、`lease list` 给整个客户端 2.5 秒的总时限，用完之后的调用直接报超时，命令按 herdr 不可用继续。
- 时延：在本机默认 server 0.9.1 上，Bun 客户端的单次调用有一部分（实测 5% 到 50%，随负载变化）要多等约 100 毫秒，原因未查明；改成连接建立前就写请求没有改善（2026-10-12 实测）。所以 `status`、`lease list` 一次调用里 `pane.list` 只取一次，`ping` 与 `pane.list` 并发，减少串行的调用。
- 客户端的三个选项只给一次命令用完即弃的客户端（命令行）开：`budgetMs`（总时限从创建时算起）、`memoizeAvailability`（只 ping 一次）、`memoizePanes`（pane 列表只取一次）。常驻的客户端（面板）不开，否则 herdr 一时不在就永远判为不可用、预算期过后永远超时、pane 列表永远是旧的。

## 白名单

herdr 的 socket 没有鉴权，连上就能调全部方法（含 `server.stop`、`pane.run`）。白名单由调用方显式传入，白名单外的方法在客户端直接拒绝，不发出去：

| 清单 | 方法 | 谁用 |
|---|---|---|
| `HERDR_READ_METHODS` | `ping`、`pane.list`、`pane.process_info` | `status`、`lease list` |
| `HERDR_CLI_METHODS` | 上面三个加 `pane.report_metadata` | 写命令（只为写调用者自己 pane 的标签） |
| `HERDR_PANEL_READ_METHODS` | `HERDR_READ_METHODS` 加 `session.snapshot`、`events.subscribe`；t11、t12 再按 Proposal 第八节第 7 条补齐，其中没有 `pane.report_metadata` | 面板 |

## 用到的接口

| 方法 | 用途 | 关键字段 |
|---|---|---|
| `ping` | 判断 herdr 是否可用 | `version` |
| `pane.list` | 各 pane 上是哪个 Agent 会话、状态 | `pane_id`、`terminal_id`、`agent`、`agent_status`、`agent_session {agent, kind, value}`；Claude 的 `value` 是会话 id，omp 的是会话文件路径 |
| `pane.process_info` | pane 的 shell 与前台进程（运行归属、omp 的主进程、写标签前确认调用者在这格 pane 的前台） | `shell_pid`、`foreground_process_group_id`、`foreground_processes[].pid`；pane 不存在为 `pane_not_found` |
| `pane.report_metadata` | 写或清 `work`、`task` 两个 token | `source: "nbdev"`、`tokens`（值为 `null` 即清除）、`ttl_ms: 86400000` |
| `session.snapshot`（面板） | 全部 pane、所在 workspace 与各 Agent 的状态序号 | `{type: "session_snapshot", snapshot: {version, workspaces[], panes[], agents[]}}`；`panes[]` 带 `cwd`、`foreground_cwd`、`agent_status`、`agent_session`，`agents[]` 带 `state_change_seq` |
| `events.subscribe`（面板） | pane 增减与状态变化的推送 | 单独一条长连接：先回 `{id, result: {type: "subscription_started"}}`，之后每行一个 `{event, data}`；订阅类型由面板写死，不订带终端正文的 `pane.output_matched` |

认调用者与 `status` 都直接用 `pane.list` 带的 `agent`、`agent_session`、`agent_status`，不调 `agent.list`、`agent.get`（所以它们不在白名单里）；各 pane 的 `process_info` 并发调用，单个失败就跳过这格并给 `herdr_partial` 警告。

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
- **轮询退路**：真实会话上 `pane.agent_status_changed` 会不会推送没有核实（命名会话里的假 pane 不推；默认 server 上观察期间没有状态变化），所以有浏览器连着时每 500 毫秒轮询一次 `pane.list`，事件只当加速；新出现或消失的 pane 触发快照对账。
- herdr 不阻塞面板开始服务：面板先用“herdr 不可用”的状态起来，快照随后补上。

## 版本与降级

- 本机默认 server 是 0.9.1（协议 22），客户端 0.9.3。上面的方法与字段按客户端 0.9.3 自带的 schema 与实测写成；`pane.report_metadata` 的 `tokens` 与 `ttl_ms` 在 0.9.3 的命名会话里实测可写可清，**在默认 server 0.9.1 上没有实测**：它的二进制里有这些字段名，但若对不认识的字段静默忽略，nbdev 收不到错误。各项能力按 server 版本判断，合入后由主 Agent 在真实会话上核对。
- herdr 不可用（socket 不存在、拒绝连接、超时）：命令照常完成。认不出只靠 `HERDR_PANE_ID` 的调用者（给 `herdr_unavailable` 警告）；租约只按会话进程与 24 小时判断；运行只按 Claude 的工具标记归属。
- 写标签失败只给 `herdr_tag_failed` 警告，标签只用于显示，以租约文件为准。写之前先看 pane 列表里这格的 `cwd` 与 `foreground_cwd`：都不在被操作仓库的某个 checkout 里时不写（`herdr_tag_skipped`，`reason: other_repository`；在测试的临时仓库里运行 nbdev 时，调用者的 pane 是真实的工作 pane）；调用者的会话进程不在那格 pane 的前台时也不写（`herdr_tag_skipped`）。
