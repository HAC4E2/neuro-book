# t07 实施计划：会话身份、运行归属与租约

草案，交主 Agent 与设计审查（编码子代理 2026-10-12 写）。范围以 [实施计划的 t07 一节](../t03-design/plan.md#t07-会话身份运行归属与租约) 为准，设计依据是 [Proposal](../../../../../docs/proposals/dev-panel.md) 第四节（会话、运行、租约、运行时登记）、第六与第七节里 herdr 只读调用的部分、待决问题 10（herdr 外的会话用 `--as`），以及 t03 的 [会话托管调研](../t03-design/session-hosting-research.md)。

## Context

- **要解决的问题**：t06 之后，`nbdev` 能领号、建记录、改状态，但不知道是谁在调用。Work 视角要回答“现在有谁在动它”，t11 的通知要知道“答复之后通知谁”，两者都要求命令行认出调用它的会话，并在 Task 相关操作时留下临时的租约。会话 idle 时它派出的 omp 审查、测试、开发服务可能还在跑，`status` 要把会话与它的运行分开列出。
- **已定的决定**：租约不入库，会话消失或 24 小时没有 Task 相关操作即失效（决定 14）；“最近活动”超过 2 小时淡化显示；运行不持有租约；herdr 外的会话用 `--as <标签>`，拿不到就记为未知（待决问题 10）；写 herdr pane 标签并在 `.local/agent` 留一份（调研推荐，开发者无异议）。
- **前提**：t06 已合入集成分支（`821e2323b`），写事务、`readProjectStatus`、登记表都在。
- **工作方式**：同 t06。集成分支 `feat/w00022-dev-panel`，每片单独提交，编码子代理不 push；记录只在主工作区改。L4 测试另建命名 herdr 会话 `nbdev-test`，用完删除，不碰默认会话。
- **约束**：
  - 只支持 Linux（依赖 `/proc` 与 herdr）。
  - 新代码同样只用 Node 兼容 API：herdr 客户端用 `node:net`，`/proc` 用 `node:fs`。
  - 身份解析只在命令行边界做；核心函数只接收显式传入的 `caller` 与 `herdr`。这样根脚本测试与包内的进程内测试都不会碰到真实的 herdr 与会话环境变量（见“风险”）。

## 环境核实（2026-10-12，本机只读）

| 事项 | 结论 | 怎么查的 |
|---|---|---|
| Claude Code 子代理的环境 | 有 `CLAUDE_CODE_SESSION_ID`（等于父会话 id `d02974de…`，也等于 herdr 报的 `agent_session.value`）、`CLAUDE_CODE_CHILD_SESSION=1`、`CLAUDE_PID`（Claude 主进程，与父会话相同）、`HERDR_PANE_ID=w1:p16`、`HERDR_SOCKET_PATH`、`HERDR_TAB_ID`、`HERDR_WORKSPACE_ID`、`HERDR_ENV=1`、`CLAUDECODE=1` | 本子代理的 `env` |
| 主会话的 Bash 是否也有 `CLAUDE_CODE_CHILD_SESSION` | **没能核实**。子代理与主会话在同一个 Claude 进程里，`/proc/<CLAUDE_PID>/environ` 只有进程启动时的变量。另一个会话（`568d0811`）的 Bash 子 shell 里也有 `CHILD_SESSION=1`，看不出是不是子代理。这个变量很可能表示“这个 shell 是 Claude 派出的”，而不是“这是子代理”。设计不依赖它：子代理与父会话同一个 id，租约本来就记在父会话名下 | `/proc/*/environ` 扫描 |
| `herdr agent get <pane>` | 返回 `{id, result: {type: "agent_info", agent: {agent, agent_session: {agent, kind, source, value}, agent_status, cwd, foreground_cwd, pane_id, tab_id, terminal_id, terminal_title, workspace_id, …}}}`；Claude 的 `kind: "id"`、`value` 是会话 id；omp 的 `kind: "path"`、`value` 是会话 jsonl 路径。pane 上没有 Agent 时返回 `{error: {code: "agent_not_found"}}`，退出码 1 | `herdr agent get w1:p16`、`w1:pJ` |
| `herdr agent list` | `result.agents[]`，元素同上；当天默认会话 10 个 Agent（9 个 Claude、1 个 omp），状态取 `idle`、`working`、`blocked`、`done`、`unknown` | `herdr agent list` |
| `herdr pane process-info` | `result.process_info = {pane_id, shell_pid, foreground_process_group_id, foreground_processes: [{pid, name, argv, cmdline, cwd}]}`；开发服务那一格前台有 3 个进程（同一进程组） | `--pane w1:p16`、`w1:pJ`、`w1:pN` |
| herdr 不在 | `{error: {code: "server_not_running"}}`，退出码 1 | `HERDR_SOCKET_PATH=/nonexistent herdr agent list` |
| socket 协议 | 一行一个 JSON：`{"id","method","params"}` 对 `{"id","result"}` 或 `{"id","error":{code,message}}`；`ping` 0.3 毫秒，返回 server 0.9.1、协议 22 | 原始 socket 上的 `ping` |
| pane 标签 | `pane.report_metadata` 的 `tokens` 最多 16 个、名字 `^[A-Za-z0-9_-]{1,32}$`，`ttl_ms` 最大 86400000；`PaneInfo` 与 `AgentInfo` 有 `tokens` 字段。默认 server 的 `pane get` 输出里没有 `tokens` 字段，可能是 0.9.1 不支持，也可能是空值不输出；对默认会话禁止写，**没核实** | `herdr api schema --json`（客户端 0.9.3 自带的 schema） |
| omp 在 herdr 外的会话 id | **没有**。omp 的 bash 工具只给子进程加 `OMPCODE=1`、`CLAUDECODE=1`、`GIT_EDITOR`、`GPG_TTY`、`CI`；`PI_SESSION_FILE` 只给 eval 内核。herdr 里的 omp 靠 `herdr agent get $HERDR_PANE_ID` 拿到会话文件路径；herdr 外只能 `--as` | omp 安装包 `dist/cli.js` 与 omp 进程的 `/proc/*/environ` |
| `/proc` 父进程链 | 本会话：bash → `claude`（1506927，即 `CLAUDE_PID`，也是 `w1:p16` 的前台进程）→ zsh（1506487，`w1:p16` 的 `shell_pid`）→ herdr server（65642）。pane 的 shell 都是 herdr server 的子进程 | `/proc/<pid>/stat`、`process-info` |
| 父进程链的反例 | herdr 说 `w1:pK` 的会话是 `568d0811`，但那一格的前台进程是另一个 `claude`（810784）；`568d0811` 的进程（410323，`claude --session-id 568d0811…`）的父进程链是 410311 → 1，不经过任何 pane。它派出的 w00005 长任务（`bun`）按父进程链会归“无主”；而这些进程的环境里有 `CLAUDE_CODE_SESSION_ID=568d0811`、`HERDR_PANE_ID=w1:pK`，按环境变量能认对 | `/proc/*/environ`、`ps` |
| 本仓库 cwd 下的其它进程 | VS Code server 的 node（约 15 个）、一个 `codex` 守护进程（ppid 1）、herdr pane 的 shell、各 Claude 主进程。它们都不是“运行”，归属算法要排除 | `/proc/*/cwd` 扫描 |
| 命名会话 | `herdr session list --json` 现在只有 `default`；命名会话的 socket 在 `~/.config/herdr/sessions/<名>/herdr.sock`，解析顺序 `--session` > `HERDR_SOCKET_PATH` > `HERDR_SESSION` > 默认（调研第一节）。启动命名会话的 headless server 的具体命令留到实施时在 `nbdev-test` 里核实 | `herdr session list --json`、调研 |

## 关键设计

设计审查（[`evidences/design-review.txt`](evidences/design-review.txt)）之后的版本；逐条对应见文末“设计审查的处理”。

### `src/herdr/client.ts`：herdr 客户端（新目录，Proposal 第一节的 `src/herdr/`）

```ts
export type HerdrAgentSession = {agent: string; kind: string; value: string};
export type HerdrPane = {paneId: string; terminalId: string; agent: string | null; status: "idle" | "working" | "blocked" | "done" | "unknown"; session: HerdrAgentSession | null};
export type HerdrProcessInfo = {paneId: string; shellPid: number | null; foregroundPids: number[]};
export const HERDR_CLI_METHODS: readonly string[];   // ping、agent.list、agent.get、pane.list、pane.process_info、pane.report_metadata
export const HERDR_READ_METHODS: readonly string[];  // 去掉 pane.report_metadata；status 用它
export function resolveHerdrSocket(env: NodeJS.ProcessEnv): string;   // HERDR_SOCKET_PATH > HERDR_SESSION > ~/.config/herdr/herdr.sock
export function createHerdrClient(options: {socketPath: string; allow: readonly string[]; callTimeoutMs?: number; budgetMs?: number}): HerdrClient;
// HerdrClient：socketPath、availability()、listPanes()、getAgent(target)、processInfo(paneId)、reportTaskTokens(paneId, tokens)、clearTaskTokens(paneId)
```

- 直接连 socket（`node:net`），一行一个 JSON；每次调用一个连接，读到换行为止并核对 `id`。
- 白名单由调用方传入：命令行写命令用 `HERDR_CLI_METHODS`，`status` 用只读的 `HERDR_READ_METHODS`，面板的清单留给 t11（照 Proposal 第八节第 7 条，里面没有 `pane.report_metadata`）。白名单外的方法在客户端直接抛错，不发出去。
- 时限：单次调用 2 秒；`budgetMs` 给整个客户端一个总时限（`status` 用 2.5 秒），用完之后的调用直接报超时。
- 失败分类只看错误码：socket 不存在或 `ECONNREFUSED` 为 `server_not_running`，超时为 `timeout`，响应不合规为 `protocol_error`；herdr 的 `error.code`（`agent_not_found`、`pane_not_found` 等）原样带出。
- 写标签：`source: "nbdev"`、`tokens: {work, task}`、`ttl_ms: 86400000`；清除时这两个 token 的值为 `null`。只用于显示，失败只给 `herdr_tag_failed` 警告。默认 server 是 0.9.1，标签能力按 server 版本判断，写进 `docs/herdr.md`。

### `src/core/procfs.ts`：读 `/proc`

`processStartTicks`（已在 t06 的 `lock.ts`，挪到这里共用）、`readEnviron(pid)`、`readProcessTable()`（ppid、startTicks、comm、cmdline、cwd；`comm` 按最后一个 `)` 切）、`systemdUnitOf(pid)`（读 `/proc/<pid>/cgroup`）、`bootTime()`（`/proc/stat` 的 `btime`）。进程启动时刻换算成时间用 `btime + startTicks / 100`：Linux 的 USER_HZ 固定为 100，Node 拿不到 `sysconf(_SC_CLK_TCK)`，这个假设写进文档。

### `src/core/identity.ts`：认出调用者

```ts
export type SessionRef = {key: string; agent: string; sessionId: string | null; label: string | null; parentSessionId: string | null};
export type ProcessRef = {pid: number; startTicks: string};
export type CallerHerdr = {socketPath: string; paneId: string; terminalId: string; status: HerdrPane["status"]; managed: boolean};
export type Caller =
    | {kind: "session"; ref: SessionRef; via: "as" | "claude-env" | "herdr-pane"; process: ProcessRef | null; herdr: CallerHerdr | null}
    | {kind: "unknown"; reason: "no_identity" | "herdr_unavailable" | "pane_without_agent"; herdrPaneId: string | null};
export function resolveCaller(input: {env: NodeJS.ProcessEnv; as?: string; herdr: HerdrClient | null}): Promise<{caller: Caller; warnings: Warning[]}>;
```

判定顺序：

1. `--as <标签>`：外部会话，`key = external:<标签>`，标签取 `^[A-Za-z0-9._-]{1,64}$`。显式标签优先。标签要唯一（两个外部会话用同一个标签会被当成一个会话），在 herdr pane 里用 `--as` 时不写 pane 标签。
2. `CLAUDE_CODE_SESSION_ID`：只在同时有 `CLAUDE_PID`、这个进程还活着、id 是 UUID 格式时才信，否则忽略并给 `claude_env_untrusted` 警告，继续往下判。可信时：
   - 子代理与 Agent 工具派出的进程都继承这两个变量，记在同一个会话名下；
   - **嵌套的 `claude -p`**：读 `/proc/$CLAUDE_PID/environ`，里面也有 `CLAUDE_CODE_SESSION_ID=X`（顶层 Claude 进程的环境里没有这个变量），就归到外层会话 X，`parentSessionId` 记 X，进程记外层的 `CLAUDE_PID`；最多向上找 5 层；
   - `process` 记 `CLAUDE_PID` 与它的启动时刻；
   - 有 `HERDR_PANE_ID` 且 herdr 可用时，记下 pane、terminal、状态；`managed` 表示 herdr 的列表里现在能找到这个会话 id。
3. 只有 `HERDR_PANE_ID`（omp 与其它 Agent）：pane 必须在 `pane.list` 里；用那格 pane 的 `agent_session` 认人，`key = <agent>:<value>`；`process` 从 `pane.process_info` 记下前台主进程。pane 上没有 Agent 为 `unknown/pane_without_agent`；herdr 不可用为 `unknown/herdr_unavailable`，并给 `herdr_unavailable` 警告。
4. 都没有：`unknown/no_identity`。

未知调用者不自动取得租约，写命令照常完成并给 `caller_unknown` 警告；`lease take`、`release` 报 `caller_unknown`（2）。

### `src/core/leases.ts`：租约

文件 `.local/agent/run/leases/<leaseId>.json`，`nbdev.lease/v1`：

```json
{
    "schema": "nbdev.lease/v1",
    "leaseId": "3f2a…（sha256(sessionKey + 换行 + workId + / + taskId) 的前 24 位）",
    "workId": "w00022-dev-panel",
    "taskId": "t07-session-leases",
    "session": {
        "key": "claude:d02974de-3474-4f89-a563-45b5c8d8b06d", "agent": "claude", "sessionId": "d02974de-3474-4f89-a563-45b5c8d8b06d",
        "label": null, "parentSessionId": null,
        "process": {"pid": 1506927, "startTicks": "123456"},
        "herdr": {"socketPath": "/home/…/herdr.sock", "paneId": "w1:p16", "terminalId": "term_65d9e5295b4cd26"}
    },
    "acquiredAt": "2026-10-12T19:00:00.000Z",
    "lastActivityAt": "2026-10-12T19:05:00.000Z",
    "lastAction": "task status",
    "releasedAt": null,
    "releaseReason": null
}
```

```ts
export type LeaseState = "valid" | "released" | "task_closed" | "expired" | "session_gone" | "superseded";
export function leaseId(sessionKey: string, workId: string, taskId: string): string;
export function touchLease(mainRoot: string, input: {caller: SessionCaller; workId: string; taskId: string; action: string; now: Date}): Promise<LeaseRecord>;
export type LeaseSelector = {kind: "task"; workId: string; taskId: string} | {kind: "session"; sessionKey: string; workId?: string; taskId?: string};
export function releaseLeases(mainRoot: string, selector: LeaseSelector, reason: "released" | "task_done" | "task_shelved", now: Date): Promise<LeaseRecord[]>;
export function readLeases(mainRoot: string): Promise<{leases: LeaseRecord[]; warnings: Warning[]}>;
export function getLease(mainRoot: string, leaseId: string): Promise<LeaseRecord | null>;     // t11 用
export function evaluateLease(lease: LeaseRecord, context: LeaseContext): EvaluatedLease;       // t11 用
export function evaluateLeases(leases: readonly LeaseRecord[], context: LeaseContext): EvaluatedLease[];
// LeaseContext：now、taskStatus(workId, taskId)、processAlive(process)、herdr: {socketPath, sessionIds} | null
```

- **取得与续期是同一个动作，每次都用本次解析出的调用者重写整个 `session`**（process、herdr、label、parentSessionId）。旧记录已释放、超过 24 小时、进程变了（pid 或 startTicks 不同），或旧进程已不在，就按“重新取得”处理：`acquiredAt` 改为当下、清掉 `releasedAt`。`claude --resume` 沿用会话 id 但换了进程（本机 9 个 Claude 会话里有 5 个是 `--resume` 或 `-c` 起的），不重写就永远是 `session_gone`。
- **有效性在读取时现算**，按顺序：
  1. 已释放：`released`；
  2. 所属 Task 现在的状态是 `done` 或 `shelved`：`task_closed`（释放文件只是记录，竞争中丢了也不影响结果）；
  3. 超过 24 小时没有 Task 相关操作：`expired`；
  4. 记了 `process` 而进程已不在或启动时刻不同：`session_gone`（所有 Claude 会话与记了主进程的 omp 会话都按这一条）；
  5. 同一个进程（pid 加 startTicks）后来出现了别的会话 id（`/clear`、后台副本）：较早的会话的租约为 `superseded`；
  6. 其余为 `valid`。
- **herdr 不判失效**：herdr 列表里找不到这个会话只表示 `managed: false`（现在不能通知），不单独判失效。herdr 的钩子会被同一格 pane 里嵌套的 `claude -p`、后台副本改写，按 herdr 判会让活着的会话来回失效。只有租约记的 `socketPath` 与本次评估用的 socket 相同时才算 `managed`。决定 14 的“会话在 herdr 里消失即失效”因此改为“会话进程不在即失效”，已记入待确认清单。
- `stale`：超过 2 小时没有 Task 相关操作，只用于淡化显示。
- 写法：临时文件名带 pid 与随机数，原子改名替换；`readLeases` 只认 `^[0-9a-f]{24}\.json$`。租约不进写事务：有效性现算，写入互相覆盖最坏只丢一次 `lastActivityAt` 更新，不会让已关闭的 Task 重新有人“在动”。CONTEXT 的不变量 5 相应改写。
- 失效与释放的文件不删；读到坏文件给 `unreadable_lease` 警告并跳过。时钟全部经参数注入。

### `src/core/runs.ts`：运行的发现与归属

```ts
export type RunView = {pid: number; startedAt: string; command: string; cwd: string; checkout: string;
    owner: SessionRef | null; ownerVia: "tool-env" | "pane" | null; paneId: string | null; unit: string | null; descendants: Array<{pid: number; command: string}>};
export function discoverRuns(input: {processes: ProcessEntry[]; checkoutRoots: string[]; selfPid: number; panes: PaneProcesses[]; bootTime: number}): {runs: RunView[]; ignored: number};
```

1. 候选：cwd 在任一 checkout 下的进程（只读本用户的进程，`environ` 只对候选与它们的祖先读）。
2. 排除：
   - Agent 进程：有 Agent 的 pane 的前台进程，以及任何环境里出现过的 `CLAUDE_PID`；
   - pane 的 shell；
   - 调用者自己与它的全部祖先。
3. 合并：父进程也是候选的并入父进程的运行，最上面的是根，其余列入 `descendants`（最多 5 个）。
4. 归属只认 Agent 工具派出的进程（工具标记：Claude 是 `CLAUDE_PID`，omp 是 `OMPCODE=1`）：
   - 有 `CLAUDE_PID` 与可信的 `CLAUDE_CODE_SESSION_ID`：归那个 Claude 会话（嵌套的按身份规则归外层），`ownerVia: "tool-env"`；
   - 有 `OMPCODE=1` 且 `HERDR_PANE_ID` 指向一格现存、有 Agent 的 pane：归那格 pane 的会话；
   - 没有工具标记（只有 `HERDR_PANE_ID` 的也算没有）：沿父进程链向上，先碰到 Agent 进程的是 Agent 的内部进程（MCP 服务、omp 的 broker），排除；先碰到 pane 的 shell 或前台进程的，那格有 Agent 就归它（`pane`），没有就归无主；
   - 链走到底也没碰到：进程在用户级 systemd 的服务单元里（cgroup 为 `…/app.slice/<unit>.service`，且单元名不以 `app-` 开头，那是桌面程序），列为无主并带单元名（`systemd-run` 起的长驻进程）；其余不算运行，只计入 `ignored`（codex 守护进程、`claude bg-pty-host`、Claude 的 daemon 与 spare、VS Code 的进程、VS Code 终端里起的进程都在这里）。
   - `HERDR_PANE_ID` 指向 `pane.list` 里没有的 pane，视为没有线索。
5. herdr 不可用：没有 pane 信息，只按工具标记里的 Claude 那一条归属，其余记无主或忽略，并给 `herdr_unavailable` 警告。
6. `startedAt` 用 `btime + startTicks / 100`。运行不持有租约、不写文件；`run/procs/` 是 t14 的。

### 核心入口：`setTaskStatus` 与带租约的新建（`src/core/operations.ts`）

```ts
export type LeaseOptions = {caller: Caller | null; herdr: HerdrClient | null};
export function setTaskStatus(context, input: {workRef; taskRef; status; includeUncommitted?; expectedHash?}, options: TransactionOptions & LeaseOptions): Promise<OperationResult<SetStatusResult & LeaseEffects>>;
// createWork、createTask 的 options 同样接受 LeaseOptions
```

- `setTaskStatus` 先走 t06 的 `setRecordStatus`；提交成功（含 `nothing_to_commit`）之后，新状态是 `done` 或 `shelved` 就释放这个 Task 的全部租约（不论哪个会话），否则续期调用者的租约；`caller` 为 null（面板以开发者身份写入）时只释放、不续期。命令行和以后的面板都调它，`docs/cli.md` 写明“释放与由谁调用无关”。
- `createWork`、`createTask`：落位之后（包括提交失败、但文件已写、号已领的情况）给调用者取得新 Task 的租约。
- `work status` 仍走 `setRecordStatus`，不动租约。
- **标签**（只在调用者在 herdr 里、不是 `--as` 时）：取得或续期后写调用者 pane 的标签；释放时按调用者自己的租约推断——调用者最近活动的那份有效租约正是这个 Task 时，把标签改写成它的下一份有效租约，没有就清空；别的会话 pane 上的标签不动。
- 租约读写失败不影响记录操作的结果，只给 `lease_write_failed` 警告。

### 命令合同（`src/cli/main.ts`，`docs/cli.md`）

| 命令 | 做什么 | `schema` |
|---|---|---|
| `nbdev lease take <workRef> <taskRef> [--as <标签>]` | 取得或续期调用者在这个 Task 上的租约；Task 已 `done` 或 `shelved` 报 `task_closed`（3） | `nbdev.lease-take/v1` |
| `nbdev lease list [--work <workRef> [--task <taskRef>]] [--all]` | 列出租约与现算的状态，`--all` 连 `released`、`task_closed` 一起列 | `nbdev.lease-list/v1` |
| `nbdev release [<workRef> <taskRef>] [--as <标签>]` | 释放调用者在这个 Task 上的租约；不带参数释放调用者的全部租约（子代理与父会话同一个身份，子代理执行不带参数的 `release` 会释放父会话的全部租约） | `nbdev.release/v1` |

- `work new`、`task new`、`task status` 都加 `--as`；写命令的 `data` 增加 `lease` 与 `released`。
- `CliIo` 加 `env`，`cli.ts` 传入 `process.env`；身份解析与 herdr socket 都从 `io.env` 取。
- 新错误码：`caller_unknown`（2）、`task_closed`（3）。新警告：`caller_unknown`、`claude_env_untrusted`、`herdr_unavailable`、`herdr_tag_failed`、`unreadable_lease`、`lease_write_failed`。

### `status` 的输出

- 新增只读字段 `data.caller`（`resolveCaller` 的结果，含 `via`、herdr pane 与 `managed`），人读输出加一行“你是 …”。S6 用它在真实运行时核对子代理的身份。
- `sessions[]`：`{key, agent, sessionId, label, parentSessionId, alive, managed, herdr, leases[], runs[]}`，只列有有效租约或有运行的会话；`alive` 是会话进程是否还在。
- 每个 Work 加 `activeLeases`（谁在动），每个 Task 加 `leases`，只算 `valid` 的；`unownedRuns[]`（带 `paneId` 或 `unit`）、`ignoredProcesses`、`herdr: {available, socketPath, version}`。
- herdr 只用只读白名单，总时限 2.5 秒；直接用 `pane.list` 带的 `agent`、`agent_session`、`agent_status`，不再调 `agent.list`；各 pane 的 `process_info` 并发调用，单个 `pane_not_found` 跳过。
- 人读输出加“谁在动”一节，超过 2 小时写“（淡化）”；会话下缩进列它的运行，无主的单列。

### 登记表的 `by` 字段

读取时保留原值（`null` 或 `{key, agent, sessionId, label, parentSessionId}`），不再一律写成 `null`；`claimWork`、`claimTask` 写调用者的 `SessionRef`。

### 测试夹具

- 导入时按前缀删环境变量（`HERDR_*`、`CLAUDE*`、`OMPCODE`），再把 `HERDR_SOCKET_PATH` 设到临时根里一个不存在的路径。
- `fixture.cli(args, cwd, env)` 可以按用例加环境变量。
- `tests/fake-herdr.ts`：`node:net` 起 Unix socket，按 JSON 行回应，记下收到的请求；socket 路径超过 107 字节时改放 `/tmp` 下的短路径。
- 运行的测试起真实子进程（`sleep`，环境与 cwd 按用例设定），按 pid 结束；合成进程表覆盖 codex 守护进程、`claude bg-pty-host`、后台会话进程、claude daemon 与 spare、omp broker、MCP 进程、systemd 单元、指向不存在 pane 的 `HERDR_PANE_ID`。
- L4：在命名会话 `nbdev-test` 里先试 `pane.report_agent_session` 把一格 bash pane 扮成 Claude 会话，不行就改用 `pane.report_agent`；herdr server 子进程用清洗过的环境，停止与删除放在 `finally` 里。

### 给 t08 的备注

Proposal 第三节让发布记录带 `askedBy`（提问者租约与会话快照）并入库，这与 CONTEXT 不变量 1“项目数据里没有任何字段指向会话”冲突，omp 的会话 id 还是 `~/.omp` 下的绝对路径。t08 应只在 `.local/agent/run/` 里记 `askedBy`（或只入库 leaseId）；本片导出 `getLease`、`evaluateLease` 供 t11 找通知对象。

## Spec 与文档改动

不改产品 Spec。

| 文件 | 改什么 |
|---|---|
| `packages/dev-panel/docs/cli.md` | 三个新命令；`--as`（标签要唯一，herdr 里用 `--as` 不写 pane 标签）；不带参数的 `release` 会释放父会话的全部租约；`setTaskStatus` 的释放与由谁调用无关；写命令的 `lease`、`released`；`status` 的 `caller`、`sessions` 等新字段；新错误码与警告 |
| `packages/dev-panel/docs/file-formats.md` | 租约格式与有效性（现算，按会话进程判失效）；`run/leases/`；`run/procs/` 的位置；登记表 `by`；USER_HZ 的假设 |
| `packages/dev-panel/docs/herdr.md`（新） | socket 的位置与解析顺序、协议、两份白名单、用到的方法与错误码、时限、降级；各项能力按 server 版本判断（默认 server 0.9.1），合入后由主 Agent 在真实会话上核对 |
| `packages/dev-panel/CONTEXT.md` | 不变量 5 改为“项目数据与登记表的写入经同一个写事务”，并写明租约的写法；补“外部会话”“未知调用者”“无主的运行”“会话以会话 id 认人，pane 只是线索，会话是否还在看它的进程” |
| `packages/dev-panel/AGENTS.md` | 测试不碰默认 herdr；L4 用命名会话 `nbdev-test`，没有 herdr 时跳过 |
| `.local/README.md` | Agent 区加 `run/leases/` 与 `run/procs/`（t14 起写） |

## 切片

每片在集成分支上单独提交，只按路径暂存，提交前 `git diff --cached --check`；每片自跑包的 `test` 与 `typecheck`。

| 切片 | 内容 | 提交 |
|---|---|---|
| S1 | `src/herdr/client.ts`、`procfs.ts`、`identity.ts`、`tests/fake-herdr.ts`；夹具按前缀清环境变量；`CliIo.env`；`tsconfig.core.json` 加 `src/herdr`；L1 身份判定表、L3 客户端 | `feat(dev-panel): herdr 客户端、读 /proc 与调用者身份（w00022 t07）` |
| S2 | `leases.ts`、登记表 `by`；L1 有效性计算，L2 文件读写、换进程续期、Task 关闭后复活 | `feat(dev-panel): 租约（w00022 t07）` |
| S3 | `runs.ts`；L1 合成进程表的归属，L2 真实子进程 | `feat(dev-panel): 运行的发现与归属（w00022 t07）` |
| S4 | `setTaskStatus`、新建时取租约、标签；三个命令；`status` 新字段与人读输出；L3 场景测试 | `feat(dev-panel): 租约命令与谁在动（w00022 t07）` |
| S5 | L4 命名会话测试；包文档、CONTEXT、AGENTS、`.local/README.md` | 测试与文档各一个提交 |
| S6 | 真实仓库只读 `status --json`，结果交主 Agent 写进 Task README | 不提交 |

## 验收映射

| 场景 | 覆盖 |
|---|---|
| 1 herdr 里的 Claude 会话 `task new`：租约记下会话 id 与 pane；pane 显示 `work`、`task` 标签 | L3 假 herdr：租约的 `session.herdr`、收到的 `report_metadata` 参数；L4 命名会话里一格扮成 Claude 的 pane，`pane get` 读回 tokens；S6 用 `data.caller` 核对真实会话的身份。默认 server 上的标签保持“未验证” |
| 2 子代理、会话派出的 `omp -p` 里运行：都记在父会话名下 | L1 身份判定表；L3 两种环境下各跑一次，只出现一份租约；S6 用 `data.caller` 核对子代理（编码子代理本身就是子代理）；`omp -p` 那一半记为“从 omp 源码推断，未实测” |
| 3 `lease take --as review-bot`：外部会话的租约 | L3 |
| 4 `lastActivityAt` 改成 25 小时前失效、3 小时前仍有效且 `stale` | L1 注入时钟；L3 改文件后跑 `lease list` 与 `status` |
| 5 `task status … done`：这个 Task 的全部租约被释放 | L3 两个会话各取一份，第三个会话改成 `done`；L2 释放之后另一个会话再续期，读取时仍是 `task_closed`（不复活） |
| 6 会话消失：租约失效 | 改为按会话进程判断：L2 起一个真实进程当 `CLAUDE_PID`，取得租约后结束它，判 `session_gone`；L3 假 herdr 里删掉会话只变 `managed: false` |
| 7 会话 idle 而派出的长进程还在：会话下另列运行；普通 shell pane 里的开发服务归无主 | L1 合成进程表（含审查列出的反例）；L3 真实 `sleep` 子进程加假 herdr |
| 8 herdr 不在：命令照常完成，一条警告，租约只按进程与 24 小时 | L3 |

另有：L2 同一个会话 id 换一个进程续期后为 `valid`；L1 `superseded`；L3 `status` 用只读白名单、没有发出写方法；L3 `status` 不写任何文件；L3 `lease take` 遇到 `done` 的 Task 报 `task_closed`。

## 验证

- `bun run --cwd packages/dev-panel test`（L4 只有本机有 herdr 时跑，否则跳过并记“未验证”）、`typecheck`。
- `bun x vitest run --config scripts/vitest.config.ts scripts/ci/dev-panel-records.test.ts scripts/ci/workspace-workflows.test.ts scripts/ci/agent-governance.test.ts`。
- `bun run governance:check`、`bun run docs:check`、`git diff --check`。
- S6：在本会话里只读运行 `status --json`。核对：`data.caller` 是 `claude:<本会话 id>`、pane `w1:p16`；codex 守护进程与 `claude bg-pty-host` 不出现；w00005 的长任务若还在跑，归到 `568d0811`；`w1:pJ` 的开发服务归无主。不取租约、不写标签。
- **未验证的边界**：
  - 默认 server 0.9.1 上的标签写入与显示；
  - `omp -p` 的身份继承（从 omp 源码推断）；
  - 嵌套的 `claude -p` 与 Claude 后台会话（`--bg`、`--fork-session`）的身份与归属（从 Claude 的行为与 herdr 钩子推断）；
  - `/clear` 之后会话 id 是否更换（推断会换，`superseded` 按此设计）；
  - 主会话 Bash 里有没有 `CLAUDE_CODE_CHILD_SESSION`（设计不依赖它）；
  - USER_HZ 为 100 的假设。

## 不做与风险

- **不做**：通知与 `agent.prompt`（t11）；面板（t09）；`dev start` 与 `run/procs/` 的写入（t14）；`answers`、`ask`（t08）；会话列表页；读会话 jsonl。
- **风险**：
  - **测试误碰默认 herdr**：夹具按前缀清环境变量并把 socket 指到不存在的路径；核心函数只用调用方传入的 `caller` 与 `herdr`；L4 只用命名会话的 socket，herdr server 子进程用清洗过的环境。
  - **上线后写默认会话的标签**：Proposal 已定的行为；默认 server 不支持时，可能连错误都收不到（`docs/herdr.md` 写明）。
  - **父进程链会断**：被收养（ppid 为 1）的进程只能靠工具标记认；没有标记的归无主或忽略。
  - **Bash 工具的短命令也会被列成运行**：输出带启动时间，由人或面板判断。
  - **`/proc` 扫描量**：审查实测扫 491 个进程，Bun 6 到 7 毫秒；`status` 总耗时仍以 1 秒为目标。

## 需要主 Agent 或开发者决定的点

2026-10-12 主 Agent 的处理：设计审查 22 条全部采纳，涉及开发者规则的几条已记入待确认清单。

| 点 | 结论 | 性质 |
|---|---|---|
| 1. 运行的归属只认工具标记（`CLAUDE_PID`、`OMPCODE=1`），其余退回父进程链；不在任何 pane 下又没有标记的不算运行，systemd 服务单元里的列为无主 | 采用 | 对 Proposal 的细化 |
| 2. 会话是否还在一律看会话进程（pid 加 startTicks）；herdr 列表里找不到只是 `managed: false` | 采用，已记入待确认清单（改变决定 14 的字面含义） | 开发者追认 |
| 3. 未知调用者不自动取得租约 | 采用 | 行为默认值 |
| 4. 身份只在命令行边界解析；改状态时的释放放在核心库 `setTaskStatus`，面板也调它 | 采用 | 接口形状 |
| 5. herdr 客户端直连 socket，白名单由调用方传入，分命令行与面板两份 | 采用 | 实现方式 |
| 6. 运行不写 `run/procs/` | 采用 | 范围 |
| 7. 标签按调用者自己的租约推断：最近活动的有效租约是这个 Task 时改写成下一份，没有就清空 | 采用 | 行为默认值 |
| 8. 嵌套的 `claude -p` 归外层会话，另记 `parentSessionId` | 采用，已记入待确认清单 | 对 Proposal 的细化 |
| 9. L4 在本机 herdr 里建并删除命名会话 `nbdev-test` | 本地可逆，开工时告知 | 本地操作 |

## 与 Proposal、实施计划的不一致

1. **运行的归属**：Proposal 第四节写“沿父进程链向上找，碰到 pane 的 shell 或前台进程就归到那个 pane 上的会话”。本机实测这一条会把 `568d0811` 派出的长任务认成无主（它的进程不在 pane 的进程树里）。计划改为环境变量优先（决定点 1）。这与 Proposal 第四节身份表里“会话派出的进程按继承来的 `CLAUDE_CODE_SESSION_ID` 或 `HERDR_PANE_ID` 认”是同一个原则。
2. **`CLAUDE_CODE_CHILD_SESSION`**：Proposal 与补充分析说“子代理靠 `CLAUDE_CODE_CHILD_SESSION` 认出”。这一点没能核实，而且很可能不成立（另一个会话的 Bash 子 shell 里也有这个变量）。计划不依赖它：子代理与父会话同一个 id，结果相同。
3. **omp 的会话 id**：Proposal 写“omp 的会话 id 取法未核实”。已核实 herdr 外没有可用的 id，herdr 里经 `agent.get` 拿会话文件路径。与待决问题 10 的结论一致，只是从“未核实”变成“已核实没有”。
4. **验收场景 2 的命令**：实施计划用 `nbdev answers` 举例，那是 t08 的命令；本片用 `task status` 与 `lease take` 验证同一件事。
5. **场景 1 的真实观察**：实施计划要求在 herdr 里的 Claude 会话中检查 `herdr pane get` 显示标签。默认会话禁止写标签，本片只在命名会话 `nbdev-test` 里用扮成 Claude 的 pane 验证；默认会话上的观察留给开发者或主 Agent，在合入后做。
6. **调研的 `report_metadata` 实测**：调研是在 `nbdev-probe` 里做的，那里的 server 是 0.9.3 客户端拉起的；默认 server 是 0.9.1，标签能否写入没有实测（见“未验证的边界”）。

7. **会话是否还在**：决定 14 写“会话在 herdr 里消失即失效”。herdr 的钩子会被同一格 pane 里嵌套的 `claude -p` 与后台副本改写，按 herdr 判会让活着的会话来回失效；`claude --resume` 又会换进程。计划改为“会话进程不在即失效”，herdr 只决定能不能通知（决定点 2）。

## 设计审查的处理

审查报告见 [`evidences/design-review.txt`](evidences/design-review.txt)（opus 子代理，2 阻断、5 重要、15 建议），主 Agent 核实后 22 条全部采纳。

| 审查条目 | 处理 | 改在哪里 |
|---|---|---|
| 1 续期不刷新会话快照（阻断） | 每次续期用本次的调用者重写整个 `session`；进程变了或旧状态无效就按重新取得处理；补换进程续期的 L2 | 租约第一条；验收映射 |
| 2 按 `HERDR_PANE_ID` 归属把守护进程算成运行（阻断） | 只认工具标记；只有 `HERDR_PANE_ID` 的退回父进程链；指向不存在 pane 视为没有线索；先碰到 Agent 进程的算内部进程排除；反例进 L1 | 运行第 4 步 |
| 3 herdr 记录会被改写，嵌套 `claude -p` | 会话是否还在一律看进程；herdr 只决定 `managed`；omp 记主进程；嵌套的归外层并记 `parentSessionId`；嵌套与后台会话写进未验证边界 | 身份第 2、3 条；租约有效性；验证 |
| 4 租约写入的竞争 | 有效性现算，Task 已关闭即 `task_closed`；临时文件名带 pid 与随机数；只认 24 位 hex 文件名；改 CONTEXT 不变量 5；`lease take` 遇关闭的 Task 报 `task_closed` | 租约；命令合同；文档改动 |
| 5 S6 核对不了身份 | `status` 加 `data.caller` 与“你是 …”；`omp -p` 记为推断；场景 1 标签保持未验证 | `status` 的输出；验收映射 |
| 6 自动释放要放进核心 | `setTaskStatus(context, input, {caller, herdr})`，命令行与面板都调 | 核心入口 |
| 7 白名单分两份 | `createHerdrClient({socketPath, allow})`；命令行一份、面板留 t11；`status` 用只读清单并在 L3 断言 | herdr 客户端 |
| 8 清标签的数据来源 | 按调用者自己的租约推断 | 核心入口 |
| 9 进程规则的范围 | 对所有 Claude 会话生效 | 租约有效性第 4 条 |
| 10 `/clear` 与后台副本 | 同一进程出现更新的会话 id 时旧租约 `superseded`；`sessions[]` 加 `alive` | 租约有效性第 5 条；`status` |
| 11 systemd 单元与 VS Code 终端 | 服务单元里的列为无主带单元名；看不见的写进文档 | 运行第 4 步 |
| 12 多个 herdr server | 租约记 `socketPath`，同一个 socket 才算 `managed` | 租约 |
| 13 herdr 总时限 | 总时限 2.5 秒、并发 `process_info`、跳过 `pane_not_found`、按行读核对 id、用 `pane.list` 省掉 `agent.list` | herdr 客户端；`status` |
| 14 测试夹具 | 按前缀清变量；`CliIo.env`；L4 先试 `report_agent_session` 再退 `report_agent`；server 子进程清洗环境、清理放 finally；socket 路径不超过 107 字节 | 测试夹具 |
| 15 `releaseLeases` 的签名 | 改为 `LeaseSelector`；文档提醒子代理不带参数的 `release` | 租约；命令合同 |
| 16 两处未定边界 | 提交失败但已领号也取得租约；`lease take` 遇关闭的 Task 报错 | 核心入口；命令合同 |
| 17 登记表 `by` | 读取时保留原值 | 登记表 |
| 18 运行的启动时间 | `btime + startTicks / 100`，文档写明 USER_HZ 假设 | `procfs.ts` |
| 19 环境里的会话 id 可能过期 | 只在 `CLAUDE_PID` 在、活着、id 为 UUID 时才信，否则警告 | 身份第 2 条 |
| 20 `--as` 的边界 | 文档写明标签唯一；herdr 里用 `--as` 不写标签 | 身份第 1 条 |
| 21 给 t08 的提醒 | `askedBy` 不入库；导出 `getLease`、`evaluateLease` | 给 t08 的备注；租约接口 |
| 22 默认 server 的标签能力 | 新增 `docs/herdr.md`，按 server 版本判断，合入后由主 Agent 核对 | 文档改动 |

## 实施中的偏差

集成分支提交 `349c64d3d`（S1）、`6f745f580`（S2）、`ec9f74dca`（S3）、`4d43fd526`（S4）、`75a3eb5a4`（L4 发现的修正）、`5fa513e36`（L4）、`fe177c901`（文档）、`3e086d8e1`（`status` 提速），未 push。

| 偏差 | 原因与处理 |
|---|---|
| 改成 `done` 时，pane 标签按关闭之前的租约判断指向 | L4 发现：状态先提交成 `done`，现算时这份租约已是 `task_closed`，标签不会被改写。`releaseAndRetag` 加 `closing` 参数，补 L3 用例，变异检查确认用例能抓住 |
| L4 用 `pane report-agent … --source herdr:claude --agent-session-id <id>` 扮 Claude 会话 | 按测试夹具一节的退路：单独的 `report-agent-session` 不会让 pane 出现在 `agent.list` 里（0.9.3 命名会话实测） |
| 清标签用 `tokens` 值为 `null` | 0.9.3 命名会话里实测可清；默认 server 0.9.1 仍未实测 |
| 运行列表的 `command` 是运行树的根进程 | Bash 工具派出的命令根是 `zsh -c …` 包装，显示的是包装命令行，不是里面的程序 |
| `status` 耗时约 960 到 980 毫秒，余量很小 | herdr 0.9.1 上 Bun 客户端的单次调用有一部分要多等约 100 毫秒，原因未查明，连接建立前就写请求也没改善。`3e086d8e1` 让只读命令一次调用只取一次 `pane.list`、`ping` 与 `pane.list` 并发，从约 1070 毫秒降到约 970 毫秒；其余主要花在过渡期状态（约 355 毫秒）。再快要合并 `process_info` 调用或复用过渡期状态，留给后续 |
| 嵌套的 `claude -p` 的 `parentSessionId` 记外层会话 id | 与关键设计的身份第 2 条一致，写在这里是因为审查第 3 条的措辞可以理解成记内层 id |
