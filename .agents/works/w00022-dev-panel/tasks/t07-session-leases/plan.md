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

### `src/herdr/client.ts`：herdr 只读客户端（新目录，Proposal 第一节的 `src/herdr/`）

```ts
export type HerdrAgentSession = {agent: string; kind: "id" | "path" | string; value: string};
export type HerdrAgent = {paneId: string; terminalId: string; agent: string | null; status: "idle" | "working" | "blocked" | "done" | "unknown";
    session: HerdrAgentSession | null; cwd: string | null};
export type HerdrProcessInfo = {paneId: string; shellPid: number | null; foregroundPids: number[]};
export type HerdrAvailability = {ok: true; version: string; socketPath: string} | {ok: false; reason: "server_not_running" | "connect_failed" | "timeout" | "protocol_error"; socketPath: string; detail: string};
export type HerdrClient = {
    availability(): Promise<HerdrAvailability>;                 // ping，结果缓存在这个客户端对象里
    listAgents(): Promise<HerdrAgent[]>;                         // agent.list
    getAgent(target: string): Promise<HerdrAgent | null>;      // agent.get；agent_not_found → null
    listPaneIds(): Promise<string[]>;                            // pane.list
    processInfo(paneId: string): Promise<HerdrProcessInfo | null>;  // pane.process_info
    reportTaskTokens(paneId: string, tokens: {work: string; task: string}): Promise<void>;  // pane.report_metadata
    clearTaskTokens(paneId: string): Promise<void>;              // pane.report_metadata 的 clear
};
export function resolveHerdrSocket(env: NodeJS.ProcessEnv): string;   // HERDR_SOCKET_PATH > HERDR_SESSION > ~/.config/herdr/herdr.sock
export function createHerdrClient(options: {socketPath: string; timeoutMs?: number}): HerdrClient;
export const HERDR_ALLOWED_METHODS: readonly string[];   // ping、agent.list、agent.get、pane.list、pane.process_info、pane.report_metadata
```

- 直接连 socket（`node:net`），一行一个 JSON，每次调用一个连接，超时 2 秒。不经 CLI 子进程：少一层解析，L3 用一个假 socket 就能测。
- 白名单外的方法在本模块直接抛 `herdr_method_not_allowed`（内部错误），不发出去；t11 再扩到 Proposal 第八节的完整白名单。
- 失败分类只看错误码与系统错误码：socket 不存在或 `ECONNREFUSED` 归 `server_not_running`，超时归 `timeout`，响应不是合法 JSON 或缺 `result` 归 `protocol_error`；herdr 返回的 `error.code`（如 `agent_not_found`）原样带出。
- 写标签用 `source: "nbdev"`、`tokens: {work: "w00022", task: "t07"}`、`ttl_ms: 86400000`；清除时只清 `work` 与 `task` 两个 token（`tokens` 的值为 `null`）。标签只用于显示，失败只给 `herdr_tag_failed` 警告。

### `src/core/identity.ts`：认出调用者

```ts
export type SessionRef = {key: string; agent: string; sessionId: string | null; label: string | null};
export type CallerHerdr = {paneId: string; terminalId: string; status: HerdrAgent["status"]};
export type Caller =
    | {kind: "session"; ref: SessionRef; via: "as" | "claude-env" | "herdr-pane"; herdr: CallerHerdr | null; process: {pid: number; startTicks: string} | null}
    | {kind: "unknown"; reason: "no_identity" | "herdr_unavailable" | "pane_without_agent"; herdrPaneId: string | null};
export function resolveCaller(input: {env: NodeJS.ProcessEnv; as?: string; herdr: HerdrClient | null}): Promise<{caller: Caller; warnings: Warning[]}>;
```

判定顺序：

