# nbdev 文件格式

每个由 nbdev 写的文件都带 `schema`（`nbdev.*/v1`）；主版本不认识就报 `schema_unsupported`，不猜。产物、提问、答复与租约的格式在后续切片（t07、t08）补进本文。

## 记录的读法

Work 与 Task 的 README 由 Work 规则定义（`.agents/works/README.md`）。nbdev 读：

| 内容 | 来源 | `origin` |
|---|---|---|
| 标题 | 正文第一个一级标题 | |
| 状态 | frontmatter `status`；Task 取 `planned`、`active`、`done`、`shelved`，Work 取后三种 | `recorded`；没有字段为 `unset`；取值不在集合里为 `invalid`（带 `raw`） |
| Work 目标 | `## 目标` 一节的正文 | `recorded`；没有这一节时取一级标题后的第一段，为 `inferred`；都没有为 `unset` |
| 最近更新 | frontmatter `updated`（`YYYY-MM-DD`，本机本地日期） | `recorded`；没有时取最后一次碰这个 Task（或 Work）目录的提交日期，为 `commit`；都没有为 `unset` |

- 不从正文推断 Task 状态。
- nbdev 写记录时只按行改 `status` 与 `updated`，不重新序列化整个 frontmatter。
- 只读 README 与 Task 目录这一层的目录项，不递归 `artifacts/`、`evidences/`。

## 来源

`status` 输出里每个 Work 与 Task 带 `source`：

- `master`：已提交到 `master` 的记录，从主工作区读。只在主工作区工作树里、还没提交的，标 `uncommitted: true`。
- `branch`：过渡期内记录还在分支上维护的 Work，带 `branch` 与 `checkout`，从执行 worktree 的工作区读（含未提交内容）；`otherCopies` 列出其余副本。判定：某个已检出 worktree 的 `HEAD` 上，有路径同时出现在 `git diff --no-renames --diff-filter=AM master...HEAD` 与 `git diff --no-renames master HEAD` 里。分支把记录恢复成 `master` 的版本后，自动回到 `master` 来源。
- 来自分支的 Work 里，只在 `master` 上有的 Task 与登记表里 `claimed` 的 Task（经 nbdev 新建）来源为 `master`，其余为 `branch`。

## 登记表 `.local/agent/registry.json`

```json
{
    "schema": "nbdev.registry/v1",
    "works": [
        {
            "workId": "w00022-dev-panel",
            "status": "imported",
            "at": "2026-10-12T18:00:00.000Z",
            "by": null,
            "home": null,
            "tasks": [
                {"taskId": "t06-cli-core", "status": "claimed", "at": "2026-10-12T18:05:00.000Z", "by": null, "home": null}
            ]
        }
    ]
}
```

- 只记领号的事实。条目按完整 id 记，同号不同名的各占一条；按 id 排序。
- `status`：`claimed` 是经 nbdev 领的，`imported` 是扫描补登的，`abandoned` 是领了不用的；三种号都不再发。
- `by`：领号会话，t07 之前一律为 `null`。`home`：执行位置提示，由后续的 `worktree new` 写。
- 写入在锁内完成，先写同目录临时文件再改名。
- 登记表不是可重新生成的原始输出：`registry import` 只能从扫描重建 `imported` 条目，`claimed`、`abandoned`、`home`、`by` 会丢失。丢失后，同步过 `master` 的分支上经 nbdev 建的 Task 会被当成分支记录、拒绝写入。

## 锁与临时目录

都在主工作区的 `.local/agent/` 下，不入库：

```text
.local/agent/
├── registry.json            # 登记表
├── registry.json.lock/      # 写事务的锁目录（事务进行中才有）
│   └── owner.json           # 持锁者：nbdev.lock-owner/v1，token、pid、进程启动时刻、命令行、cwd
└── run/
    └── tmp/                 # 写事务的临时目录 <txid>/，以及组装中或接管下来的锁目录；用完删除
```

- 锁目录先在 `run/tmp/` 里连同 `owner.json` 组装好，再改名到位，所以锁目录一出现就带着持锁者信息。
- 持锁者是否存活按 `/proc/<pid>/stat` 的进程启动时刻判断（pid 在、且启动时刻与 `owner.json` 一致），不靠心跳：持锁者长时间等 Git 也不会被判过期。
- 持锁者已退出（或 `owner.json` 读不出）时，等待者把锁目录改名成 `run/tmp/` 里唯一的墓碑名再接管，只有改名成功、且改走的正是它看到的那个目录的一方继续；改走的若是别人刚建的活锁就原样改回去。接管时给 `lock_taken_over` 警告。
- 写登记表之前发现锁已不属于本进程（`owner.json` 的 token 不是自己的），就重新取锁、从头再算，给 `lock_reacquired` 警告；写了登记表之后才发现则报 `lock_compromised`。
- 放锁前先核对 token，锁已属于别人时什么也不动，只给 `lock_release_skipped` 警告。
- 等锁最多 30 秒，超时报 `lock_timeout`，带上持锁者的 pid、启动时间、命令行与 cwd。
- `run/tmp/` 必须与 `.agents/works/` 在同一个文件系统上（新目录靠 `rename` 原子地落位），否则报 `cross_device`。
- 中断的事务可能留下 `run/tmp/<txid>/`，不自动清理。
