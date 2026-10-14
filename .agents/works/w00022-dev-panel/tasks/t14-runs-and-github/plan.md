# t14 实施计划：运行登记、开发服务与现场补充

草案，交主 Agent 与设计审查（编码子代理 2026-10-13 写）。

范围以下面两份为准：
- [实施计划的 t14 一节](../t03-design/plan.md#t14-运行登记开发服务与现场补充)（场景 1 到 5）；
- 本目录的 [README](README.md)。

开发者说过现在“SSH 转发加常驻服务够用了”，所以本计划按“小而实用”定范围。

设计依据：
- [Proposal](../../../../../docs/proposals/dev-panel.md)：第四节（运行时登记里的 `run/procs/`、运行的归属）、第九节（现场），待决问题 12（GitHub 第一版只读）与 14（这几件进第一版，`shot` 只做薄包装）；
- t01 的 [需求分析第七节](../t01-requirements/requirements.md#七agent-用的命令行)，以及 [补充分析](../t01-requirements/analysis-supplement.md) 的 1.6、5.2、5.3 节：进程登记的字段、`dev` 的前台监管、`shot` 的薄包装、`worktree new` 用 `/usr/bin/git`；
- 已有代码（集成分支 `72799b957`）：
  - t07 的运行归属：`src/core/runs.ts`，按工具环境变量与父进程链把进程归到会话，没有标记的列为无主；
  - `src/core/procfs.ts` 的启动时刻与存活判断；
  - 登记表的 `home` 字段：至今没人写，`docs/file-formats.md` 写“由后续的 `worktree new` 写”；
  - `.local/agent/run/procs/` 的预留：`docs/file-formats.md` 写“t14 起写”；
  - t09 的会话页、checkout 页与搜索（`src/core/search.ts`）；
- t12 设计审查 S8 推迟过来的普通 shell pane 接管；
- 全局规则“后台与长驻进程”一节：后台进程默认随会话退出；输出必须落到文件；不用 `pkill -f`、`pgrep -f`。

## Context

- **要解决的问题**：Agent 起开发服务、建 worktree、截 Lab 图时各写各的命令，经常出这几种错：
  - 开发服务的输出挂在会话管道上；
  - 记不住 PID 与端口，只好 `pkill -f`；
  - 裸执行 `git worktree add` 被 omp 接管；
  - 每个子代理各写一份截图脚本。

  面板“现场”只有会话页与一张简单的 checkout 表，看不到在跑的开发服务，也看不到 GitHub 上的 PR 与检查结果。
- **前提**：t06 到 t12 已在集成分支上，t12 推到 `72799b957`；t13 已搁置。
- **工作方式同前**：
  - 集成分支 `feat/w00022-dev-panel`，每片单独提交，编码子代理不 push；
  - 测试与演示只在临时仓库里做：**不在真实仓库上起开发服务、不建 worktree**；
  - GitHub 用假 `gh`；
  - 不碰常驻面板与主工作区的 `.local/agent/`。
- **范围**（按“小而实用”）：
  - 命令行：`dev start`、`dev stop`、`dev status`；`worktree new`；`find`；`shot`；
  - 面板：“在跑”页与入口、checkout 页补几列、GitHub 只读页。
- **不做**：
  - 普通 shell pane 的接管（见决定点 13）；
  - 面板上停服务的按钮；
  - `dev start --detach`（活过会话）；
  - GitHub 写操作；
  - `review start`；
  - “治理文件落后 master”的提示；
  - 在面板里看开发服务的日志。

## 计划前的实测（2026-10-13，只读）

| 项 | 结果 |
|---|---|
| 开发服务的入口：`master` | `packages/neuro-book` 的 `dev` 是 `bun scripts/cli/source-dev.ts`，由它起 `bun x nuxt dev --no-fork`。端口取 `NUXT_PORT`、`PORT`，缺省 3000；端口被占时，get-port-please 在 3000 到 3100 里换一个。就绪时 listhen 打印 `  ➜ Local:    http://…/`（带 ANSI 颜色），这一行出现时 Nuxt 只是开始监听，页面可能还在编译 |
| 开发服务的入口：w00017 一系（`refactor/w00017-runtime-foundation`、t82、t83 等） | `dev` 是 `bun src/server/dev/main.ts`。端口取 `NBOOK_DEV_PORT`，缺省 4217，被占时与 RPC、后端端口一组顺延；就绪行是 `[dev] page-ready <url>`（它自己的测试就按这一行认） |
| 其它入口 | `packages/nb-ui` 的 `dev` 是 `nuxt dev playground`，也打印 listhen 那一行；`lab` 是 `bun scripts/lab/dev.ts`，内部同样起 Nuxt |
| 关停 | `master` 的 `source-dev` 收到第一个 SIGINT 或 SIGTERM 时优雅关停，第二个强制；stdin 是 `inherit` |
| 现在别的会话怎么起服务 | 本机有一组 w00017 的开发服务（`bun src/server/dev/main.ts`），stdout 挂在会话的 socket 管道上，没有写进文件：正是全局规则要避免的做法；也没有任何登记，面板看不到 |
| 截图 | `master` 的 `lab:shot` 是 `node --import tsx scripts/lab/shot.ts`，w00017 一系是 `node scripts/lab-shot.ts`。两者都支持 `--url`、`--out`、`--browser-executable`，缺省输出到系统临时根。t12 的实现审查与 t12 复测都遇到过 `/tmp`（7.7 GB、带用户配额的 tmpfs）满了、Chrome 崩溃，改放 `/dev/shm` 才好 |
| worktree 的命名 | Work 规则（[创建与执行](../../../README.md#创建与执行)）：一个 Task 一个 worktree，`.worktree/<Work 编号>-<Task 编号>-<短名>`，分支 `{type}/{refs}-{slug}`，例如 `feat/w00017-t80-settings-ui`。现有 worktree 里还有旧式的名字（`t80/drafts`、`t81/nb-ui-fixes`、只有 Work 编号的） |
| `gh` | 2.97.0，以 `notnotype` 登录，scope 有 `repo`。在主工作区直连：`gh pr list --json …` 取 6 个开着的 PR（每个 7 到 8 个检查）用 1.8 秒，`gh issue list` 取 30 个用 1.6 秒；经 `prox` 是 1.9 秒，今天直连不慢。没登录时（`GH_CONFIG_DIR` 指空目录）以 4 退出，并提示 `gh auth login`。`statusCheckRollup` 每项有 `name`、`status`、`conclusion`、`workflowName`、`detailsUrl` |
| `prox` | `/usr/local/bin/prox`，是一个脚本，systemd 服务里也找得到 |

只读调用：`gh auth status`、`gh pr list`、`gh issue list`，各几次；`git show`、`git grep` 读了几个分支的 `package.json` 与 dev 入口。没有起任何开发服务，没有建 worktree。

## 设计审查的处理

设计审查（[`evidences/design-review.txt`](evidences/design-review.txt)，1 阻断、6 重要、12 建议）全部采纳，主 Agent 的处理意见见本节。**本节与下文正文冲突时以本节为准**，正文保留草案原貌。

### 服务的组成、停法与“还活着”（B1、I1、S1、S4、S6）

- **一份运行由三样组成**，不再是“setsid 起的那一个进程组”：
  - 监管进程，记 pid 与启动时刻；
  - 组长，即 `setsid` 起的那个进程，pid 等于组号；
  - 后代快照：从组长沿 `/proc/*/stat` 的 ppid 收集到的全部后代，**含另起进程组、另起会话的**（master 的 `dev` 经 owned-process 把运行时放进另一个会话），每个记 pid 与启动时刻。
- **快照**：监管进程活着时每 2 秒重收一次，新出现的并进来，写进登记的 `descendants`（上限 256 个）。后代被收养到 PID 1 之后，ppid 链就断了，所以要在还连着的时候记下。
- **还活着**：下面任一条成立就算。
  1. 监管进程 pid 在，启动时刻相同；
  2. 组长 pid 在，启动时刻相同；
  3. 组长不在但 `kill(-组号, 0)` 成功。进程组还有成员时，Linux 不会把这个号分给新进程，所以组号在就仍是我们那一组；
  4. 快照里有进程 pid 在、启动时刻相同。
- **状态**：
  - `starting`：活着、还没就绪；
  - `running`：活着、已就绪、监管进程在；
  - `orphaned`：活着但监管进程不在。原因写 `supervisor_gone`；组长已退、组里或快照里还有进程时写 `leader_exited`（审查建议的 `leftover` 并进这一类）；
  - `ended`：上面四条都不成立。原因写 `exited`、`stopped`、`supervisor_killed`、`rebooted`，登记里没有 pid 时写 `never_started`。
- **停法**：`stopRun` 一处实现，`dev stop`、监管进程收到信号、组长自己退出之后的收尾都用它。
  1. 在 `run/procs/` 的锁里先写 `stoppingAt` 与 `stoppedBy`；
  2. 重收一次快照；
  3. 组长还在：**只给组长发 SIGTERM**，`bun run` 转给开发脚本，开发脚本按自己的顺序收口。master 的 source-dev 就是这样让 owned-process 收掉另一个会话里的运行时（审查 E8）。组长已不在：给进程组与快照里还活着的进程各发 SIGTERM；
  4. 等宽限期（缺省 10 秒，`--grace <秒>` 可改，master 的入口可能要到 30 秒），期间每 500 毫秒重收一次后代；
  5. 宽限期到了，对快照里仍活着、启动时刻对得上的进程逐个 SIGKILL，再 `kill(-组号, SIGKILL)`；
  6. **核对**：快照里的进程与进程组都不在，就绪地址（有的话）也连不上，才判“已停”。否则状态是 `orphaned`，登记记 `leftoverPids`，输出列出这些 pid，退出码 1（`stop_incomplete`）。
- **只碰这些进程**：登记的组长、它的进程组、组长活着时收集到的快照（每个都核对 pid 与启动时刻）。从不按命令行文本找进程。
- **监管进程收到 SIGTERM、SIGINT、SIGHUP**（S1）：
  - Claude Code 的 TaskStop 给整棵树同时发 SIGTERM，约 1.5 秒后再整棵 SIGKILL，监管进程拿不到 10 秒；
  - 所以收到信号后，先**同步**写登记（`stoppingAt`、`stoppedBy: "signal:<名>"`）并给组长发 SIGTERM，在 100 毫秒量级内做完这两步，之后再尽力走完停法、补 `endedAt`；
  - 读者遇到“没有 `endedAt`、什么都不活着”的登记，判 `ended`：有 `stoppingAt` 时原因是 `stopped`，没有时是 `supervisor_killed`。
- **组长自己退出之后**：监管进程对进程组与快照补一次停法，即上面第 3 步以后，组长已不在的那一支。登记记 `leftovers`（被补收的进程数），再写 `endedAt`。
- **会话结束时**：
  - Claude Code 下由 TaskStop 的树信号收掉（审查 E5 实测）；
  - `pdeathsig` 只兜“监管进程单独被 SIGKILL”这一种情形；
  - omp 的 `proc://` 怎么停任务没有核实，放进合入后在场的那一步。
- **属主与 `--force`**（S4）：下面任一条成立就不要 `--force`：
  - 监管进程不在（`orphaned`）：没人在监管的服务谁停都不必确认；
  - 属主会话已不在；
  - 调用者就是属主（会话键相同）。

  认不出的调用者（普通终端里直接跑，没有 `--as`）可以起服务，`startedBy` 为 null。停 `startedBy` 为 null、监管进程还在的服务要 `--force`：认不出的和认不出的不算同一个人。
- **写登记**：监管进程与 `dev stop` 都在 `run/procs/` 的目录锁里读改写，各改各的字段。监管进程写 `endedAt` 前重读一次文件。
- **退出码**（S6）：
  - 服务自己的退出码与信号只放在 `EXITED` 行与 JSON 事件里；
  - 监管进程被 `dev stop` 停、或收到信号收尾，以 0 退出；
  - 服务自己退出（不论之前有没有就绪），以 1（`dev_exited`）退出；
  - 停法第 6 步核对不过，以 1（`stop_incomplete`）退出。

### 复用（I2、S5、S12）

- **锁内顺序**：查登记 → spawn → 读组长的启动时刻 → 写含 `pid`、`pgid`、`startTicks`、`supervisor` 的完整登记 → 放锁。spawn 与读 `/proc` 是毫秒级，锁不会变长。spawn 失败时不写登记，按“起来之前就失败”报错。
- 读者遇到没有 `pid` 的登记（别的实现或旧版本写的）：监管进程活着就算 `starting`，不活就算 `ended`（`never_started`）。
- **复用到 `starting` 或地址为空（`NOT_READY`）的运行**：后来的 `dev start` 自己按同一套就绪规则读那份日志，最多等 `--ready-timeout`。认出就打 `READY`，认不出就打 `NOT_READY <日志> run=<runId>`。两种都带 `reused: true`，退出码 0。
- **复用时**：
  - 给的 `--ready-pattern`、`--work --task` 与登记不同，给警告 `reused_with_different_options`，列出不同的项；
  - `READY` 行与 JSON 都带属主会话键，人读输出加一句“它随 <属主> 的会话结束而停；要独立的一份请换 checkout”；
  - 不加 `--new`。
- **`--port` 推迟**（S12）：决定点 4 改为“nbdev 不分配也不传端口”。要固定端口时，Agent 在外面设好环境变量再加 `--ready-pattern`。

### 就绪与日志（S2、S3）

- 切行时 `\r`、`\n` 都算行尾，没写完的末行留到下次读取再拼；去 ANSI 时 CSI 与 OSC（以 BEL 或 `ESC \` 结尾）都去掉。
- **w00017 式**：地址取自 `[dev] page-ready <url>`，就绪以随后的 `[dev] backend-ready` 为准。
- **listhen 式**：地址取自 `➜ Local:`。
- **HTTP 探测**：2xx、3xx、4xx 算就绪；5xx（nuxi 构建失败时对每个请求回 500）继续探测；超时打 `NOT_READY` 时带上最后一次的状态码。
- **runId**：`dev-<YYYYMMDDTHHMMSSZ>-<8 位十六进制>`。
- **日志名**带完整 runId，以 `O_CREAT|O_EXCL` 打开：有 Task 时是 `works/<W>/tasks/<T>/logs/<runId>.log`，没有时是 `logs/dev/<checkout key>-<runId>.log`。

### checkout 页（I3）

去掉按 HEAD 与 index mtime 的缓存。改为：
- 新接口 `/api/checkouts`，请求时现算：`git status --porcelain=v1 -uno` 的条数，加 `rev-list --left-right --count master...HEAD`，4 路并行；
- 每个 checkout 留 10 秒短缓存，页面上标“N 秒前”；
- 有浏览器连着时随“活动”这一块（5 秒）重取。

审查实测 17 个 checkout 共 1.2 秒。

### `worktree new`（I4、S9）

- **场景 4 的测法**：假 `git` 只在 argv 含 `worktree add` 时写一行记录并以 1 退出，其余参数原样 `exec /usr/bin/git "$@"`。断言两条：命令成功；假 `git` 的记录里没有 `worktree add`。仓库定位等其它 Git 调用照旧走 `PATH`，不改。
- **`home` 写绝对路径**，与现有两个读者（`checkouts.ts`、`sources.ts` 都按 `checkout.root` 的绝对路径比）一致，并写进 `docs/file-formats.md`。
- **写法**：
  1. `git worktree add` 在锁外先做（可能要几十秒，不占领号的锁）；
  2. 再用不写仓库的事务：`scan()` 补登没有条目的 Task，然后新增的 `tx.setHome(workId, taskId, 绝对路径)`；
  3. 写失败只给警告，不回滚已建的 worktree。
- **并发**：`git worktree add` 失败之后重新检查路径与分支，存在就改报 `target_exists`（3），不报 `git_failed`。
- **`--type`**：与 CONTRIBUTING 对齐，取 `feat`、`fix`、`docs`、`refactor`、`test`、`build`、`ci`、`chore`。

### `shot`、`find`（S10、S11）

- **`shot`**：不注入 `--browser-executable`（两种 `lab:shot` 缺省用 `channel: "chrome"`），只包装地址、输出目录与 `TMPDIR`。`dev_not_running` 改为退出码 5。
- **`find`**：
  - `recordMatches` 改成核心里的纯函数 `matchRecords(records, q)`，面板另外拼会话的匹配；命令行只匹配 Work、Task、产物；
  - 文档写“跟踪的与未被忽略的文件”（与 `searchCheckouts` 的实际做法一致）；
  - 命令行缺省 `--limit 20`（每个 checkout），总上限 200，截断照常标出。

### GitHub（I5、S8）

- **`gh` 的路径**：`install-service` 照 herdr 的做法，安装时写 `Environment=NBDEV_GH_BIN=<绝对路径>`，找不到时写一行注释。面板用这个绝对路径，没有时再找 `PATH`，都找不到就降级并写明原因。L3 加一条：`PATH` 里没有 `gh`、只设 `NBDEV_GH_BIN` 时能取到数据。
- **写死的两条命令**：
  - `pr list --state open --limit 100 --json number,title,headRefName,isDraft,reviewDecision,statusCheckRollup,updatedAt,url`
  - `issue list --state open --limit 100 --json number,title,labels,updatedAt,url`

  按仓库维护流程，不取 `body`、`comments`、`reviews`。条数等于上限时，页面写“只列最近更新的 N 个，可能还有更多”。
- **检查汇总**按 `__typename` 分两种，`StatusContext` 的 `state` 映射成成功、失败、进行中。
- **子进程环境**：加 `GH_PROMPT_DISABLED=1`、`GH_NO_UPDATE_NOTIFIER=1`、`NO_COLOR=1`，stdin 是 ignore；超时先 SIGTERM，再 SIGKILL。
- **定时刷新**只在有浏览器连着时进行；没人看时只在打开页面时取。
- 标题、标签名一律按纯文本渲染；链接只收 `https:`。

### “在跑”页的去重（S7）

`discoverRuns` 加一个排除集：登记的监管进程、组长与快照里的 pid。运行树里（根或任何后代）含有排除集里的进程，就整棵从“会话的运行”“无主的运行”里去掉。为此 `discoverRuns` 内部按完整后代集合判断，不只看显示用的前 5 条。

### 验收补充（I6）

- **假开发脚本** `tests/fixtures/fake-dev.ts`：一律经临时 `package.json` 的 `scripts` 由真实的 `bun run` 起，孙进程必有。用环境变量切四种形态：
  - `normal`：收到 SIGTERM 时收掉孙进程再退出；
  - `leave`：不收孙进程就退出；
  - `ignore`：忽略 SIGTERM；
  - `owned`：仿 master，脚本起一个不处理 SIGTERM 的监督器，监督器以 `detached` 另起会话起运行时，脚本收到 SIGTERM 时经监督器的 stdin 让它收掉运行时。
- **L4 新增**：
  - SIGKILL 监管进程：10 秒内快照里的进程全部退出；或者状态是 `orphaned`，并且 `dev stop` 不加 `--force` 就能停干净；
  - `leave`：组长退出之后不是 `ended`，监管进程补收孙进程；
  - `owned`：`dev stop` 之后快照里的进程全部退出，地址不再回应。另断言只给组长发 SIGTERM 时运行时也收到了；
  - `ignore`：升级到 SIGKILL 后停干净；
  - 仿 TaskStop：对监管进程的整棵树同时发 SIGTERM，1.5 秒后整棵 SIGKILL，断言之后快照里的全部进程不在、登记判 `ended`。
- **在场那一步加一条**：在 Claude Code 里用后台任务跑 `nbdev dev start`，等到 `READY` 后用 TaskStop 停掉，核对快照里的进程全部退出；omp 的 `proc://` 同样核一次。

### 决定点的改动

- 2：照推荐，停法与收尾按上面改；
- 3：加 5xx、`backend-ready`、`\r`；
- 4：nbdev 不分配也不传端口（`--port` 推迟）；
- 5：锁内起服务、写好 pid 再放锁，`NOT_READY` 的复用与参数不一致的提示；
- 7：`--type` 取 CONTRIBUTING 的八种；
- 8：`matchRecords` 纯函数，缺省 20 条；
- 9：不注入浏览器路径；
- 11：现算加 10 秒短缓存；
- 12：`NBDEV_GH_BIN`、只在有人看时刷新、条数与字段写死；
- 14：日志名带完整 runId；
- 6、10、13 照原推荐。

## 关键设计

### 一、`dev start`、`dev stop`、`dev status`

**命令**

```text
nbdev dev start [--checkout <key|路径>] [--package packages/neuro-book] [--script dev] [--work <W> --task <T>]
                [--port <n>] [--ready-pattern <正则>] [--ready-timeout 180] [--json] [--as <标签>]
nbdev dev status [--checkout <key|路径>] [--all] [--wait-ready [--timeout 180]] [--json]
nbdev dev stop (<runId> | --checkout <key|路径> [--package …] [--script …]) [--force] [--json] [--as <标签>]
```

缺省值：`--checkout` 取调用者所在的 checkout，`--package` 取 `packages/neuro-book`，`--script` 取 `dev`。

**前台监管**

- `dev start` 本身就是监管进程，一直留在前台，直到服务退出或自己收到信号。
- Agent 用自己的后台机制运行它（Claude Code 的 `run_in_background`、omp 的 `proc://`），会话结束时随会话退出，见下面“会话结束时”。
- 子进程的起法：
  - 命令：`setpriv --pdeathsig TERM -- setsid bun run <script>`，cwd 是 `<checkout>/<package>`；`setpriv`、`setsid` 与 t12 共用一份工具检查；
  - stdin 是监管进程持有的一根管道，从不写，监管进程一死就 EOF；
  - **stdout 与 stderr 直接打开成日志文件的描述符**，不经监管进程的管道：监管进程不在了，服务写日志也不会 BrokenPipe（全局规则）。
- **日志**：
  - 带 `--work --task` 时写主工作区 `.local/agent/works/<W>/tasks/<T>/logs/dev-<UTC 时间>-<runId 尾 4 位>.log`；
  - 不带时写 `.local/agent/logs/dev/<checkout key>-<UTC 时间>.log`；
  - 不自动清理（与 `.local/agent` 现行做法一致）。
- **认就绪**：监管进程按 200 毫秒读日志文件的新增部分，去掉 ANSI 转义之后逐行匹配：
  - 内置两种就绪行：w00017 一系的 `^\[dev\] page-ready (\S+)`，以及 listhen 的 `➜\s+Local:\s+(https?://\S+)`（`master`、nb-ui 与 Lab）；
  - `--ready-pattern <正则>` 覆盖内置的，第一个捕获组是地址；
  - 认出地址之后再对它发 HTTP GET，收到任何 HTTP 回应才算就绪，单次限时 2 秒、总时限同 `--ready-timeout`：listhen 那一行出现时 Nuxt 只是开始监听；
  - 就绪后 stdout 打印一行 `READY <url> run=<runId>`，`--json` 时改打一行 `{"event":"ready","runId","url","logPath","pid","reused":false}`；
  - 到 `--ready-timeout` 还认不出：打印 `NOT_READY <日志路径>`（或对应的 JSON 行），**服务照留、监管照旧**，登记里地址为空。Agent 看日志自己判断，或者用 `--ready-pattern` 重来。
- **退出**：服务自己退出时，监管进程补上登记的 `endedAt`、`exitCode`、`signal`，打印 `EXITED <退出码>`，以同一退出码退出。就绪之前就退出的，报 `dev_exited`（退出码 1），并带上日志末尾 20 行。端口被占而开发脚本不换端口的情形就落在这里。

**输出合同**：`dev start` 是长命令，不套一次性的 `--json` 外壳。

- stdout 只有这几种整行：`READY`、`NOT_READY`、`EXITED`；`--json` 时换成同样含义的 JSON 行（`event` 字段）。
- 起来之前就失败（参数、checkout 不对、脚本不存在、工具缺失），照常输出错误外壳与退出码。

**同一 checkout 复用**（场景 1）

- 复用的键是（checkout 根、package、script）。
- `dev start` 在 `run/procs/` 的目录锁里查有没有同键、还活着的登记（活着的判据见下）：
  - 有：不起新的，输出 `READY <url> run=<runId>`，`--json` 的 `reused: true`，退出码 0；
  - 那一个还没就绪：等它就绪或超时，再照上面回；
  - 没有：写一份新登记，起服务。
- 拿着锁的只有“查与写登记”这一步，不包括等就绪：两个会话同时 `dev start` 时，第二个看到第一个的登记就复用。
- 监管进程已经不在、服务还在（孤儿）时：照样复用，带警告 `supervisor_gone`，提示“没有人监管它，用完请 `dev stop`”。

**登记**（`.local/agent/run/procs/<runId>.json`，`nbdev.proc/v1`）

```json
{
  "schema": "nbdev.proc/v1", "runId": "dev-20261013T1315Z-a3f9", "kind": "dev",
  "checkout": "/…/.worktree/w00017-t83-dnd-titlebar", "package": "packages/neuro-book", "script": "dev",
  "argv": ["bun", "run", "dev"], "env": {"NBOOK_DEV_PORT": "4300"},
  "pid": 12345, "pgid": 12345, "startTicks": "…", "bootId": "…",
  "supervisor": {"pid": 12340, "startTicks": "…"},
  "startedAt": "…", "startedBy": {"key": "claude:…", "agent": "claude", "sessionId": "…", "label": null},
  "workId": "w00017-…", "taskId": "t83-…", "logPath": "…",
  "url": "http://127.0.0.1:4300/", "readyAt": "…",
  "endedAt": null, "exitCode": null, "signal": null, "endedBy": null, "stoppedBy": null
}
```

- 写法与租约相同：目录 700、文件 600，写临时文件再改名。监管进程改它（就绪、退出），`dev stop` 改它（`stoppedBy`）。读到坏文件时跳过，给警告 `unreadable_proc_record`。
- `env` 只记 nbdev 自己加的变量（`--port` 带来的），不记继承来的环境。
- **还活着**：下面三条都成立才算。不用 `pgrep -f`。
  1. 没有 `endedAt`；
  2. `bootId` 与 `/proc/sys/kernel/random/boot_id` 相同；
  3. `/proc/<pid>/stat` 的启动时刻等于 `startTicks`。
- **状态**（`dev status`）：
  - `running`：活着，监管进程也在；
  - `orphaned`：活着，但监管进程不在了；
  - `starting`：活着，还没就绪；
  - `ended`：已结束，记退出码；PID 被复用或重启过也归这一类，原因分别写 `pid_reused`、`rebooted`。
- 还显示属主会话是否还在（与租约同一个判据）。

**`dev stop`**（场景 2、3）

- 按 runId 或（checkout、package、script）找登记；找不到报 `run_not_found`（退出码 5）。
- 已结束（含 PID 被复用、重启过）：**不发任何信号**，只补 `endedAt`（还没有的话），回 `{stopped: [], skipped: [{runId, reason: "pid_reused"}]}`，退出码 0。
- 属主判断：
  - 调用者就是属主，或者属主会话已经不在：照停；
  - 属主会话还在、又不是调用者：没加 `--force` 报 `run_owned_by_other`（退出码 3），`details` 与人读的输出都写明属主（会话键、Agent、标签、是否还在）；加了 `--force` 才停，并在登记里写 `stoppedBy`。
- 怎么停：
  - 先核对 `/proc/<pgid>` 的启动时刻仍等于登记里的 `startTicks`（`setsid` 起的进程，组号就是它的 pid）；
  - 再给整个进程组发 SIGTERM（`kill(-pgid)`）；10 秒内组里还有进程，再发 SIGKILL；
  - 从不碰没有登记的进程。
- 监管进程看到服务退出后自己收尾：写 `endedAt`，打印 `EXITED`，退出。

**端口**

- nbdev 不分配端口，由开发脚本自己定：w00017 一系一组顺延，Nuxt 在 3000 到 3100 里换。实际地址以就绪行为准。
- `--port <n>` 按入口给环境变量：listhen 一类给 `PORT` 与 `NUXT_PORT`，w00017 一系给 `NBOOK_DEV_PORT`。认不出是哪一类时报用法错误，请改用 `--ready-pattern` 加自己在外面设好的环境变量。
- 端口被占又不换端口的脚本，会以 `dev_exited` 结束并带日志末尾。nbdev 不替谁停占着端口的进程。

**会话结束时**（推荐：跟随会话结束，见决定点 2）

全局规则写的是“后台进程默认随会话退出，只有开发者明确要求活过会话时才用 `systemd-run`”。所以：

- 监管进程收到 SIGTERM、SIGINT 或 SIGHUP 时，按上面的停法停掉整个进程组，补登记，然后退出。
- 监管进程被 SIGKILL 时：服务的组长靠 `pdeathsig` 收到 SIGTERM。孙进程会不会跟着退出，要看开发脚本自己收不收子进程：`source-dev` 会，w00017 的 `runDev` 会，要在 S0 里用假脚本核对 `bun run` 这一层转不转发信号。没退的，`dev status` 标 `orphaned`；属主会话已不在，所以 `dev stop` 不用 `--force` 就能停。
- `--detach`（改走 `systemd-run --user`，活过会话）放第二版。

### 二、`worktree new <workRef> <taskRef>`

```text
nbdev worktree new <workRef> <taskRef> [--slug <短名>] [--type feat] [--from master] [--json] [--as <标签>]
```

- **命名**：按 Work 规则。
  - 路径 `.worktree/<Work 编号>-<Task 编号>-<短名>`，例如 `w00022 t06` → `.worktree/w00022-t06-cli-core`；
  - 分支 `<type>/<Work 编号>-<Task 编号>-<短名>`，例如 `feat/w00022-t06-cli-core`；
  - 短名缺省取 Task 的 slug，`--slug` 可以写短一点；
  - `--type` 只收根规则里的几种（`feat`、`fix`、`refactor`、`docs`、`chore`、`test`）。
- **起点**：`--from` 缺省是本地 `master`；只收已有的分支或提交。
- **用 `/usr/bin/git`**：
  - 命令是 `/usr/bin/git worktree add -b <分支> <路径> <起点>`，用 argv 数组直接 `spawn`，不经 shell；
  - omp 是在会话的 shell 里接管 `git worktree add`，直接用绝对路径起的子进程碰不到它（全局规则“worktree”一节的判据：执行者是 `/usr/bin/git`，不是 `bun …/cli.js`）；
  - `/usr/bin/git` 不存在时报 `git_failed`，不退回 `PATH` 里的 git。
- **已被占用**（场景 4）：路径已存在（不论是不是 worktree）或分支已存在，报 `target_exists`（退出码 3），写明是哪一个，**不自动改名**、不覆盖。
- **之后**：
  - 在登记表的 Task 条目写 `home: ".worktree/…"`（主工作区相对路径），在登记表锁里写，与领号同一个事务写法；
  - 续期调用者在这个 Task 上的租约，与其它 Task 相关的命令一样。
- **不装依赖**（决定点 6）：输出最后一行提示 `cd <路径> && bun install`（网络慢时 `prox bun install`）。装依赖动辄几分钟、可能要代理，放进命令里就成了一个会卡住、要重试的长命令。
- **不改 Task README**：执行位置由会话自己写进 README 正文（Work 规则），nbdev 只在输出里给出那一句。
- `--json` 的 `data`：`{path, branch, from, home, installHint}`。

### 三、`find` 与 `shot`

**`find`**

```text
nbdev find <词> [--in <checkout key|all>] [--name] [--limit 200] [--json]
```

- 找什么：与面板的搜索相同，即记录（Work 与 Task 的编号、标题）加各 checkout 里被 Git 跟踪的文件名与内容。`--name` 只找文件名；`--in` 缺省是全部 checkout。
- 实现：复用 `src/core/search.ts` 的 `searchCheckouts`，用 `git grep`，单个 checkout 200 条、5 秒截断。面板的 `recordMatches` 从 `src/server/views.ts` 挪进核心，命令行与面板共用一份。
- 输出：按 checkout 分组；`--json` 的 `data` 是 `{records[], hits[], checkouts[{key, count, truncated, error}]}`。没有命中也是退出码 0。

**`shot`**（只做薄包装，决定点 9）

```text
nbdev shot [--checkout <key|路径>] [--work <W> --task <T>] [--url <url>] -- <交给 lab:shot 的参数…>
```

- 包装三件事：
  1. 地址：先看 `--url`，再找这个 checkout 还活着的开发服务（`dev` 或 `lab`）的登记地址；都没有就报 `dev_not_running`（退出码 3），提示先 `nbdev dev start`。
  2. 输出目录：带 `--work --task` 时是 `.local/agent/works/<W>/tasks/<T>/shots/<UTC 时间>/`，不带时是 `.local/agent/shots/<UTC 时间>/`。
  3. 运行：`bun run --cwd <checkout>/packages/neuro-book lab:shot -- --url <地址> --out <目录> [--browser-executable /usr/bin/google-chrome-stable] <其余参数>`。
- 对 Playwright 加 Chrome 的固定做法：
  - `/usr/bin/google-chrome-stable` 存在时给 `--browser-executable`，两种 `lab:shot` 都认这个参数；
  - 子进程的 `TMPDIR` 指到 `/dev/shm/nbdev-shot-<随机>`（目录 700），跑完删掉：Chrome 的临时数据不进 `/tmp`；
  - 不改 `lab:shot` 自己的截图逻辑，它用 node 跑，nbdev 不换成 Bun。
- checkout 的 `package.json` 里没有 `lab:shot` 时报 `shot_unavailable`（退出码 3）。
- 输出列出生成的文件与 `lab:shot` 的退出码；它失败时退出码 1，原样带上它的 stderr 末尾。

### 四、面板“现场”

**“在跑”**（新页 `/live/runs`，左栏“现场”下加一项“在跑 N”，首页计数里也加）

- 第一块“经 nbdev 起的”：来自 `run/procs/`。
  - 每行：checkout、package、script、状态（`starting`、`running`、`orphaned`、`ended`）、地址（链接）、属主会话（还在不在）、Task、起始时刻、日志路径（只显示路径，不提供下载）；
  - 已结束的只列最近 24 小时，折叠显示。
- 第二块“会话的运行”与第三块“无主的运行”：就是 t07 已有的归属结果。
  - 会话的运行在会话页已有，这里只汇总；
  - 无主的运行在这里给入口。
  - 经 nbdev 起的进程在第二、三块里按 pgid 去重，只出现在第一块。
- **只读，没有停止按钮**（决定点 10）：停服务用命令行 `dev stop`。面板的写入至今只有“写仓库”和“往会话里打字”两类，加一个“给进程发信号”的入口要另做审计与确认，收益不大。
- 刷新：随“活动”这一块（5 秒）一起重算，`run/procs/` 加进活动的输入。

**checkout 页补的列**

- 未提交：`git status --porcelain=v1 -uno` 的条数，只算已跟踪的文件；
- 领先、落后：相对本地 `master`；
- 在跑：这个 checkout 上经 nbdev 起的、还活着的服务，带地址；
- 是哪些 Task 的 `home`：来自登记表；
- 已有的 Work 执行 worktree 一列保留。

不做“可清理”：判据在根 scripts 的 `governance:worktree`，t09 已写明原因。这几列按 checkout 并行计算（4 路），按 HEAD 与 index 的 mtime 缓存。

**GitHub 只读**（新页 `/live/github`）

- 内容：
  - 开着的 PR：编号、标题、分支、草稿、评审结论、检查汇总（成功、失败、进行中的个数，失败的列出名字与链接）、更新时刻；
  - 开着的 Issue：编号、标题、标签、更新时刻；
  - 都链到 GitHub。分支名能解析出 Work 与 Task（`<type>/<Work>-<Task>-…`）时，另链到面板的 Task 页。
- **没有任何写按钮**：页面上除了“刷新”与链接，没有按钮、没有表单（场景 5 的判据）。
- **只调白名单里的两条命令**：`gh pr list --state open --limit 50 --json <固定字段>` 与 `gh issue list --state open --limit 50 --json <固定字段>`，参数在适配层写死，不接受任意子命令（同 herdr 的白名单做法）；cwd 是主工作区，仓库由 `gh` 从远端推断。
- **网络与缓存**：
  - 打开页面时取一次，之后每 5 分钟在后台刷新，“刷新”按钮立即取；单飞，不并发；
  - 单次时限 15 秒，超时就保留上一份，并标“N 分钟前的数据（这次超时）”；
  - 结果只在内存里，面板重启后重新取；
  - 慢的时候，环境变量 `NBDEV_GH_PREFIX=prox` 让面板改用 `prox gh …`：`prox` 是 `/usr/local/bin/prox`，作为服务运行时也找得到。缺省不加，今天实测直连 1.8 秒。
- **`gh` 不可用时的降级**，按退出码分支，不看文案：
  - 找不到 `gh`（`NBDEV_GH_BIN` 或 `PATH`）：页面写“没有 gh”，现场其它页照常；
  - 以 4 退出：没登录，写“在终端运行 `gh auth login`”；
  - 其它非零：写退出码与 stderr 末尾，保留上一份数据。
- 命令行不加 GitHub 命令：Agent 直接用 `gh`。

### 五、shell pane 的接管（t12 推迟过来的）

推荐 t14 **不做**，继续推迟（决定点 13）。理由：

- 开发者现在的用法（SSH 转发加常驻服务）里，shell pane 在 herdr 的 TUI 里本来就能直接操作；
- 想让它做的头号场景是“给开发服务按 Ctrl+C”，这件事改由 `dev stop` 按登记停，更可靠：不会按错格，也有属主核对；
- shell pane 没有会话键，页面看到的与服务端核对的只能是 terminal id，换了里面跑的程序看不出来；还会遇到 sudo、ssh 的密码提示，入口、按钮与字节表要从头设计（t12 设计审查 S8 的原话）。

以后真要做时，要补这几样：会话页之外的入口（例如“在跑”行上的“看终端”）、shell pane 的按键字节表、接管提示里加“这是 shell，按键会直接执行”。

## 切片

每片在集成分支上单独提交，只按路径暂存，提交前 `git diff --cached --check`；每片自跑包的 `test`、`typecheck`、`build:web`。

| 切片 | 内容 | 测试 |
|---|---|---|
| S0 探针（结论写进“实施进度”，不入库代码） | 在临时目录里用假开发脚本核对：`bun run` 收到 SIGTERM 时转不转发给脚本；`kill(-pgid)` 能不能收到组里全部进程；监管进程被 SIGKILL 后，`pdeathsig` 加组长的处理能不能收干净孙进程 | 无 |
| S1 进程登记与 `dev` | `src/core/procs.ts`：登记的读写、锁、活着的判据、状态；`src/core/ready.ts`：去 ANSI、内置就绪行、HTTP 探测；`dev start`、`dev status`、`dev stop`；新错误码 `run_not_found`（5）、`run_owned_by_other`（3）、`dev_exited`（1）、`dev_not_ready`（4，只给 `dev status --wait-ready`）；`tests/fixtures/fake-dev.ts` | L1：就绪行、去 ANSI、登记解析、活着的判据。L4（真实进程、假开发脚本，临时仓库）：场景 1 到 3，见“验收” |
| S2 `worktree new` | `src/core/worktree-ops.ts`：命名、`/usr/bin/git`、登记表的 `home`、续租 | L3：临时仓库里建、重复建、分支已存在、`PATH` 里放一个会失败的假 `git` 仍然成功 |
| S3 `find` 与 `shot` | `recordMatches` 挪进核心；`find`；`shot` 的地址、输出目录、`TMPDIR` 与 Chrome 路径 | L3：`find` 的分组与截断；`shot` 用临时 checkout 里记下参数的假 `lab:shot` |
| S4 面板“现场” | `/api/runs`、checkout 的新列、`/api/github`（`src/server/github.ts`：白名单、缓存、时限、按退出码降级）；页面“在跑”、checkout、GitHub；左栏与首页计数 | L3：假 `gh` 的四种情形（正常、没登录、超时、找不到）；`/api/runs` 合并去重。浏览器：临时仓库，390 与 1440 |
| S5 文档 | `docs/cli.md`：`dev`、`worktree new`、`find`、`shot`、错误码与长命令的输出合同；`docs/file-formats.md`：`run/procs/` 与 `home`；`docs/panel.md`：现场三页与 GitHub 的降级 | `governance:check`、`docs:check` |

## 接口与数据

```text
nbdev dev start | dev status | dev stop          # 见第一节
nbdev worktree new <workRef> <taskRef> …         # 见第二节
nbdev find <词> …                                # 见第三节
nbdev shot … -- <lab:shot 参数>                  # 见第三节

GET /api/runs      {procs: ProcView[], sessionRuns: RunView[], unownedRuns: RunView[]}（ProcView 是登记加现算的状态）
GET /api/sessions  checkouts[] 加 dirty、ahead、behind、runs[]、homeOf[]
GET /api/github    {state: "ok" | "stale" | "unavailable" | "not_logged_in" | "error", at, error, prs[], issues[]}
POST /api/github/refresh    只是让面板立刻重取一次；不经 gh 写任何东西（走写请求的 Origin 与 CSRF 校验）
```

- 新错误码见 S1；`worktree new` 沿用 `target_exists`（3）、`git_failed`（1）、`work_not_found`、`task_not_found`（5）。`shot` 新增 `dev_not_running`、`shot_unavailable`（3）。
- 本地文件：`run/procs/<runId>.json`（`nbdev.proc/v1`）、开发服务的日志、`shots/<UTC 时间>/`；登记表 Task 条目的 `home` 开始有值。
- 核心库：`src/index.ts` 导出登记的读取与 `worktree new` 的核心函数，供根测试与以后的脚本用；面板只读 `run/procs/`，不写。

## 验收场景与测法

不在真实仓库上起开发服务、不建 worktree；GitHub 用假 `gh`；浏览器只在临时仓库上验。

| 场景 | 测法 |
|---|---|
| 1 两个会话先后在同一 checkout 运行 `dev start`：第二个拿到 `reused: true` 与同一个地址 | **L4**（临时仓库，假开发脚本 `tests/fixtures/fake-dev.ts`：延时打印 listhen 式的就绪行，再起一个 HTTP 服务，可选再起一个孙进程）。会话 A（`startFakeClaude` 扮）在后台跑 `dev start`，等到 `READY` 行；会话 B 跑 `dev start --json`，立即返回，`reused: true`、地址与 runId 相同，退出码 0。两个会话同时起，只有一个登记、一个服务。另测 w00017 式的 `[dev] page-ready` 行、`--ready-pattern`、认不出时的 `NOT_READY` 与服务照留、就绪前就退出时的 `dev_exited` 加日志末尾 |
| 2 另一个会话运行 `dev stop` 停不了它，退出码 3；加 `--force` 才能停，并在输出里写明属主 | **L4**：A 起的服务，B 不带 `--force` 停，退出码 3、`run_owned_by_other`，`details` 与人读的输出都有 A 的会话键；带 `--force` 停，组里全部进程（含孙进程）10 秒内不在，登记里有 `stoppedBy`，A 的监管进程打印 `EXITED` 并退出。另测：A 已结束（属主不在）时 B 不用 `--force` 就能停；A 的监管进程收到 SIGTERM 时整组收干净 |
| 3 进程被外部杀掉、PID 被复用：`dev status` 标为已结束，`dev stop` 不发信号 | **L4**：SIGKILL 整组之后，`dev status` 是 `ended`（监管进程补了 `endedAt`）。PID 复用：另起一个 `sleep`，把它的 pid 连同一个旧的 `startTicks` 写进一份登记，`dev status` 是 `ended`（`pid_reused`），`dev stop` 回 `skipped`，`sleep` 仍活着。重启：`bootId` 改掉的登记同样是 `ended`（`rebooted`） |
| 4 `worktree new w00022 t06` 建出 `.worktree/w00022-t06-…` 与 `feat/w00022-t06-…`；路径已被占用时退出码 3，不自动改名 | **L3**（临时仓库的 Work 与 Task）：`worktree new w00001 t01` 建出 `.worktree/w00001-t01-seed` 与 `feat/w00001-t01-seed`，登记表的 `home` 写好，租约续期；再跑一次退出码 3（路径），删掉目录但留着分支再跑也是 3（分支）；`PATH` 前面放一个总是失败的假 `git`，命令照样成功（用的是 `/usr/bin/git`） |
| 5 面板的 GitHub 页列出开着的 PR 与检查结果，没有任何写按钮 | **L3**：假 `gh`（`NBDEV_GH_BIN`）回固定的 JSON，`/api/github` 的汇总对得上；没登录（以 4 退出）、超时（睡过时限，保留上一份并标 `stale`）、找不到 `gh` 各一条；只用了白名单里的两条命令。**浏览器**（临时仓库）：页面列出 PR、检查汇总与失败项，`button` 只有“刷新”，没有 `form`；390 宽不横向溢出 |
| 在跑与 checkout | **L3**：`/api/runs` 合并登记与 t07 的归属、按 pgid 去重；checkout 的新列。**浏览器**：“在跑”页与 checkout 页，390 与 1440 |

**开发者或主 Agent 在场的那一步**（合入之后，真实仓库）：

1. 主 Agent 在一个已有的、自己负责的实现 worktree 里第一次用 `nbdev dev start`，核对真实的 `master` 式与 w00017 式就绪行都认得出、`READY` 的地址打得开，然后 `dev stop`。
2. 下一个新 Task 用 `nbdev worktree new` 建 worktree。
3. 开发者在面板上看一眼 GitHub 页。

## 决定点

| # | 问题 | 推荐 |
|---|---|---|
| 1 | `dev start` 留在前台还是自己转后台 | 留在前台，由 Agent 的后台机制托管；不自己 fork 成守护进程 |
| 2 | 会话结束时服务怎么办 | 跟随会话结束（全局规则的缺省）：监管进程收到信号就停整组；`--detach`（`systemd-run`）放第二版 |
| 3 | 就绪怎么认 | 内置两种就绪行（`[dev] page-ready`、listhen 的 `➜ Local:`），加 `--ready-pattern`，认出之后再做 HTTP 探测；认不出就 `NOT_READY` 加日志路径，服务照留 |
| 4 | 端口 | nbdev 不分配，以就绪行里的地址为准；`--port` 按入口设对应的环境变量 |
| 5 | 复用的键 | （checkout、package、script） |
| 6 | `worktree new` 装不装依赖 | 不装，只提示命令 |
| 7 | `worktree new` 的分支类型 | 缺省 `feat`，`--type` 限根规则里的几种；`--slug` 可改短名 |
| 8 | `find` 的范围 | 与面板搜索相同（记录、文件名、内容），共用核心实现 |
| 9 | `shot` | 只包装地址、输出目录、Chrome 路径与 `TMPDIR`；没有登记的服务时报错，不替你起 |
| 10 | 面板上能不能停服务 | 不能，只读；停服务用 `dev stop` |
| 11 | checkout 页补什么 | 未提交条数、领先落后、在跑、`home`；不做“可清理” |
| 12 | GitHub 怎么取 | 面板侧白名单的两条 `gh … list`，15 秒时限、5 分钟刷新、内存缓存；按退出码降级；`NBDEV_GH_PREFIX` 可以加 `prox` |
| 13 | shell pane 接管 | t14 不做，继续推迟 |
| 14 | 日志放哪 | 有 Task 时放 Task 的 `logs/`，没有时放 `.local/agent/logs/dev/`；不自动清理 |

## 与 Proposal、实施计划的不一致

1. **`worktree new` 不装依赖**：需求分析的命令表写“装依赖”，补充分析给了 `--install`。本计划不做，只提示命令（决定点 6）。
2. **`worktree new` 带 Task**：需求分析写 `worktree new <Task>`，补充分析写 `worktree new <workId> [--task]`。本计划按 Work 规则与实施计划写 `worktree new <workRef> <taskRef>`，没有“只按 Work 建”的用法。
3. **`dev start` 的输出不是一次性外壳**：补充分析的表把 `{runId, url, ports[], logPath, reused}` 当作一次性的 `data`。本计划因为是长命令，改成按行的事件，起来之前就失败的仍走外壳。
4. **就绪超时不退出**：补充分析写“等就绪超时是 4”。前台监管时超时不退出，只打 `NOT_READY`；`4` 只给 `dev status --wait-ready`。
5. **“在跑”比 Proposal 第九节多一点**：第九节写“第一版只显示数量与入口”。本计划给一张只读的列表页，数据都已经有了，没有操作。
6. **shell pane 接管继续推迟**（t12 设计审查 S8 原本推给 t14）。

## 风险

按影响排序，前两条是我认为最大的两处。

1. **开发服务收不干净或收错**：
   - 起因：
     - 会话结束时监管进程若被 SIGKILL，孙进程是否跟着退出取决于 `bun run` 与开发脚本自己，S0 之前不知道；
     - 反过来，`dev stop` 若认错进程组，会停掉别人的东西。
   - 缓解：
     - 服务自成进程组（`setsid`），组长带 `pdeathsig`；
     - 登记记 `pid`、`pgid`、`startTicks`、`bootId`，发信号前核对；从不碰没有登记的进程，不用 `pkill -f`；
     - 收不干净的显示成 `orphaned`，属主不在时 `dev stop` 不用 `--force`。
   - L4 断言组里全部进程（含孙进程）都退出、被复用的 PID 不受信号。
2. **就绪行因分支而异，“就绪”可能是假的**：
   - 起因：两类入口的格式不同，以后的分支还会变；listhen 那一行出现时页面还在编译。
   - 缓解：内置两种加 `--ready-pattern`；认出之后做 HTTP 探测；认不出时打 `NOT_READY` 并保留服务与日志路径，不卡死、不误报。
   - 剩下的：这一轮不在真实仓库上起服务，两种就绪行只按源码与 w00017 自己的测试写成，要到合入后在真实 worktree 上核对（见“开发者或主 Agent 在场的那一步”）。
3. **GitHub 慢或不可用**：15 秒时限、保留上一份、按退出码降级；`prox` 可选。面板不会因为 GitHub 卡住，因为请求在后台单飞。
4. **checkout 页变慢**：worktree 多了以后每个都要跑 `git status` 与领先落后。并行 4 路、按 HEAD 与 index 的 mtime 缓存；只在页面打开时算。
5. **`worktree new` 写的 `home` 与 Task README 不一致**：`home` 只是提示，以 README 为准（Work 规则）；输出里给出 README 要写的那一句。

## 需要开发者批准或参与

| 事项 | 时机 | 性质 |
|---|---|---|
| 决定点 2（服务跟随会话结束）、10（面板不能停服务）、13（shell pane 接管继续推迟）、6（`worktree new` 不装依赖） | 实施前 | 范围与行为的取舍，按推荐先定，待确认 |
| 合入后第一次在真实仓库用 `dev start`（主 Agent 在自己负责的 worktree 里起再停）与 `worktree new`（下一个新 Task 用） | 合入后 | 真实仓库上起开发服务、建 worktree 与分支 |
| 面板定时读 GitHub（每 5 分钟两次只读的 `gh … list`） | 合入后 | 远端只读访问，按根规则不需单独授权，这里只是知会 |

假 `gh`、假开发脚本、临时仓库里的测试与本地提交，都属于本地可逆操作，按 P-005 不再逐项询问。

## 推迟（不在 t14）

- 普通 shell pane 的观看与接管；
- 面板上停服务、重启服务的按钮；在面板里看开发服务的日志；
- `dev start --detach`（`systemd-run`，活过会话）；
- `worktree new --install`；
- GitHub 写操作、PR 详情页、检查的日志；`review start`；
- “治理文件落后 master”的提示、worktree 的“可清理”判定与清理；
- `shot` 之外的截图做法（例如整页截图、录屏）。

## 实施进度（编码子代理随做随记）

- 2026-10-13：计划写完，交设计审查。计划前的查询都是只读：
  - `gh auth status`、`gh pr list`、`gh issue list` 各几次；
  - `git show`、`git grep` 读了几个分支的 `package.json` 与 dev 入口；
  - 读了 `node_modules` 里 listhen 与 get-port-please 的源码。

  没有起开发服务，没有建 worktree，没有残留进程。
- 2026-10-13：设计审查的处理写进上面一节。集成分支先快进到 master（`16da3544b`，带进服务脚本）。S1 `ea0e1c5fa`：`dev start`、`dev status`、`dev stop`。L4 共 10 条（`tests/dev-live.test.ts`，假开发脚本的四种形态，经真实 `bun run`），都只在临时仓库里起。
- S2 `2ead23c01`：`worktree new`（L3 `tests/worktree-new.test.ts`，场景 4 按设计审查 I4 的测法）。S3 `39fe47cc5`：`find`、`shot`（L3 `tests/find-shot.test.ts`）。S4 `f5cb03349`：面板现场三页、`install-service` 写 `NBDEV_GH_BIN`、`procs` 挪进核心（`src/core/procs.ts`，核心的活动要用它去重）；L3 `tests/panel-live.test.ts`（假 `gh`）。
- S5 文档 `58f61aa11`。浏览器验收（临时仓库，假开发脚本加假 `gh`）发现 checkout 页在 390 宽时每列被挤成一字一行，改成整张表横向滚动：`6b80522d7`。
- 修完 checkout 列之后重启宿主、用最新构建复跑浏览器验收：16 项全过，控制台没有错误与警告；390 宽的 checkout 页整张表在框里横向滚动，页面本身不溢出。截图在主工作区 `.local/agent/works/w00022-dev-panel/tasks/t14-runs-and-github/shots/`。
- 全量验证（集成分支 `9fc8cf009`，含下面两件追加修正）：包里 `bun test` 322 条全过（含 L4：herdr 命名会话、server 0.9.3 与 0.9.1 两组，`dev-live` 10 条）；`typecheck`、`build:web` 通过；根上 `dev-panel-records`、`workspace-workflows`、`agent-governance` 三个测试文件 177 条通过，`dev-panel-records` 在 Node 下 5 条通过；`governance:check`、`docs:check` 没有失败（只有仓库存量的警告）；`git diff --check` 干净。第一次全量时新加的 L4 状态序号测试失败过一次（同时在跑根上的测试，herdr 读屏合并掉了 B 的一次变化），断言放宽为“B 看到过 blocked”（`9fc8cf009`）之后单独连跑三次、全量再跑一次都过。

## 追加修正（t14 之后，各自单独提交）

- **t11 通知误报** `660faa56e`：herdr 的 `state_change_seq` 是全服务器共用的一个计数，一格变状态时取下一个值记在它身上，所以只能比相等，差值数不出这一格变了几次。`delivery.ts` 原先用“投递前后序号差大于等于 2”判断经过了确认界面，别的会话同时变状态就误报。改为：
  - 调 `agent.prompt` 之前向面板的 `HerdrMonitor` 要这一格的状态观察（`watchStatus`），投递窗口里收到的 `pane.agent_status_changed` 出现过 `blocked`，或返回体里是 `blocked`，记 `delivered_into_blocked`，`code: passed_blocked`（取代 `state_jumped`）；
  - 退路：订阅这时没订着这一格（没连上、重连中、pane 刚出现还没换连接）或窗口里订阅断过，记 `delivered` 加 `code: unwatched`，界面注明没核对确认界面；最后还停在 `blocked` 的那条照旧，不靠事件；
  - 逐处核对过：只比相等的地方（`delivery.ts` 的稳定与紧贴投递复核、notifier 的重读屏幕与稳定记录、monitor 的对账）照旧；`client.ts` 里“每次状态变化加 1”的注释改掉；
  - 文档：`docs/herdr.md` 加“状态序号”一条，“投递之后”改写；`docs/file-formats.md` 的 `result` 说明里加 `passed_blocked`、`unwatched`，注明旧记录里的 `state_jumped` 会误报；
  - 测试：假 herdr 改成全局计数（`fake.setStatus` 推高全局序号并推事件，`duringPrompt` 模拟投递窗口里的别的事）；L3 断言别的 pane 在窗口里变两次状态时记 `delivered`（且序号差确实大于等于 2），这一格经过 `blocked` 时照报 `passed_blocked`，没订阅或订阅中途断开时记 `unwatched`；L4 在 0.9.3 命名会话里用两格假 Claude（信任确认界面判 `blocked`）钉住全局计数与按格的事件（`9fc8cf009` 放宽了对 B 事件条数的断言，并打印两格的序号：A 6、B 5，B 的事件是 blocked、idle、blocked、done）。另用一个一次性命名会话实测：两格各变一次状态，序号是 1 与 2；B 变四次之后 A 再变一次，A 是 7、B 是 6。
- **t12 接管后又改一次尺寸** `6a6e44ad3`：原因是量接管尺寸时终端框里还是旧尺寸的画面，13px 下溢出、出滚动条，把内容区挤掉一行几列；接上之后画面不再溢出、滚动条消失，ResizeObserver 又量出大一点的尺寸、再 resize 一次。无头 Chrome 缺省带 `--hide-scrollbars`，滚动条不占位，所以之前的验收（F3）看不出来。改为量的时候先把框的溢出藏起来，接管中窗口变化同样处理；`TerminalView.md` 写明。复现与复测（临时仓库加命名会话，去掉 `--hide-scrollbars`；A 用 2400×1500 先接管把 pty 变成 206×54，B 用 1280×800 抢过来）：修之前小窗写 136×27、接上后变成 139×28、B 的释放行 `resizes: 1`；修之后小窗 139×28、接上后与 2 秒后都是 139×28、`resizes: 0`；接管中把窗口缩到 900 宽只 resize 一次。t12 的验收脚本 `accept-review.ts` 15 项复跑全过。截图与脚本在主工作区 `.local/agent/works/w00022-dev-panel/tasks/t12-web-terminal/shots/`。

## 实现审查的修正

t14 实现审查（`evidences/impl-review.txt`，范围 `16da3544b..6b80522d7`，1 阻断、4 重要、6 建议）全部采纳，每条一个提交（集成分支，未 push）：

- **B1** `6f16fc1bb`：GitHub 页取不到数据时不再成环。
  - `GET /api/github` 只读当前这一份，不再触发取数；页面打开时显式发 `POST /api/github/refresh`，带 `{"ifStale": true}`。
  - `GithubCache` 记上一次尝试结束的时刻，不论成败：上次取到了按 5 分钟、没取到按 60 秒判断要不要因打开页面再取；“刷新”按钮不带 `ifStale`，不受间隔限制。
  - 每次尝试只在结束时推一次 `github`，开始取时不推；`github` 的推送不触发 `notifier.tick()`。
  - L3（`panel-live`）加一条：连着 `/ws`、每次推送就重取 GET，没登录、找不到 `gh`、出错三种状态下 10 秒里 `gh` 只跑一轮（两条命令）、推送一到两次；失败后 60 秒内打开页面不重取，“刷新”照样立即取。浏览器复测（临时仓库，端口 4520）：`gh` 没登录时开着 GitHub 页 8 秒，`gh` 2 次、页面 GET 2 次。
- **I1** `03191bccc`：进程组只在仍是我们那一组时才算活着、才发信号（`ownGroupAlive`）。`/proc/<组号>` 在而启动时刻与登记的组长不同，是号被复用；EPERM 是别的用户的组；组长与 `/proc/<组号>` 都不在、组却在时，要有快照里 pid 与启动时刻都对得上的组员。为此组员在组长还在时（快照定时器与停法）、以及监管进程刚给组长收尸时记进快照（`collectDescendants` 加 `group` 参数，只在确知组是我们的时给）。L4 场景 3 加一条：复用 pid 的进程本身是组长（`detached`），判 `ended`、`dev stop` 回 `skipped`、它仍活着。
- **I2** `36fc4bfd9`：复用只认组长还活着的运行（`starting`、`running`、`supervisor_gone`）。
  - `leader_exited` 先按停法收掉残留再起新的，给 `leftovers_stopped`；停法提成 `stopRun`，与 `dev stop` 共用。
  - 已就绪的先按就绪判据探测一次地址，连不上报新错误码 `dev_unresponsive`（3），不替别人停服务：停要过 `dev stop` 的属主判据。选了报错而不是“收掉再重起”，写进 `cli.md`。
  - 复用 `orphaned` 时加回 `supervisor_gone` 警告；`shot` 取地址用同一判据并探测。
  - L4 两条：`leader_exited` 不复用、收掉残留再起；已就绪地址连不上时 `dev_unresponsive` 与 `shot` 的 5，没人监管、地址连得上时复用加 `supervisor_gone`、`shot` 拿到地址。
- **I3** `da50bc100`：打出 `NOT_READY` 之后监管进程照样读日志与探测（之后放慢到 2 秒一次），就绪时补写 `url`、`readyAt` 并再打 `READY`；复用方认出就绪也写回登记（锁内、只在 `readyAt` 为空时）。`cli.md` 写明 `NOT_READY` 之后可能还有 `READY`。L4 两条：晚就绪先 `NOT_READY` 后 `READY`，`dev status --wait-ready` 拿得到；复用方写回。
- **I4** `8b5148c1a`：checkout 页开着时每 10 秒自己重取一次，“N 秒前算的”按秒走（一分钟以上回到原来的写法）。浏览器复测：改回文件之后 25 秒内显示“干净”，标签从 0 秒走到 1 秒以上。
- **S1** `1e014209d`：复用方等就绪时每秒重读登记，复用的服务就绪前结束就打 `EXITED`、以 1 退出，不再等满时限后打 `NOT_READY`。
- **S2** `231853780`：停完还有进程没收掉时不写 `endedAt`，残留带启动时刻并进 `descendants`，状态 `orphaned`、可再 `dev stop`；`endedReason` 先写下，残留自己没了之后按它算。只是地址仍有回应、我们的进程都不在时，照记为结束，只在输出里报 `stop_incomplete`（`urlResponding: true`），写进 `file-formats.md`。L4 用不收尸的父进程留下的僵尸扮“停不掉的残留”。
- **S3** `fa950868a`：`searchCheckouts` 加 `namesOnly`，`find --name` 不跑 `git grep`，条数与截断只算文件名。
- **S4** `f18b8fedf`：`EXITED` 的 `leftovers` 按 pid 去重（快照里与进程组里的），L4 断言只留孙进程时是 `leftovers=1`。
- **S5** `615b4287c`：失败的检查带 `workflowName`，显示成“工作流 / 检查名”，`v-for` 按下标作 key；假 `gh` 加一个别的工作流里的同名检查。
- **S6** `fb552cde8`：`resolveLeaseTarget` 的注释放回原处；`github.ts` 引用的测试文件名改对；`package.json` 不是合法 JSON 时 `dev start` 与 `shot` 都报带路径的 `invalid_record`（共用 `readPackageScripts`）。
  - 偏离计划：“接口与数据”写的“`src/index.ts` 导出登记的读取与 `worktree new` 的核心函数”没有做。这些只有命令行与面板在用，包外没有调用方，按“小而实用”不导出。

验证（只跑点名的文件，herdr 的 L4 当时让给另一位审查者）：`dev-live`、`runs`、`find-shot`、`panel-live`、`ready` 都通过，`typecheck` 通过。浏览器复测（临时仓库加假 `gh`，端口 4520/4521）：B1、S5、I4 共 6 项通过，控制台没有错误。原有的 `accept.ts` 复跑时有两项按预期变了：假 `gh` 多了一个失败检查（“2 失败”变“3 失败”），复测里改回了 `docs/a.md`（主工作区不再有未提交）。截图 `shots/t14-fix-*.png`。

追加修正的审查（`evidences/impl-review-fixes.txt`，范围 `6b80522d7..9fc8cf009`，0 阻断、1 重要、3 建议）的处理，接在上面之后，每条一个提交：

- **重要 1** `4d8953605`：从奇数列接管仍会再 resize 一次。原因是 xterm 的 DOM 渲染器先把整屏宽度取整再除回列数，fit 用的 `css.cell` 随当前列数变。改法：列数与行数按 `_core._renderService.dimensions.device.cell` 除以 dpr 来算，与当前列数无关，量几次都一样；去掉 `@xterm/addon-fit`，`bun.lock` 同步。`device.cell` 与 fit 读的是同一个私有对象，只是换了字段，注释与 `TerminalView.md` 写明升级 xterm 时要核对。没有用审查给的另一种改法（记下框尺寸、没变就不发）：它只挡住切模式那一次，量出的数仍随列数的奇偶差 1。浏览器验收用审查的 `t12-resize.ts` 改成本地路径与端口 4530、命名会话 `nbdev-t12-resize`，去掉 `--hide-scrollbars`，前后两个构建对比（`shots/t12-fix2-resize.log`）：
  - 1280×800 从 119 列普通接管：修之前 138 再 139、释放行 `resizes: 1`；修之后只有 139、`resizes: 0`；
  - 1592×900：修之前 186 再 187；修之后只有 187；
  - 从 206 列抢过来：修之前与修之后都只变一次（139×28）；接管中缩到 900 宽也只变一次（80×28）。
- **建议 1** `acc8dbb0d`：旧记录的 `state_jumped` 改用普通色调，文案写“旧判据，可能误报，看一眼终端”，不算要处理的一条；`delivered` 加 `unwatched` 在尝试列表里也用 warning，与会话页的提示一致。醒目的判据合成一份 `attemptNeedsAttention`（`host/format.ts`），左栏计数与状态行共用；`NotifyStatus.vue` 里没用到的 `ATTENTION` 去掉。L1 `tests/notify-attention.test.ts`。
- **建议 2** `ca4c9bc89`：
  - L3：`watchStatus` 在轮询中、新 pane 还没换连接时回 null，换上之后才给；投递窗口里换订阅连接，留下的格记 `delivered`、`code: null`，被去掉的格记 `unwatched`；假 herdr 加 `blocked_in_reply`（回应里是 blocked），没有订阅时也报 `passed_blocked`。
  - L4：状态序号那条与新加的带观察的投递，都按 t12 的写法对 server 0.9.3 与 0.9.1 参数化。`fake-claude-tui.py` 加了可选的反应：`work` 回车后画“工作中”，`blocked_in_paste` 粘贴时先画信任确认，参照审查的 `react-claude.py`。两个版本上都是：正常进入工作记 `delivered`；别的会话在窗口里变两次（序号差 3）仍记 `delivered`；粘贴时弹出确认、回车确认了它，记 `passed_blocked`。正常进入工作的序号差在真实 herdr 上也是 2，旧判据连这条都会误报。
- **建议 3**：不改（回写包的 `AGENTS.md` 要开发者批准，由 coordinator 去问）。

全量验证（集成分支 `ca4c9bc89`）：
- 包里 `bun test` 338 条全过，含 L4：herdr 命名会话 0.9.3 与 0.9.1 两组、`dev-live` 18 条。
- `typecheck`、`build:web` 通过。
- 根上 `dev-panel-records`、`workspace-workflows`、`agent-governance` 177 条通过；`dev-panel-records` 在 Node 下 5 条通过。
- `governance:check`、`docs:check` 没有失败；`git diff --check` 干净。
