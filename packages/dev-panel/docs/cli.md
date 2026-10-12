# nbdev 命令行合同

`nbdev` 是 Agent 用的入口；面板（后续）与它共用 `src/core/` 的同一套实现。命令行在任何 checkout 里都能运行：它用 `git worktree list` 找到主工作区，记录一律读写主工作区。

## 安装与调用

- 用户级入口 `~/.local/bin/nbdev` 是一个 shim，由 `bun run --cwd packages/dev-panel install-shim` 写入，内容只有 `exec <bun 的绝对路径> "<主工作区>/packages/dev-panel/src/cli.ts" "$@"`。shim 跑的是主工作区里的代码：worktree 分支里可能没有这个命令，或者是旧版本。
- 没装 shim 时直接运行 `bun <主工作区>/packages/dev-panel/src/cli.ts <命令>`。不要用 `bun run --cwd`：它会把 cwd 换成包目录，命令行就不知道调用者在哪。
- `install-shim` 的参数：`--bin-dir <目录>`（缺省 `~/.local/bin`）、`--target <checkout>`（缺省主工作区）、`--force`（覆盖不是本脚本写的同名文件或符号链接；目标是目录时一律不覆盖）、`--json`（`schema` 为 `nbdev.install-shim/v1`）。相对路径按当前目录解析；经 `bun run --cwd packages/dev-panel install-shim -- …` 调用时当前目录是包目录，所以 `--bin-dir`、`--target` 最好写绝对路径。

## 命令

| 命令 | 参数 | `schema` |
|---|---|---|
| `nbdev work new <slug>` | `--title`、`--goal`、`--task <slug>` 必填；`--task-title`（缺省用 Work 标题）、`--issue <正整数>`、`--status`（首个 Task 的状态，缺省 `planned`）、`--as` | `nbdev.work-new/v1` |
| `nbdev task new <workRef> <slug>` | `--title` 必填；`--goal`、`--status`、`--as` | `nbdev.task-new/v1` |
| `nbdev work status <workRef> <status>` | `--include-uncommitted` | `nbdev.work-status/v1` |
| `nbdev task status <workRef> <taskRef> <status>` | `--include-uncommitted`、`--as` | `nbdev.task-status/v1` |
| `nbdev lease take <workRef> <taskRef>` | `--as` | `nbdev.lease-take/v1` |
| `nbdev lease list` | `--work <workRef>`、`--task <taskRef>`（要求同时有 `--work`）、`--all` | `nbdev.lease-list/v1` |
| `nbdev release [<workRef> <taskRef>]` | `--as` | `nbdev.release/v1` |
| `nbdev registry import` | 无 | `nbdev.registry-import/v1` |
| `nbdev status` | `--work <workRef>`、`--task <taskRef>`（要求同时有 `--work`） | `nbdev.status/v1` |

- `workRef` 是完整 id（`w00022-dev-panel`）或编号（`w00022`）；`taskRef` 是完整 id 或编号（`t06`、`t100`）。
- 每个命令都接受 `--json`。

### 写什么

- `work new`：领下一个 Work 号，在主工作区建 Work README（`status: active`、`updated`、“目标”一节）与首个 Task README（`status: planned`、`updated`），在 `master` 上提交这两个文件。
- `task new`：领该 Work 的下一个 Task 号，建 Task README 并提交。Work README 必须已提交到 `master`（否则 `work_not_committed`）；记录还在分支上维护的 Work 也一律写进 `master`。不改 Work README。
- `work status`、`task status`：只改 frontmatter 的 `status` 与 `updated` 两行并提交。取值与现值相同时不写不提交。记录来自分支、或 Work README 未提交时拒绝。目标文件在主工作区有未提交改动时默认拒绝，`--include-uncommitted` 才连同这些改动一起提交。
- `registry import`：按扫描结果补登 `imported` 条目，只写 `.local/agent/registry.json`，可以重复运行。
- `status`：只读，不取锁，不写任何文件；herdr 只调只读方法，总时限 2.5 秒。

### 会话与租约

- **调用者是谁**（每个命令都在边界上解析一次，`status --json` 的 `data.caller` 给出结果）：
  1. `--as <标签>`：外部会话 `external:<标签>`。标签要唯一，两个外部会话用同一个标签会被当成一个会话；在 herdr pane 里用 `--as` 时不写 pane 标签。
  2. `CLAUDE_CODE_SESSION_ID`：只在 `CLAUDE_PID` 存在、进程还活着、id 是 UUID 时才信，否则给 `claude_env_untrusted` 警告并忽略。子代理与 Claude 会话派出的进程（包括 `omp -p`）都继承它，记在同一个会话名下；嵌套的 `claude -p` 归到外层会话，`parentSessionId` 记外层的 id。
  3. 只有 `HERDR_PANE_ID`（omp 等）：用那格 pane 上 herdr 认出的 Agent 会话。
  4. 都没有：未知调用者。写命令照常完成但不取得租约（`caller_unknown` 警告）；`lease take`、`release` 报 `caller_unknown`。