1. `--as <标签>`：外部会话，`key = external:<标签>`，标签取 `^[A-Za-z0-9._-]{1,64}$`，不合法报 `usage`。显式标签优先于环境变量（待决问题 10）。
2. `CLAUDE_CODE_SESSION_ID`：Claude 会话，`key = claude:<id>`。子代理与它派出的进程（包括 `omp -p`）都继承这个 id，所以都记在父会话名下。不看 `CLAUDE_CODE_CHILD_SESSION`（见“环境核实”）。另有 `HERDR_PANE_ID` 且 herdr 可用时，在 `agent.list` 里按 `agent_session.value` 找这个会话，记下 pane、terminal 与状态；找不到时 `herdr: null`，即不受 herdr 管理。
3. 只有 `HERDR_PANE_ID`（omp 与其它 Agent）：调 `agent.get <pane>`，用它的 `agent_session` 认人，`key = <agent>:<value>`；pane 上没有认得出的 Agent 时为 `unknown/pane_without_agent`（开发者在普通 shell pane 里手动运行）；herdr 不可用时为 `unknown/herdr_unavailable`，并给 `herdr_unavailable` 警告。pane id 只当线索：取的是这格 pane 现在的会话。
4. 都没有：`unknown/no_identity`。

- 未知调用者不自动取得租约，写命令照常完成，并给 `caller_unknown` 警告提示加 `--as`。`lease take` 与 `release` 遇到未知调用者报 `caller_unknown`（2）。
- `process`：Claude 会话记 `CLAUDE_PID` 与它在 `/proc/<pid>/stat` 第 22 项的启动时刻（原值，防 pid 复用），供决定点 2 的失效规则使用。

### `src/core/leases.ts`：租约

文件 `.local/agent/run/leases/<leaseId>.json`，`nbdev.lease/v1`：

```json
{
    "schema": "nbdev.lease/v1",
    "leaseId": "3f2a…（sha256(sessionKey + 换行 + workId + / + taskId) 的前 24 位）",
    "workId": "w00022-dev-panel",
    "taskId": "t07-session-leases",
    "session": {
        "key": "claude:d02974de-3474-4f89-a563-45b5c8d8b06d",
        "agent": "claude",
        "sessionId": "d02974de-3474-4f89-a563-45b5c8d8b06d",
        "label": null,
        "herdr": {"paneId": "w1:p16", "terminalId": "term_65d9e5295b4cd26"},
        "process": {"pid": 1506927, "startTicks": "123456"}
    },
    "acquiredAt": "2026-10-12T19:00:00.000Z",
    "lastActivityAt": "2026-10-12T19:05:00.000Z",
    "lastAction": "task status",
    "releasedAt": null,
    "releaseReason": null
}
```

```ts
export type LeaseState = "valid" | "expired" | "session_gone" | "released";
export type EvaluatedLease = LeaseRecord & {state: LeaseState; stale: boolean; herdrChecked: boolean};
export function leaseId(sessionKey: string, workId: string, taskId: string): string;
export function touchLease(mainRoot: string, input: {caller: SessionCaller; workId: string; taskId: string; action: string; now: Date}): Promise<LeaseRecord>;
export function releaseLeases(mainRoot: string, filter: {workId: string; taskId?: string; sessionKey?: string}, reason: ReleaseReason, now: Date): Promise<LeaseRecord[]>;
export function readLeases(mainRoot: string): Promise<{leases: LeaseRecord[]; warnings: Warning[]}>;
export function evaluateLeases(leases: readonly LeaseRecord[], context: {now: Date; herdrAgents: HerdrAgent[] | null; processAlive: (process) => boolean}): EvaluatedLease[];
export const LEASE_EXPIRY_MS = 24 * 3_600_000;
export const LEASE_STALE_MS = 2 * 3_600_000;
```

- 一个会话在一个 Task 上只有一份租约：`leaseId` 由会话与 Task 决定。取得与续期是同一个动作：文件不存在就建；存在就更新 `lastActivityAt` 与 `lastAction`；已释放的重新取得时清掉 `releasedAt`，并把 `acquiredAt` 改成当下。
- 写法：同目录临时文件加改名，原子替换。租约不进写事务的锁：每份租约只属于一个会话，只有同一会话对同一 Task 并发操作时才会互相覆盖，最坏结果是丢一次 `lastActivityAt` 更新。
- 失效现算，按顺序：
  1. 已释放，为 `released`；
  2. `now - lastActivityAt > 24 小时`，为 `expired`；
  3. 租约记了 `herdr`、本次 herdr 可用，且 `agent.list` 里找不到 `agent_session.value === sessionId`，为 `session_gone`（不看 pane，pane id 会变）；
  4. 决定点 2 采用时：记了 `process` 的 Claude 会话，进程已不在或启动时刻不同，为 `session_gone`；
  5. 其余为 `valid`。herdr 不可用时跳过第 3 条，`herdrChecked: false`，并给一条 `herdr_unavailable` 警告。
