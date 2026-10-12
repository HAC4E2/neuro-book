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
| `nbdev lease list` | `--work <workRef>`、`--task <taskRef>`（要求同时有 `--work`；与 `status` 一样，找不到报 `work_not_found`、`task_not_found`）、`--all` | `nbdev.lease-list/v1` |
| `nbdev release [<workRef> <taskRef>]` | `--as` | `nbdev.release/v1` |
| `nbdev registry import` | 无 | `nbdev.registry-import/v1` |
| `nbdev status` | `--work <workRef>`、`--task <taskRef>`（要求同时有 `--work`） | `nbdev.status/v1` |
| `nbdev artifact publish <workRef> <taskRef> <artifactId>` | `--kind`（第一次必填：`design`、`report`、`review`）、`--title`、`--entry`（缺省 `index.html`）、`--keep <题号>`（可重复）、`--force-version`、`--as` | `nbdev.artifact-publish/v1` |
| `nbdev artifact close <workRef> <taskRef> <artifactId>` | `--as` | `nbdev.artifact-close/v1` |
| `nbdev ask <workRef> <taskRef>` | `--id`、`--type`、`--label`，`--option <值>[=<名称>]`（可重复，或 `@review`）、`--optional`、`--recommend <值>`（可重复）、`--artifact <artifactId>`、`--about <路径>`；或 `--from <JSON 文件>`（不与单题参数混用）；`--as` | `nbdev.ask/v1` |
| `nbdev ask withdraw <workRef> <taskRef> <提问>` | `--as` | `nbdev.ask-withdraw/v1` |
| `nbdev ask supersede <workRef> <taskRef> <提问>` | `--by <提问>` 必填、`--as` | `nbdev.ask-supersede/v1` |
| `nbdev answers [<workRef> [<taskRef> [<artifactId>]]]` | `--pending` 或 `--unacked`；`--wait`、`--timeout <秒>`、`--since <答复 id>`（`--wait` 不与 `--pending` 同用）；`--as` | `nbdev.answers/v1` |
| `nbdev answers ack <workRef> <taskRef> <artifactId>` | `--through <cursor>`、`--include <路径>`（可重复）、`--as` | `nbdev.answers-ack/v1` |
| `nbdev answers record <workRef> <taskRef> <artifactId>` | `--set <题号>=<值>`（可重复，至少一个；`multi` 用逗号分隔，`confirm` 写 `yes` 或 `no`）、`--comment <题号>=<文字>`（可重复）、`--note`、`--as` | `nbdev.answers-record/v1` |

- `workRef` 是完整 id（`w00022-dev-panel`）或编号（`w00022`）；`taskRef` 是完整 id 或编号（`t06`、`t100`）。
- `<提问>` 写 `<artifactId>#<题号>`；Task 提问集里的题可以只写题号。`--by` 另可写 `<workRef>/<taskRef>/<artifactId>#<题号>` 指向别的 Task。
- 每个命令都接受 `--json`。

### 写什么

