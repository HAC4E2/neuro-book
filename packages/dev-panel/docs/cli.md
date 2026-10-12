# nbdev 命令行合同

`nbdev` 是 Agent 用的入口；面板（后续）与它共用 `src/core/` 的同一套实现。命令行在任何 checkout 里都能运行：它用 `git worktree list` 找到主工作区，记录一律读写主工作区。

## 安装与调用

- 用户级入口 `~/.local/bin/nbdev` 是一个 shim，由 `bun run --cwd packages/dev-panel install-shim` 写入，内容只有 `exec <bun 的绝对路径> "<主工作区>/packages/dev-panel/src/cli.ts" "$@"`。shim 跑的是主工作区里的代码：worktree 分支里可能没有这个命令，或者是旧版本。
- 没装 shim 时直接运行 `bun <主工作区>/packages/dev-panel/src/cli.ts <命令>`。不要用 `bun run --cwd`：它会把 cwd 换成包目录，命令行就不知道调用者在哪。
- `install-shim` 的参数：`--bin-dir <目录>`（缺省 `~/.local/bin`）、`--target <checkout>`（缺省主工作区）、`--force`（覆盖不是本脚本写的同名文件）、`--json`（`schema` 为 `nbdev.install-shim/v1`）。

## 命令

| 命令 | 参数 | `schema` |
|---|---|---|
| `nbdev work new <slug>` | `--title`、`--goal`、`--task <slug>` 必填；`--task-title`（缺省用 Work 标题）、`--issue <正整数>`、`--status`（首个 Task 的状态，缺省 `planned`） | `nbdev.work-new/v1` |
| `nbdev task new <workRef> <slug>` | `--title` 必填；`--goal`、`--status` | `nbdev.task-new/v1` |
| `nbdev work status <workRef> <status>` | `--include-uncommitted` | `nbdev.work-status/v1` |
| `nbdev task status <workRef> <taskRef> <status>` | `--include-uncommitted` | `nbdev.task-status/v1` |
| `nbdev registry import` | 无 | `nbdev.registry-import/v1` |
| `nbdev status` | `--work <workRef>`、`--task <taskRef>`（要求同时有 `--work`） | `nbdev.status/v1` |

- `workRef` 是完整 id（`w00022-dev-panel`）或编号（`w00022`）；`taskRef` 是完整 id 或编号（`t06`、`t100`）。
- 每个命令都接受 `--json`。

### 写什么

- `work new`：领下一个 Work 号，在主工作区建 Work README（`status: active`、`updated`、“目标”一节）与首个 Task README（`status: planned`、`updated`），在 `master` 上提交这两个文件。
- `task new`：领该 Work 的下一个 Task 号，建 Task README 并提交。Work README 必须已提交到 `master`（否则 `work_not_committed`）；记录还在分支上维护的 Work 也一律写进 `master`。不改 Work README。
- `work status`、`task status`：只改 frontmatter 的 `status` 与 `updated` 两行并提交。取值与现值相同时不写不提交。记录来自分支、或 Work README 未提交时拒绝。目标文件在主工作区有未提交改动时默认拒绝，`--include-uncommitted` 才连同这些改动一起提交。
- `registry import`：按扫描结果补登 `imported` 条目，只写 `.local/agent/registry.json`，可以重复运行。
- `status`：只读，不取锁，不写任何文件。

提交消息为 `docs(<Work 编号>): …`，以主工作区的 Git 身份提交，只提交本次事务的路径；主工作区暂存区里别人的改动原样留着。

## `--json` 外壳

stdout 只有一个对象，诊断走 stderr：

```json
{"schema": "nbdev.task-new/v1", "ok": true, "data": {}, "warnings": [], "errors": []}
```

- `warnings`、`errors` 的元素是 `{code, message, details?}`，调用方按 `code` 判断，不看 `message`。
- 写命令的 `data`：`workId`、`taskId`、`paths`、`commit`、`conflicts`。`commit` 是下列之一：
  - `{"committed": true, "sha", "paths", "viaOtherCommit"}`：`viaOtherCommit` 为真表示文件被别的会话不带路径的提交一起带走了，内容已在 `master`；
  - `{"committed": false, "reason": "nothing_to_commit", "paths"}`：写入的内容与 `HEAD` 相同，无需提交；
  - `{"committed": false, "reason": "git_lock_timeout" | "git_failed", "writtenPaths", "detail"}`：文件已写在主工作区但没有提交，退出码 1。不要重跑 `task new`（号已领），先处理 Git 的问题，再手动提交 `writtenPaths`。