- **自动取得与续期**：`work new`、`task new` 之后取得新 Task 的租约（提交失败但文件已写、号已领时也取）；`task status` 改成别的状态时续期调用者的租约。
- **自动释放**：Task 改成 `done` 或 `shelved` 时释放这个 Task 的全部租约，与由谁调用无关（面板以开发者身份改状态时同样释放）。
- `lease take` 遇到已 `done` 或 `shelved` 的 Task 报 `task_closed`。
- **不带参数的 `release` 释放调用者的全部租约**。子代理与父会话是同一个身份，子代理这样做会释放父会话的全部租约。
- **pane 标签**：调用者在 herdr 里（不是 `--as`）时，取得或续期后给它自己的 pane 写 `work`、`task` 两个 token（`w00022`、`t07`，24 小时后过期）；释放时只有它最近活动的那份有效租约被释放才改写成下一份，没有就清空。别的会话 pane 上的标签不动。
- 租约的有效性在读取时现算，规则见 [文件格式](file-formats.md#租约)。

提交消息为 `docs(<Work 编号>): …`，以主工作区的 Git 身份提交，只提交本次事务的路径；主工作区暂存区里别人的改动原样留着。

## `--json` 外壳

stdout 只有一个对象，诊断走 stderr：

```json
{"schema": "nbdev.task-new/v1", "ok": true, "data": {}, "warnings": [], "errors": []}
```

- `warnings`、`errors` 的元素是 `{code, message, details?}`，调用方按 `code` 判断，不看 `message`。
- 不带命令、命令不认识或参数在分派到命令之前就出错时，`schema` 为 `nbdev.cli/v1`（错误码 `usage`，退出码 2）；`nbdev help --json`（或 `--help --json`）同样用 `nbdev.cli/v1`，`data.usage` 是用法文本。
- 写命令的 `data`：`workId`、`taskId`、`paths`、`commit`、`conflicts`、`registryOnly`（登记表里有、但哪里都找不到的 id；本次刚领的号不算），以及 `lease`（取得或续期后的租约，未知调用者为 `null`）与 `released`（这次释放的租约）。`commit` 是下列之一：
  - `{"committed": true, "sha", "paths", "viaOtherCommit"}`：`viaOtherCommit` 为真表示文件被别的会话不带路径的提交一起带走了，内容已在 `master`；
  - `{"committed": false, "reason": "nothing_to_commit", "paths"}`：写入的内容与 `HEAD` 相同，无需提交；
  - `{"committed": false, "reason": "git_lock_timeout" | "git_failed", "writtenPaths", "detail"}`：文件已写在主工作区但没有提交，退出码 1。不要重跑 `task new`（号已领），先处理 Git 的问题，再手动提交 `writtenPaths`。`git_lock_timeout` 只在等 `index.lock` 约 10 秒仍被占着时出现；其它失败（钩子拒绝、对象库不可写等）是 `git_failed`，`detail` 里有 Git 的输出。Git 退出码 128 而一直没见到 `index.lock` 时，连续 5 次就停止重试。
- 写命令在取锁之前先查 Git 提交身份（`git var GIT_AUTHOR_IDENT`、`GIT_COMMITTER_IDENT`），缺了就报 `git_identity_missing`，不写任何东西。
- 状态命令的 `data`：`workId`、`taskId`、`path`、`previous`、`next`、`changed`、`commit`；`task status` 另有 `lease`、`released`。
- `lease take` 的 `data`：`workId`、`taskId`、`lease`、`released`；`release` 的 `data`：`lease`（`null`）、`released`；`lease list` 的 `data`：`leases[]`（租约加现算的 `state`、`stale`、`managed`）。
- `status` 的 `data`：`mainRoot`、`callerRoot`、`callerBranch`、`caller`、`works[]`（`workId`、`title`、`issueId`、`goal`、`status`、`updated`、`source`、`branch`、`checkout`、`executionRule`、`otherCopies`、`uncommitted`、`activeLeases`、`taskCounts`、`tasks[]`，Task 另有 `leases`）、`conflicts[]`、`registryOnly[]`、`nextWorkNumber`（例如 `w00023`）、`sessions[]`、`unownedRuns[]`、`ignoredProcesses`、`herdr`。`goal`、`status`、`updated` 是 `{value, origin}`，`origin` 的含义见 [文件格式](file-formats.md#记录的读法)。
- `status` 的临时数据（会话结束或进程退出就消失）：
  - `caller`：`{kind: "session", ref, via, process, herdr}` 或 `{kind: "unknown", reason, herdrPaneId}`；
  - `activeLeases`、`leases`：有效租约 `{sessionKey, agent, label, taskId, lastActivityAt, stale}`，`stale` 表示超过 2 小时没有 Task 相关操作（淡化显示）；
  - `sessions[]`：有有效租约或有运行的会话，`{key, agent, sessionId, label, parentSessionId, alive, managed, herdr: {paneId, status}, leases, runs}`；`alive` 是会话进程是否还在（不知道时为 `null`），`managed` 表示 herdr 现在的列表里有它（能通知）；
  - 运行 `{pid, startedAt, command, cwd, checkout, owner, ownerVia, paneId, unit, descendants}`；`unownedRuns` 是普通 shell pane 里起的进程与 systemd 服务单元（`systemd-run`）里的进程。归属规则见 [herdr 适配](herdr.md#运行的归属)。
- `registry import` 的 `data`：`added`、`nextWorkNumber`、`nextTaskNumbers`（按 Work id）、`conflicts`、`registryOnly`。
- `conflicts[]` 的元素：`{kind, label, workId?, live, ids: [{id, live, locations}]}`；`locations` 的元素是 `{source: "main" | "worktree" | "ref", checkout?, ref?, head?}`。一个 id 只出现在 `master` 改名或删除后留下的旧副本里时不算 `live`；一组撞号至少两个 id `live` 时这组 `live`。

## 退出码

| 退出码 | 含义 | 错误码 |
|---|---|---|
| 0 | 成功，含带警告的成功与撞号 | |
| 1 | 运行失败 | `lock_timeout`、`lock_failed`、`lock_compromised`、`cross_device`、`git_failed`、`git_identity_missing`、`commit_failed`、`write_failed`、`schema_unsupported`、`invalid_record`、`number_exhausted`、`internal` |
| 2 | 用法错误 | `usage`、`invalid_slug`、`invalid_status`、`invalid_title`、`caller_unknown` |
| 3 | 需要人决定的冲突 | `main_not_on_master`、`main_busy`、`branch_maintained_record`、`ambiguous_work`、`ambiguous_task`、`work_not_committed`、`target_exists`、`target_missing`、`task_closed`、`hash_mismatch`、`uncommitted_changes`、`unsafe_path`、`shim_exists` |
| 4 | 等待超时（`answers --wait`，后续） | |
| 5 | 找不到对象 | `repository_not_found`、`records_root_not_found`、`master_not_found`、`work_not_found`、`task_not_found`、`shim_target_not_found` |

## 警告

| `code` | 含义 |
|---|---|
| `registry_initialized` | 登记表原本不存在，这次按扫描结果整表导入 |
| `unregistered_ids` | 扫描到登记表里没有的号，已补登为 `imported`；说明有人绕过了 nbdev |
| `number_conflicts` | 有撞号，详见 `conflicts` |
| `prunable_worktree` | 某个已登记的 worktree 目录已不存在，跳过 |
| `caller_unknown` | 认不出调用者，没有取得租约 |
| `claude_env_untrusted` | 环境里的 Claude 会话 id 不可信，已忽略 |
| `herdr_unavailable` | 连不上 herdr 或读不出它的 pane 列表；租约照常按会话进程与 24 小时判断 |
| `herdr_partial` | 部分 pane 的进程信息没读到，按没有这格处理 |
| `herdr_tag_failed` | 写 pane 标签失败（只影响显示） |
| `lease_write_failed` | 取得、续期、释放租约或读调用者自己的租约失败（权限、磁盘满等）；记录操作不受影响，命令照常成功并带回 `data.commit` |
| `lease_release_skipped` | Task 改成 `done` 或 `shelved` 之后、释放租约之前，别的会话又把它改回去了，这次不释放 |
| `unreadable_lease` | 某个租约文件（或整个租约目录）读不了或内容不合规，已跳过 |
| `worktree_skipped` | 某个 worktree 读不出相对 master 的记录改动（HEAD 还没有提交、与 master 没有共同祖先、浅克隆截断了历史），跳过；`details.reason` 写明原因 |
| `uncommitted_branch_records` | 某个 worktree 只有未提交的记录改动，没有算作“来自分支” |
| `invalid_status_value` | 记录的 `status` 不在取值集合里 |
| `unreadable_record` | README 缺失或 frontmatter 无法解析 |
| `main_not_on_master` | `status` 时主工作区不在 `master`，照常读工作区 |
| `commit_via_other_commit` | 本次的文件被别的提交带走 |
| `commit_paths_mismatch` | 本次提交的路径与预期不一致 |
| `lock_release_failed` | 放锁失败 |
| `lock_release_skipped` | 放锁时锁已属于别的进程，没有动它 |
| `lock_taken_over` | 取锁时接管了已退出进程留下的（或损坏的）锁 |
| `lock_reacquired` | 写入之前发现锁被别的进程拿走，已重新取锁并重算 |
| `tmp_cleanup_failed` | 删除本次事务的临时目录失败 |

## 失败时留下什么

- 取锁之前或锁内校验失败（退出码 2、3、5，以及 `lock_timeout`）：不写任何记录。
- 登记表已写、落位或提交失败：号已经是 `claimed`，不会再发；已落位的文件留在主工作区，输出 `writtenPaths`。
- `.local/agent/run/tmp/` 里中断事务留下的目录不自动清理，确认没有 nbdev 在跑后可以删。