- `stale`：`now - lastActivityAt > 2 小时`，只用于淡化显示，不影响有效性。
- 失效与释放的文件不删，读取时跳过；读到 `schema` 不认识或 JSON 坏了的文件，给 `unreadable_lease` 警告并跳过，不让 `status` 失败。
- 时钟全部经参数注入（`now`），测试不改系统时间。

### `src/core/runs.ts`：运行的发现与归属

```ts
export type ProcessEntry = {pid: number; ppid: number; startTicks: string; comm: string; cmdline: string; cwd: string | null; env: Record<string, string> | null};
export type RunView = {pid: number; startedAt: string; command: string; cwd: string; checkout: string;
    owner: SessionRef | null; ownerVia: "env" | "pane" | null; paneId: string | null; descendants: Array<{pid: number; command: string}>};
export function readProcessTable(): Promise<ProcessEntry[]>;     // /proc，只读本用户的进程
export function discoverRuns(input: {processes: ProcessEntry[]; checkoutRoots: string[]; selfPid: number;
    panes: Array<{paneId: string; shellPid: number | null; foregroundPids: number[]; agent: HerdrAgent | null}>; agents: HerdrAgent[]}): {runs: RunView[]; ignored: number};
```

算法（发现部分照 Proposal，归属改为环境变量优先，见“与 Proposal 不一致”第 1 条）：

1. 读进程表：`/proc/<pid>/stat`（ppid、第 22 项启动时刻；`comm` 可能含空格与括号，按最后一个 `)` 切），`cmdline`，`cwd` 链接；`environ` 只对 cwd 落在本仓库任一 checkout 下的进程读。读不到的进程（已退出、权限）跳过。
2. 候选：cwd 在 `git worktree list` 列出的任一 checkout 下。排除：
   - Agent 进程：有 Agent 的 pane 的前台进程，加上候选环境里出现过的 `CLAUDE_PID`（例如上面那个不在 pane 里的 410323）；
   - pane 的 shell：各 pane 的 `shell_pid`；
   - 调用 `nbdev` 的进程自己和它的全部祖先，所以本次调用的那条 Bash 不会列成运行。
3. 合并：一个候选的父进程也是候选，就并进父进程那一个运行，最上面的那个是运行的根；其余列入 `descendants`，最多 5 个。
4. 归属，按顺序：
   - 根进程的环境里有 `CLAUDE_CODE_SESSION_ID`，归 `claude:<id>`（`ownerVia: "env"`）；
   - 环境里有 `HERDR_PANE_ID`，且那格 pane 现在有 Agent 会话，归那个会话（`env`）；
   - 沿父进程链向上，碰到某个 pane 的 shell 或前台进程，那格 pane 有 Agent 就归那个会话（`pane`）；
   - 碰到了 pane 但那格 pane 没有 Agent（普通 shell pane 里起的开发服务），或环境里有 `HERDR_PANE_ID` 而那格没有 Agent，归“无主”（`owner: null`，带 `paneId`）；
   - 既没有环境线索、也不在任何 pane 之下的（VS Code、codex 守护进程、被收养后丢了环境的进程），不算运行，只计入 `ignored`。
5. herdr 不可用时没有 pane 信息：只按第 4 步的前两条用环境变量归属，其余全部记为无主，并给 `herdr_unavailable` 警告。
6. 运行不持有租约，也不写任何文件；`run/procs/` 是 t14（`dev start`）的登记，本片只在 `.local/README.md` 里写明它的位置。

### 命令合同（`src/cli/main.ts` 扩充，`docs/cli.md` 补齐）

| 命令 | 做什么 | `schema` |
|---|---|---|
| `nbdev lease take <workRef> <taskRef> [--as <标签>]` | 取得或续期调用者在这个 Task 上的租约；在 herdr 里就写 pane 标签 | `nbdev.lease-take/v1` |
| `nbdev lease list [--work <workRef> [--task <taskRef>]] [--all]` | 列出租约与现算的状态（`valid`、`expired`、`session_gone`），`--all` 连已释放的一起列 | `nbdev.lease-list/v1` |
| `nbdev release [<workRef> <taskRef>] [--as <标签>]` | 释放调用者在这个 Task 上的租约；不带参数时释放调用者的全部租约；在 herdr 里就清掉 pane 标签 | `nbdev.release/v1` |