- 状态命令的 `data`：`workId`、`taskId`、`path`、`previous`、`next`、`changed`、`commit`。
- `status` 的 `data`：`mainRoot`、`callerRoot`、`callerBranch`、`works[]`（`workId`、`title`、`issueId`、`goal`、`status`、`updated`、`source`、`branch`、`checkout`、`executionRule`、`otherCopies`、`uncommitted`、`taskCounts`、`tasks[]`）、`conflicts[]`、`registryOnly[]`、`nextWorkNumber`（例如 `w00023`）。`goal`、`status`、`updated` 是 `{value, origin}`，`origin` 的含义见 [文件格式](file-formats.md#记录的读法)。
- `registry import` 的 `data`：`added`、`nextWorkNumber`、`nextTaskNumbers`（按 Work id）、`conflicts`、`registryOnly`。
- `conflicts[]` 的元素：`{kind, label, workId?, live, ids: [{id, live, locations}]}`；`locations` 的元素是 `{source: "main" | "worktree" | "ref", checkout?, ref?, head?}`。一个 id 只出现在 `master` 改名或删除后留下的旧副本里时不算 `live`；一组撞号至少两个 id `live` 时这组 `live`。

## 退出码

| 退出码 | 含义 | 错误码 |
|---|---|---|
| 0 | 成功，含带警告的成功与撞号 | |
| 1 | 运行失败 | `lock_timeout`、`lock_failed`、`lock_compromised`、`cross_device`、`git_failed`、`commit_failed`、`write_failed`、`schema_unsupported`、`invalid_record`、`number_exhausted`、`internal` |
| 2 | 用法错误 | `usage`、`invalid_slug`、`invalid_status`、`invalid_title` |
| 3 | 需要人决定的冲突 | `main_not_on_master`、`main_busy`、`branch_maintained_record`、`ambiguous_work`、`ambiguous_task`、`work_not_committed`、`target_exists`、`target_missing`、`hash_mismatch`、`uncommitted_changes`、`unsafe_path`、`shim_exists` |
| 4 | 等待超时（`answers --wait`，后续） | |
| 5 | 找不到对象 | `repository_not_found`、`records_root_not_found`、`work_not_found`、`task_not_found`、`shim_target_not_found` |

## 警告

| `code` | 含义 |
|---|---|
| `registry_initialized` | 登记表原本不存在，这次按扫描结果整表导入 |
| `unregistered_ids` | 扫描到登记表里没有的号，已补登为 `imported`；说明有人绕过了 nbdev |
| `number_conflicts` | 有撞号，详见 `conflicts` |
| `prunable_worktree` | 某个已登记的 worktree 目录已不存在，跳过 |
| `uncommitted_branch_records` | 某个 worktree 只有未提交的记录改动，没有算作“来自分支” |
| `invalid_status_value` | 记录的 `status` 不在取值集合里 |
| `unreadable_record` | README 缺失或 frontmatter 无法解析 |
| `main_not_on_master` | `status` 时主工作区不在 `master`，照常读工作区 |
| `commit_via_other_commit` | 本次的文件被别的提交带走 |
| `commit_paths_mismatch` | 本次提交的路径与预期不一致 |
| `lock_release_failed` | 放锁失败 |
| `tmp_cleanup_failed` | 删除本次事务的临时目录失败 |

## 失败时留下什么

- 取锁之前或锁内校验失败（退出码 2、3、5，以及 `lock_timeout`）：不写任何记录。
- 登记表已写、落位或提交失败：号已经是 `claimed`，不会再发；已落位的文件留在主工作区，输出 `writtenPaths`。
- `.local/agent/run/tmp/` 里中断事务留下的目录不自动清理，确认没有 nbdev 在跑后可以删。