- `work new`：领下一个 Work 号，在主工作区建 Work README（`status: active`、`updated`、“目标”一节）与首个 Task README（`status: planned`、`updated`），在 `master` 上提交这两个文件。
- `task new`：领该 Work 的下一个 Task 号，建 Task README 并提交。Work README 必须已提交到 `master`（否则 `work_not_committed`）；记录还在分支上维护的 Work 也一律写进 `master`。不改 Work README。
- `work status`、`task status`：只改 frontmatter 的 `status` 与 `updated` 两行并提交。取值与现值相同时不写不提交。记录来自分支、或 Work README 未提交时拒绝。目标文件在主工作区有未提交改动时默认拒绝，`--include-uncommitted` 才连同这些改动一起提交。
- `registry import`：按扫描结果补登 `imported` 条目，只写 `.local/agent/registry.json`，可以重复运行。
- `status`：只读，不取锁，不写任何文件，不加载页面解析器；herdr 只调只读方法，总时限 2.5 秒。
- `artifact publish`：页面文件由会话直接写在主工作区的产物目录里；在写事务的锁内读上一版、列页面文件、解析提问标记、算 `contentHash`、生成新的题表，写 `versions/v<N>.json`，与产物目录里 Git 有变化的页面文件（不含删除项与 `answers/`）一起提交。内容与题都没变时不出新版本（`unchanged: true`），`--force-version` 照样出。格式与题表规则见 [文件格式](file-formats.md#产物)。
- `artifact close`、`ask`、`ask withdraw`、`ask supersede`：各写一版新的发布记录，沿用上一版的内容字段，页面不重新解析。`ask` 不给 `--artifact` 时记进 Task 的提问集（`artifacts/questions/`，第一次登记时建它）；指向已关闭的产物报 `artifact_closed`。Task 的提问集不能 `artifact close`（`usage`）：它不能发布，关了就没法重新打开，不要的题逐题 `ask withdraw`。`--about` 只校验路径格式，主工作区与调用者的 checkout 里都找不到时给 `about_not_found` 警告。
- `answers record`：写一份代录的答复（`submittedBy.kind: "agent-transcribed"`）；`--set`、`--comment` 的题号不合格式、或同一道题给了两次时报 `usage`。`answers --since` 不是答复 id 的写法时报 `usage`。`answers ack`：写一份确认，并把 `--include` 列出的记录（相对主工作区根，只收 `.agents/works/` 下的普通文件；目录与被 `.gitignore` 忽略的文件在写任何东西之前报 `usage`）放进同一个提交。`--through` 填读答复时输出里的 `cursor`：只确认 id 不大于它的未确认答复（同一个 `answers/` 目录里 id 在锁内单调生成，不大于游标就是会话读之前已落位），比它新的留着、给 `newer_answers_unacked`。不给 `--through` 时确认锁内看到的全部未确认答复，其中可能有会话没读过的，给 `ack_without_through`。要确认的答复为空时不写，给 `already_acked`，`--include` 的文件也不提交。
- 这些写入都要求：Work README 与 Task README 已提交到 `master`（否则 `work_not_committed`、`task_not_committed`）；Task 的来源是 `master`（判定同 `task status`：来自分支的 Work 里，只在 `master` 上的 Task 或经 nbdev 领号的 Task 可以写，否则 `branch_maintained_record`）。发布、答复、确认都不改 Task README 的 `updated`。
- 写完之后续期调用者在这个 Task 上的租约，再把“谁写的”记进运行时的 provenance（见 [文件格式](file-formats.md#provenance)）；入库的文件里没有会话。

### 会话与租约

- **调用者是谁**（每个命令都在边界上解析一次，`status --json` 的 `data.caller` 给出结果）：
  1. `--as <标签>`：外部会话 `external:<标签>`。标签要唯一，两个外部会话用同一个标签会被当成一个会话；在 herdr pane 里用 `--as` 时不写 pane 标签。
  2. `CLAUDE_CODE_SESSION_ID`：只在 `CLAUDE_PID` 存在、进程还活着、id 是 UUID、并且是调用者进程的祖先时才信，否则给 `claude_env_untrusted` 警告（`details.reason` 为 `invalid` 或 `not_ancestor`）并忽略。环境变量是继承来的：herdr server、tmux 若是从某个 Claude 的 Bash 里起的，里面所有 pane 都会带着那个仍活着的 `CLAUDE_PID`。子代理与 Claude 会话派出的进程（包括 `omp -p`）都继承它，记在同一个会话名下；嵌套的 `claude -p`（外层的 `CLAUDE_PID` 是内层 claude 的祖先）归到外层会话，`parentSessionId` 记外层的 id，`nestedSessionId` 记调用者环境里的内层 id。
  3. 只有 `HERDR_PANE_ID`（omp 等）：用那格 pane 上 herdr 认出的 Agent 会话，进程记 pane 的前台主进程；读不到 pane 的进程信息时进程记 `null`，给 `herdr_partial` 警告。
  4. 都没有：未知调用者。写命令照常完成但不取得租约（`caller_unknown` 警告）；`lease take`、`release` 报 `caller_unknown`。
- **自动取得与续期**：`work new`、`task new` 之后取得新 Task 的租约（提交失败但文件已写、号已领时也取）；`task status` 改成别的状态时续期调用者的租约。
- **自动释放**：Task 改成 `done` 或 `shelved` 时释放这个 Task 的全部租约，与由谁调用无关（面板以开发者身份改状态时同样释放）。
- `lease take` 遇到已 `done` 或 `shelved` 的 Task 报 `task_closed`。
- **不带参数的 `release` 释放调用者的全部租约**。子代理与父会话是同一个身份，子代理这样做会释放父会话的全部租约。
- **pane 标签**：调用者在 herdr 里（不是 `--as`）时，取得或续期后给它自己的 pane 写 `work`、`task` 两个 token（`w00022`、`t07`，24 小时后过期）；释放时只有它最近活动的那份有效租约被释放才改写成下一份，没有就清空。别的会话 pane 上的标签不动。写或清之前先用 `pane.process_info` 确认调用者的会话进程（Claude 是外层的 `CLAUDE_PID`，omp 是前台进程组组长）就在这格 pane 的前台：`HERDR_PANE_ID` 与 herdr 记的会话都可能过时（后台会话、被别的会话占用的 pane），不在前台就不写，给 `herdr_tag_skipped`。
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
  - `sessions[]`：有有效租约或有运行的会话，`{key, agent, sessionId, label, parentSessionId, nestedSessionId, alive, managed, herdr: {paneId, status}, leases, runs}`；`alive` 是会话进程是否还在（不知道时为 `null`），`managed` 表示 herdr 现在的列表里有它（能通知）；
  - 运行 `{pid, startedAt, command, cwd, checkout, owner, ownerVia, paneId, unit, sessionHint, sessionAlive, descendants}`；`unownedRuns` 是普通 shell pane 里起的进程、systemd 服务单元（`systemd-run`）里的进程，以及会话已不在、但带着它的工具标记的进程（`sessionHint` 为标记里的会话键，`sessionAlive` 为 `false`）。归属规则见 [herdr 适配](herdr.md#运行的归属)。
- `status` 的 `data` 另有：
  - `inbox[]`：只放要开发者动手的事，`{kind: "question", workId, taskId, artifactId, questionId, label, type, version, since, askedBy}`（`open` 的必答题；`askedBy` 是运行时的会话键，读不到为 `null`）与 `{kind: "number_conflict", label, live}`；带 `--work` 时只列范围内的；
  - Task 的 `artifacts[]`：`{artifactId, kind, title, version, state, publishedAt, openRequired, adoption}`，没有发布记录的 `state` 为 `unpublished`；Task 与 Work 的 `documents[]`：`{path, title}`；Work 的 `artifacts[]`（Work 级产物，只索引）；
  - Task 的 `updated`：frontmatter 的 `updated` 与产物目录最后一次提交的日期中较晚的那个。
- `artifact publish` 的 `data`：`workId`、`taskId`、`artifactId`、`unchanged`、`version`、`path`、`questions`（新版本的全部题）、`dropped`（被这一版取代的题）、`retiredInPage`、`restored`、`committedFiles`、`previous`（`{version, publishedAt, publishedBy}`，`publishedBy` 读 provenance）、`lease`、`commit`。`artifact close`、`ask`、`ask withdraw`、`ask supersede` 的 `data`：`workId`、`taskId`、`artifactId`、`unchanged`、`version`、`path`、`questions`、`affected`、`lease`、`commit`。
- `answers` 的 `data`：`artifacts[]` 与 `cursor`（范围内最大的答复 id）。每个产物：`workId`、`taskId`、`artifactId`、`kind`、`title`、`version`、`state`、`publishedAt`、`openRequired`、`adoption`（`none`、`waiting`、`adopted`）、`questions[]`（`{question, state, answer, stale}`，`answer` 带 `answerId`、`value`、`artifactVersion`、`submittedAt`、`comment`；`stale` 是按最新一版不合法、作废了的最新答复，字段同 `answer` 外加 `reason`（文案）与 `code`（`stale_value`：按它针对的那一版合法、选项后来改了；`invalid_value`：按那一版也不合法），没有时为 `null`，按 `code` 分支）、`answers[]`、`acks[]`、`unacked[]`、`cursor`。`--pending` 只留有 `open` 必答题的产物、题也只留这些；`--unacked` 只留有未确认答复的产物；`--since` 只留有更新答复的产物、答复也只留这些。指定了 Task 时续期调用者的租约。
- `answers ack` 的 `data`：`acked`、`ack`、`path`、`newer`（比 `--through` 新、没有确认的答复 id）、`lease`、`commit`；`answers record` 的 `data`：`answer`、`path`、`lease`、`commit`。
- **提交失败后的补救**：写入的文件已经在主工作区，`data.commit.writtenPaths` 列出它们。`versions/`、`answers/` 只由 nbdev 写，那里还没进 HEAD 的文件（未跟踪或已暂存未提交）只可能是提交失败的残留，所以之后每次写同一个产物（发布、关闭、登记、撤回、取代、代录、确认）都把它们顺带提交，给 `residual_records_committed`。发布、关闭与确认重跑同一条命令即可：内容没变、已经关闭、或答复都已确认时不写新记录，只补交残留（发布连同有变化的页面文件，确认连同 `--include` 的文件）。`ask`、`ask withdraw`、`ask supersede`、`answers record` 不要重跑（会报题号重复、已撤回、已取代，或再写一份），等下一次写这个产物时补交，或手动提交这些路径（`git commit -- <路径>`）。
- `registry import` 的 `data`：`added`、`nextWorkNumber`、`nextTaskNumbers`（按 Work id）、`conflicts`、`registryOnly`。
- `conflicts[]` 的元素：`{kind, label, workId?, live, ids: [{id, live, locations}]}`；`locations` 的元素是 `{source: "main" | "worktree" | "ref", checkout?, ref?, head?}`。一个 id 只出现在 `master` 改名或删除后留下的旧副本里时不算 `live`；一组撞号至少两个 id `live` 时这组 `live`。

## 退出码

| 退出码 | 含义 | 错误码 |
|---|---|---|
| 0 | 成功，含带警告的成功与撞号 | |
| 1 | 运行失败 | `lock_timeout`、`lock_failed`、`lock_compromised`、`cross_device`、`git_failed`、`git_identity_missing`、`commit_failed`、`write_failed`、`schema_unsupported`、`invalid_record`、`number_exhausted`、`internal` |
| 2 | 用法错误 | `usage`、`invalid_slug`、`invalid_status`、`invalid_title`、`caller_unknown`、`invalid_artifact_id`、`invalid_questions`、`invalid_answer` |
| 3 | 需要人决定的冲突 | `main_not_on_master`、`main_busy`、`branch_maintained_record`、`ambiguous_work`、`ambiguous_task`、`work_not_committed`、`task_not_committed`、`target_exists`、`target_missing`、`task_closed`、`hash_mismatch`、`uncommitted_changes`、`unsafe_path`、`shim_exists`、`duplicate_question`、`artifact_closed`、`question_closed` |
| 4 | 等待没有结果（`answers --wait`）：超时或被信号打断 | `wait_timeout`、`wait_interrupted` |
| 5 | 找不到对象 | `repository_not_found`、`records_root_not_found`、`master_not_found`、`work_not_found`、`task_not_found`、`shim_target_not_found`、`artifact_not_found`、`question_not_found`、`entry_missing`、`no_answers` |

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
| `herdr_partial` | 部分 pane 的进程信息没读到：`status` 按没有这格处理；只靠 `HERDR_PANE_ID` 认的调用者不记会话进程 |
| `herdr_tag_failed` | 写 pane 标签失败，或写之前读 pane 的进程信息失败（只影响显示） |
| `herdr_tag_skipped` | 调用者的会话进程不在那格 pane 的前台（`details.reason`：`caller_not_in_foreground`、`caller_process_unknown`、`pane_not_found`），没有写标签 |
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
| `questions_dropped` | 页面里没有了、还没答的题记为被这一版取代；暂时删掉的用 `--keep` 保留 |
| `retired_question_in_page` | 已撤回或已取代的题号又出现在页面里，结局不变 |
| `artifact_reopened` | 发布重新打开了已关闭的产物，恢复了因关闭而撤回的题里页面还在的与 `ask` 登记的 |
| `questions_in_script` | 脚本、模板、`noscript` 或 `.js` 文件里出现了提问标记，解析不到 |
| `missing_reference` | 页面引用的本地文件不存在 |
| `reference_outside_artifact` | 页面引用了产物目录之外的文件 |
| `image_too_large` | 产物目录里有超过 300 KiB 的图片 |
| `task_images_too_large` | 这个 Task 的 `artifacts/` 与 `evidences/` 里的图片合计超过 5 MiB |
| `artifact_deletions_not_committed` | 产物目录里有被删的文件，没有随发布提交 |
| `already_closed` | 产物已经关闭，没有出新版本 |
| `wait_scope_empty` | `answers --wait` 开始时范围里还没有产物；照常等，等待期间新建的产物会加入范围 |
| `already_acked` | 要确认的答复（给了 `--through` 时为不比它新的）都已确认，没有写新的确认；有残留时照样补交残留与 `--include` 的文件 |
| `residual_records_committed` | 产物的 `versions/`、`answers/` 里有上次提交失败留下的文件，这次一起提交了 |
| `newer_answers_unacked` | 有比 `--through` 新的未确认答复，这次没有确认它们；先读再确认 |
| `ack_without_through` | 没给 `--through`，确认了锁内看到的全部未确认答复，其中可能有会话没读过的 |
| `about_not_found` | `--about` 的文件在主工作区与当前 checkout 里都找不到 |
| `open_questions` | Task 改成 `done` 或 `shelved` 时还有 `open` 的必答题（不自动撤回） |
| `provenance_write_failed` | 记 provenance 失败，只影响“谁问的”这条线索 |
| `unreadable_artifact_record` | 某个发布记录、答复或确认读不出，已跳过 |
| `unreadable_provenance` | 某个 provenance 文件读不出，按没有处理 |
| `schema_unsupported` | 读列表时遇到不认识主版本的文件，已跳过 |

## `answers --wait`

- 等到选中的答复不为空就退出（退出码 0），输出与不带 `--wait` 时相同。缺省按未确认的答复选：已有未确认的答复时立即返回，所以发布之后、挂上等待之前到达的答复不会被漏掉。只想等之后的新答复时加 `--since <cursor>`（`cursor` 取上一次输出里的值）。
- 开始时完整读一次范围内的产物，在 stderr 报一行“等待中”；之后每秒只 `readdir` 主工作区里这些产物的 `answers/`，不跑 Git，目录有变化才重读那个产物。没指定产物时还 `readdir` 范围内各 Task 的 `artifacts/`，等待期间新建的产物（例如先挂等待、后 `ask` 建出的 Task 提问集）加入范围。范围里一个产物都没有时照常等，给 `wait_scope_empty`。
- `--timeout` 缺省 1800 秒，到点退出码 4（`wait_timeout`）；收到 SIGTERM 或 SIGINT 退出码同样是 4（`wait_interrupted`）。
- **重挂办法**：退出码 4（或被宿主结束）时按原参数重挂；退出码 0 时先处理答复并 `answers ack --through <cursor>`，或带 `--since <cursor>` 重挂，否则按原参数重挂会立刻返回。
- Claude Code 会话用 `run_in_background` 挂着，命令一退出会话就被唤醒；单个后台任务能活多久没有核实，被宿主结束时照样按原参数重挂，不会丢答复。

## 失败时留下什么

- 取锁之前或锁内校验失败（退出码 2、3、5，以及 `lock_timeout`）：不写任何记录。
- 登记表已写、落位或提交失败：号已经是 `claimed`，不会再发；已落位的文件留在主工作区，输出 `writtenPaths`。
- `.local/agent/run/tmp/` 里中断事务留下的目录不自动清理，确认没有 nbdev 在跑后可以删。