- `workRef`、`taskRef` 的解析复用 t06 的 `matchRef`：Work 在主工作区或来自分支都行，Task 在 `master` 或执行 worktree 里都行。租约是运行时数据，不写记录，所以来自分支的 Task 也能取得租约。找不到报 `work_not_found`、`task_not_found`（5）。
- 接到 t06 的命令上，都加 `--as`：
  - `work new`：提交（或判定无需提交）之后，取得新 Task 的租约，动作记 `work new`；
  - `task new`：同上，动作记 `task new`；
  - `task status`：改成 `done` 或 `shelved` 时，释放这个 Task 的全部租约（不论哪个会话），原因记 `task_done`、`task_shelved`，并清掉调用者 pane 上指向这个 Task 的标签；改成其它状态时取得或续期调用者的租约；状态没变（`changed: false`）也算一次 Task 相关操作，续期；
  - 提交失败（`committed: false` 且不是 `nothing_to_commit`）时不动租约。
- 写命令的 `data` 增加 `lease`（取得或续期后的租约，未知调用者为 `null`）与 `released`（释放了哪些）。租约读写失败不影响记录操作的结果，只给 `lease_write_failed` 警告。
- 新错误码：`caller_unknown`（2）。新警告：`caller_unknown`、`herdr_unavailable`、`herdr_tag_failed`、`unreadable_lease`、`lease_write_failed`。

### `status` 的输出（`src/core/status.ts` 扩充）

`readProjectStatus(context, filter, {herdr, now})` 新增的 `data` 字段：

- `sessions[]`：`{key, agent, sessionId, label, managed（在 herdr 里）, herdr: {paneId, terminalId, status} | null, leases: [{workId, taskId, acquiredAt, lastActivityAt, lastAction, stale}], runs: RunView[]}`。只列有有效租约或有运行的会话；herdr 里没有租约、也没有运行的会话不列（会话列表是 t09 面板的事）。
- 每个 Work 加 `activeLeases`（谁在动：`{sessionKey, agent, label, taskId, lastActivityAt, stale}`），每个 Task 加 `leases`。只算 `valid` 的，按最近活动排序。
- `unownedRuns[]`、`ignoredProcesses`（计数）、`herdr: {available, version | null}`。
- 这些都标为临时数据（`docs/cli.md` 写明）：会话结束或进程退出就消失。
- 人读输出加一节“谁在动”，例如 `claude d02974de（w1:p16，working）在动 t07，最近活动 3 分钟前`；超过 2 小时的写成“（2 小时前，淡化）”。会话下面缩进列它的运行（pid、命令前 80 字、已运行多久），无主的运行单列。
- `status` 仍然只读：herdr 只调 `ping`、`agent.list`、`pane.list`、`pane.process_info`，不写标签。

### 登记表的 `by` 字段

t06 的登记表 `by` 一律为 `null`；本片在 `claimWork`、`claimTask` 时写调用者的 `SessionRef`（未知调用者仍为 `null`），并放宽 `parseRegistry` 对 `by` 的校验（`null` 或 `{key, agent, sessionId, label}`）。格式版本不变：t06 写出的 `null` 仍然合法。

### 测试夹具

- `tests/git-fixture.ts` 在导入时去掉 `HERDR_PANE_ID`、`HERDR_SESSION`、`HERDR_TAB_ID`、`HERDR_WORKSPACE_ID`、`CLAUDE_CODE_SESSION_ID`、`CLAUDE_CODE_CHILD_SESSION`、`CLAUDE_PID`、`OMPCODE`，并把 `HERDR_SOCKET_PATH` 指向临时根里一个不存在的路径。这样即使测试从 herdr 里的 Claude 会话跑起来，被测的命令行也碰不到默认 herdr。
- `tests/fake-herdr.ts`：用 `node:net` 起一个 Unix socket，按 JSON 行回应白名单里的方法，数据由测试给定（Agent 列表、pane 的进程信息），并记下收到的每个请求，供断言 `report_metadata` 的参数。
- 运行的测试起真实子进程（`sleep`，cwd 在夹具仓库里，环境变量按用例设定），测完按 pid 结束。

## Spec 与文档改动

不改产品 Spec。

| 文件 | 改什么 |
|---|---|
| `packages/dev-panel/docs/cli.md` | 三个新命令；`--as`；写命令的 `lease`、`released`；`status` 新增的字段；新错误码与警告 |
| `packages/dev-panel/docs/file-formats.md` | 租约格式与失效规则；`run/leases/`；`run/procs/` 的位置（格式由 t14 定）；登记表 `by` |
| `packages/dev-panel/docs/herdr.md`（新） | Proposal 说的“herdr 适配”第一版：socket 的位置与解析顺序、协议、用到的方法与白名单、错误码、版本（默认 server 0.9.1、协议 22）、降级方式 |
| `packages/dev-panel/CONTEXT.md` | 补“外部会话”“未知调用者”“无主的运行”，以及“会话以会话 id 认人，pane 只是线索” |
| `packages/dev-panel/AGENTS.md` | 测试不碰默认 herdr；L4 用命名会话 `nbdev-test`，没有 herdr 时跳过 |
| `.local/README.md` | Agent 区的树加 `run/leases/`（租约，失效与释放的不删）与 `run/procs/`（经 nbdev 起的进程，t14 起写） |

## 切片

每片在集成分支上单独提交，只按路径暂存，提交前 `git diff --cached --check`；每片自跑 `bun run --cwd packages/dev-panel test` 与 `typecheck`。

| 切片 | 内容 | 提交 |
|---|---|---|
| S1 | `src/herdr/client.ts`、`tests/fake-herdr.ts`、`identity.ts`；夹具去掉会话环境变量；`tsconfig.core.json` 加 `src/herdr`；L1 身份判定表、L3 客户端对假 socket | `feat(dev-panel): herdr 只读客户端与调用者身份（w00022 t07）` |
| S2 | `leases.ts`、登记表 `by`；L1 失效计算（注入时钟）、L2 文件读写与重新取得 | `feat(dev-panel): 租约（w00022 t07）` |
| S3 | `runs.ts`；L1 合并与归属（合成的进程表）、L2 真实子进程的发现与归属 | `feat(dev-panel): 运行的发现与归属（w00022 t07）` |
| S4 | 接到 `work new`、`task new`、`task status`；`lease take`、`lease list`、`release`；`status` 的新字段与人读输出；L3 场景测试 | `feat(dev-panel): 租约命令与谁在动（w00022 t07）` |
| S5 | L4 命名 herdr 会话测试；包文档、CONTEXT、AGENTS、`.local/README.md` | 测试一个提交，文档一个提交 |
| S6 | 在默认 herdr 里只读运行 `status`（不写标签），核对会话、运行与无主运行；结果交主 Agent 写进 Task README | 不提交 |

## 验收映射

场景编号指 [实施计划 t07 一节](../t03-design/plan.md#t07-会话身份运行归属与租约) 的验收场景。

| 场景 | 覆盖 |
|---|---|
| 1 herdr 里的 Claude 会话 `task new`：租约记下会话 id 与 pane；`herdr pane get <pane>` 显示 `work`、`task` 标签 | L3 `tests/leases.test.ts`：假 herdr，断言租约的 `session.herdr` 与收到的 `report_metadata` 参数；L4 `tests/herdr-live.test.ts`：命名会话 `nbdev-test` 里一格 pane 用 `pane.report_agent_session` 扮成 Claude 会话，`task new` 之后 `herdr --session nbdev-test pane get` 读回 tokens。在默认会话上的真实观察留给开发者或主 Agent（本片禁止对默认会话写标签） |
| 2 子代理里、会话派出的 `omp -p` 里运行：租约都记在父会话名下 | L1 身份判定表（`CLAUDE_CODE_CHILD_SESSION=1`、`OMPCODE=1` 加 `CLAUDE_CODE_SESSION_ID`）；L3 两种环境下各跑一次 `task status`，只出现一份租约。实施计划写的是 `nbdev answers`，那是 t08 的命令，本片用 `task status` 与 `lease take` 代替 |
| 3 没有 herdr 环境变量时 `lease take --as review-bot`：出现外部会话的租约 | L3 |
| 4 `lastActivityAt` 改成 25 小时前：`lease list` 标为失效，`status` 不再显示；3 小时前：仍有效、`stale`，`status --json` 带出最近活动 | L1 `evaluateLeases` 注入时钟；L3 改租约文件后跑 `lease list --json` 与 `status --json` |
| 5 `task status … done`：这个 Task 的全部租约被释放 | L3：两个会话各取一份，再由第三个会话改成 `done` |
| 6 假 herdr 里删掉会话：租约失效 | L3：假 herdr 的 Agent 列表去掉这个会话后 `lease list` 为 `session_gone` |
| 7 会话 idle、派出的长进程还在：`status` 里会话显示 idle，名下另列一个运行；普通 shell pane 里起的开发服务归无主 | L1 `discoverRuns` 合成进程表；L3 真实 `sleep` 子进程加假 herdr（一格有 Agent 的 pane、一格普通 shell pane） |
| 8 herdr 不在：命令照常完成，一条警告，租约只按 24 小时失效 | L3：`HERDR_SOCKET_PATH` 指向不存在的路径、`HERDR_PANE_ID` 已设；L1 `herdrChecked: false` |

另有：L1 `/proc/<pid>/stat` 的解析（`comm` 带空格与括号）；L3 白名单外的方法在客户端就被拒绝、不发出去；L3 `status` 仍不写任何文件。

## 验证

- `bun run --cwd packages/dev-panel test`：L1 到 L3 在 CI 上跑。L4 只有本机有 `herdr` 时跑：在 `herdr --session nbdev-test` 里，用完 `session stop` 加 `session delete`。没有 herdr 时跳过，测试输出与 Task 记录写“未验证”。
- `bun run --cwd packages/dev-panel typecheck`（含 `tsconfig.core.json`，现在包括 `src/herdr`）。
- `bun x vitest run --config scripts/vitest.config.ts scripts/ci/dev-panel-records.test.ts`：核心接口变了，确认根脚本测试仍通过，并且没有碰 herdr。
- `bun run governance:check`、`bun run docs:check`、`git diff --check`。
- S6 只读 smoke：在本会话里运行 `bun packages/dev-panel/src/cli.ts status --json`。对照 `herdr agent list` 与 `/proc` 手工核对：本会话认成 `claude:<id>`，pane 为 `w1:p16`；`w1:pK` 名下的 w00005 长任务按环境变量归到 `568d0811`；`w1:pJ` 的开发服务归无主；VS Code 与 codex 不出现。这一步不写标签、不取租约，只用 `status`。
- **未验证的边界**：
  - 默认 herdr server 0.9.1 是否接受 `report_metadata` 的 `tokens` 与 `ttl_ms`：L4 的命名会话由 0.9.3 客户端拉起，版本不同；
  - 默认会话上的真实标签显示；
  - 主会话 Bash 里有没有 `CLAUDE_CODE_CHILD_SESSION`；
  - Claude Code 的会话 id 在 `/clear` 之后的行为（herdr 钩子会报新 id；已派出的子进程环境里仍是旧 id）；
  - omp 在 herdr 外的会话。

## 不做与风险

- **不做**：通知与 `agent.prompt`（t11）；面板（t09）；`dev start` 与 `run/procs/` 的写入（t14）；`answers`、`ask` 与它们的租约（t08）；会话列表页；读会话 jsonl。
- **风险**：
  - **测试误碰默认 herdr**：测试从 herdr 里的 Claude 会话跑起来时，子进程会继承 `HERDR_PANE_ID` 与默认 socket。夹具在导入时去掉这些变量并把 socket 指到不存在的路径；核心函数不自己读 `process.env`，只用调用方传入的 `caller` 与 `herdr`；L4 只用显式的命名会话 socket。
  - **上线后写默认会话的标签**：合入后，真实会话的 `task new` 会对它所在的 pane 写 `work`、`task` 标签。这是 Proposal 已定的行为；默认 server 0.9.1 不支持时只给警告。
  - **父进程链会断**：进程退出、被收养（ppid 为 1）时链会断，本机已有实例（`568d0811`）。环境变量优先可以补上大部分；环境被清空的进程会被忽略或归无主。
  - **Bash 工具的短命令也会被列成运行**：它们是 Claude 主进程的子进程，cwd 在仓库里。`status` 排除了本次调用自己的祖先链，但别的会话正在跑的一条短命令会短暂出现；输出带启动时间，由人或面板判断。
  - **`/proc` 扫描量**：本机约千个进程，只对 cwd 在仓库里的读 `environ`；目标是 `status` 整体仍在 1 秒内（t06 实测 0.33 秒）。
  - **pane id 只是线索**：omp 等只靠 `HERDR_PANE_ID` 认人的调用者，pane 上换了会话时会认成新会话。

## 需要主 Agent 或开发者决定的点

| 点 | 推荐 | 性质 |
|---|---|---|
| 1. 运行的归属改为环境变量优先、父进程链兜底；不在任何 pane 之下、也没有环境线索的进程（VS Code、codex 守护进程）不算运行 | 采用。本机已有父进程链认错的实例，见“环境核实” | 对 Proposal 的细化 |
| 2. herdr 外的 Claude 会话加一条失效规则：`CLAUDE_PID` 进程已不在（或启动时刻不同）即 `session_gone` | 采用。不在 herdr 里的会话结束后，不必等 24 小时；代价是 `claude --resume` 换了进程后旧租约失效，下一次 Task 相关操作会重新取得 | 对决定 14 的补充，开发者决定 |
| 3. 未知调用者（没有 `--as`、没有会话环境变量）不自动取得租约，写命令照常完成；`lease take`、`release` 报 `caller_unknown` | 采用。所有未知调用者共用一个身份会让租约互相覆盖 | 行为默认值 |
| 4. 身份解析只在命令行边界做，核心函数不读 `process.env`；面板（t10）以开发者身份写入，不取租约 | 采用 | 接口形状 |
| 5. herdr 客户端直接连 socket，不调 `herdr` CLI 子进程 | 采用。少一层解析，L3 能用假 socket 测；t11 的适配层同样走 socket | 实现方式 |
| 6. 运行不写 `run/procs/`（留给 t14），但 `.local/README.md` 现在就写明它的位置 | 采用 | 范围 |
| 7. `task status` 改成 `done` 或 `shelved` 时，只清调用者 pane 上指向这个 Task 的标签；别的会话 pane 上的标签不动，等 24 小时 TTL 过期 | 采用。清别的会话的标签要写它们的 pane，超出“只写自己 pane”的边界 | 行为默认值 |
| 8. L4 会在本机 herdr 里建并删除命名会话 `nbdev-test` | 本地可逆，实施计划已说明，开工时告知即可 | 本地操作 |

## 与 Proposal、实施计划的不一致

1. **运行的归属**：Proposal 第四节写“沿父进程链向上找，碰到 pane 的 shell 或前台进程就归到那个 pane 上的会话”。本机实测这一条会把 `568d0811` 派出的长任务认成无主（它的进程不在 pane 的进程树里）。计划改为环境变量优先（决定点 1）。这与 Proposal 第四节身份表里“会话派出的进程按继承来的 `CLAUDE_CODE_SESSION_ID` 或 `HERDR_PANE_ID` 认”是同一个原则。
2. **`CLAUDE_CODE_CHILD_SESSION`**：Proposal 与补充分析说“子代理靠 `CLAUDE_CODE_CHILD_SESSION` 认出”。这一点没能核实，而且很可能不成立（另一个会话的 Bash 子 shell 里也有这个变量）。计划不依赖它：子代理与父会话同一个 id，结果相同。
3. **omp 的会话 id**：Proposal 写“omp 的会话 id 取法未核实”。已核实 herdr 外没有可用的 id，herdr 里经 `agent.get` 拿会话文件路径。与待决问题 10 的结论一致，只是从“未核实”变成“已核实没有”。
4. **验收场景 2 的命令**：实施计划用 `nbdev answers` 举例，那是 t08 的命令；本片用 `task status` 与 `lease take` 验证同一件事。
5. **场景 1 的真实观察**：实施计划要求在 herdr 里的 Claude 会话中检查 `herdr pane get` 显示标签。默认会话禁止写标签，本片只在命名会话 `nbdev-test` 里用扮成 Claude 的 pane 验证；默认会话上的观察留给开发者或主 Agent，在合入后做。
6. **调研的 `report_metadata` 实测**：调研是在 `nbdev-probe` 里做的，那里的 server 是 0.9.3 客户端拉起的；默认 server 是 0.9.1，标签能否写入没有实测（见“未验证的边界”）。
