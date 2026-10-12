# t06 实施计划：命令行核心

草案，交主 Agent 审查（编码子代理 2026-10-12 写）。范围以 [实施计划的 t06 一节](../t03-design/plan.md#t06-命令行核心包骨架写事务记录读取与领号) 为准，设计依据是 [Proposal](../../../../../docs/proposals/dev-panel.md) 的第一、二、五、十、十一节与 [领域模型](../t03-design/domain-model.md) 第三节。

## Context

- **要解决的问题**：Work 编号靠人工协调、Task 编号各分支各自往下数，已撞过号；记录 2026-10-12 起只放 `master`，但多数 Work 的记录还在分支上，没有一个入口能一起看。t06 先做命令行核心：任何 checkout 里的会话都能用 `nbdev` 领号、新建 Work 与 Task、改状态，记录直接提交到主工作区 `master`；`nbdev status` 能列出所有 Work，包括记录还在分支上的。
- **已定的决定**：Proposal 已 accepted，17 条待决全部按推荐。与本片有关的：待决问题 4 采用 `updated` 字段；待决问题 15 把包纳入 workspace-packages 矩阵（typecheck 与测试）；待决问题 16 编号规则与命令行同一次合入；待决问题 17 不改 `governance:context` 的入口地位。
- **前提**：t04 第 2 项已在集成分支提交（`bc7284ab4`，Task 号允许 t100 起三位，仍拒绝 t00、t000 与带前导零的三位）。`nbdev` 的编号格式与它一致。
- **工作方式**：集成分支 `feat/w00022-dev-panel`，worktree `.worktree/w00022-dev-panel`（Work README 的“实施”一节）。每个切片在分支上单独提交；编码子代理不 push、不合并；合入 `master` 要开发者授权。记录（本目录）只在主工作区改。
- **约束**：只支持 Linux；包不依赖 `@notnotype/neuro-book`，不导入根 `scripts/`；公开入口与它引用的核心模块只用 Node 兼容 API（根脚本测试在 Node 下导入）；包测试用 `bun test`，临时根用 `createTestTmpRoot`；新增依赖只有 `yaml` 与 `proper-lockfile`，两者根上已有，不引入新的第三方包。

## 关键设计

### `packages/dev-panel`：包骨架

```text
packages/dev-panel/
├── package.json            # @notnotype/dev-panel，private，type module，engines bun >=1.3.14
├── tsconfig.json           # 全包：types bun + node（同 nb-session）
├── tsconfig.core.json      # include src/index.ts、src/core、proper-lockfile.d.ts，exclude **/*.test.ts，types 只有 node：类型层拦住 Bun 专有 API
├── proper-lockfile.d.ts    # 照 packages/neuro-book-manager/proper-lockfile.d.ts
├── AGENTS.md  CONTEXT.md
├── docs/cli.md  docs/file-formats.md
├── src/
│   ├── index.ts            # 公开入口：只 re-export core
│   ├── cli.ts              # 命令行入口（#!/usr/bin/env bun）
│   ├── cli/                # main.ts（命令表、参数、分派）与 output.ts（--json 外壳、退出码）
│   ├── install-shim.ts
│   └── core/               # repo、git、ids、frontmatter、records、sources、scan、registry、lock、transaction、templates、operations、errors
└── tests/                  # git-fixture.ts、cli.test.ts（L3）、concurrency.test.ts（L4）、smoke.test.ts
```

`package.json` 要点：

```json
{
    "name": "@notnotype/dev-panel",
    "private": true,
    "type": "module",
    "bin": {"nbdev": "./src/cli.ts"},
    "exports": {".": "./src/index.ts"},
    "scripts": {
        "test": "bun test",
        "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.core.json",
        "install-shim": "bun src/install-shim.ts"
    },
    "dependencies": {"proper-lockfile": "4.1.2", "yaml": "^2.8.2"},
    "devDependencies": {"@notnotype/neuro-book-test-support": "workspace:*", "@types/bun": "^1.3.14", "@types/node": "^26.1.0", "typescript": "^6.0.3"}
}
```

- `proper-lockfile` 写精确的 `4.1.2`：根 `patchedDependencies` 按 `proper-lockfile@4.1.2` 打补丁，hoisted 安装只有一份，`validate-proper-lockfile-patch.ts` 的校验不受影响。
- devDependencies 的版本照抄 nb-session，`bun.lock` 不出现新的解析。
- 包内导入带 `.js` 后缀（同 nb-session）。

### `src/core/repo.ts` 与 `src/core/git.ts`：定位与 Git 调用

```ts
export type RepoContext = {mainRoot: string; callerRoot: string; callerBranch: string | null};
export type CheckoutInfo = {root: string; branch: string | null; head: string; isMain: boolean; prunable: boolean};
export function locateRepository(cwd: string): Promise<RepoContext>;
export function listCheckouts(mainRoot: string): Promise<CheckoutInfo[]>;
export function assertMainWritable(mainRoot: string): Promise<void>;
```

- 主工作区取 `git worktree list --porcelain` 的第一项，并与 `--path-format=absolute --git-common-dir` 的上级目录核对；调用者 checkout 取 `--show-toplevel`。不在 Git 仓库里报 `repository_not_found`（退出码 5）；主工作区没有 `.agents/works/` 报 `records_root_not_found`（5）。
- `assertMainWritable`：主工作区 `HEAD` 必须是 `refs/heads/master`，否则 `main_not_on_master`；`--git-path` 下有 `MERGE_HEAD`、`rebase-merge`、`rebase-apply`、`CHERRY_PICK_HEAD` 时报 `main_busy`（路径限定的提交在合并中会失败）。两者退出码都是 3。
- `git.ts` 只用异步 `execFile`，参数数组，固定 `-C <root>`；读操作一律加 `--no-optional-locks`。子进程环境去掉 `GIT_DIR`、`GIT_WORK_TREE`、`GIT_INDEX_FILE`、`GIT_COMMON_DIR`、`GIT_OBJECT_DIRECTORY`，保证提交落在主工作区自己的 index 上。
- 不能用 `execFileSync`：持锁期间 `proper-lockfile` 靠事件循环里的定时器刷新锁目录的 mtime，同步调用 Git 会让锁被判为过期。治理脚本的 `git()` 是同步的，这里不照搬。
- 失败抛 `NbdevError`（`errors.ts`：`code`、`exitCode`、`details`），Git 失败带参数、退出码与 stderr，代码只按退出码与文件是否存在分支，不看 stderr 文案。

### `src/core/ids.ts`：编号格式

```ts
export const WORK_ID_PATTERN = /^w(?!00000)[0-9]{5}-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const TASK_ID_PATTERN = /^t(?:(?!00)[0-9]{2}|[1-9][0-9]{2})-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export type ParsedId = {id: string; number: number; slug: string};
export function parseWorkId(id: string): ParsedId | null;
export function parseTaskId(id: string): ParsedId | null;
export function formatWorkId(number: number, slug: string): string;   // 23 → w00023-<slug>
export function formatTaskId(number: number, slug: string): string;   // 7 → t07-<slug>，100 → t100-<slug>
```

- 与 `scripts/ci/agent-governance-contract.ts` 的两个正则一致；一致性由根脚本测试按行为比对（见下文“根脚本一致性测试”），不比对正则源码。
- 超过 w99999、t999 报 `number_exhausted`（1）。slug 不合 kebab-case 报 `invalid_slug`（2）。

### `src/core/frontmatter.ts` 与 `src/core/records.ts`：记录读取

```ts
export type Recorded<T> =
    | {value: T; origin: "recorded"}
    | {value: T; origin: "inferred"}     // 只用于 Work 目标
    | {value: T; origin: "commit"}       // 只用于 updated 的回退
    | {value: null; origin: "unset"}
    | {value: null; origin: "invalid"; raw: unknown};
export type WorkRecord = {workId: string; readmePath: string; title: string | null; issueId: string | null;
    goal: Recorded<string>; status: Recorded<WorkStatus>; updated: Recorded<string>; taskIds: string[]};
export type TaskRecord = {workId: string; taskId: string; readmePath: string; title: string | null;
    status: Recorded<TaskStatus>; updated: Recorded<string>};
export function listWorkIds(checkoutRoot: string): Promise<string[]>;
export function readWork(checkoutRoot: string, workId: string): Promise<WorkRecord>;
export function readTask(checkoutRoot: string, workId: string, taskId: string): Promise<TaskRecord>;
```

- frontmatter 的定界与治理脚本相同（`^---\r?\n…\r?\n---`），用 `yaml` 解析。YAML 1.2 下 `updated: 2026-10-12` 解析为字符串（已核对）。
- `status`：Task 取 `planned`、`active`、`done`、`shelved`，Work 取后三种；没有字段为 `unset`，取值不在集合里为 `invalid` 并给一条 `invalid_status_value` 警告。本片不从正文推断状态（第三轮粗扫证明推断不可靠，验收场景 8 也要求没有字段时标 `unset`）。
- Work 目标：有 `## 目标` 一节取该节正文，`recorded`；没有就取一级标题后的第一段，`inferred`；都没有为 `unset`。
- `updated`：frontmatter 的 `updated`（`YYYY-MM-DD`）为 `recorded`；没有时取最后一次碰这个 Task 目录（Work 取 Work 目录）的提交时间，`commit`。每个来源 checkout 只跑一次 `git log --format=%x1e%cI --name-only <rev> -- .agents/works[/<workId>]`，按路径前缀取第一次出现；实测主工作区整段 0.05 秒。
- 只读 README 与 Task 目录这一层的目录项，永不递归 `artifacts/`、`evidences/`（w00005 的 worktree 里 `.agents` 有 10 万多个文件）。
- 写 frontmatter 只按行改：替换块内 `^status:`、`^updated:` 行，没有就插在结束的 `---` 之前，改完重新解析核对；不把整个 YAML 重新序列化，保留原有顺序、引号与注释。

### `src/core/sources.ts`：过渡期读法

```ts
export type RecordSource = {source: "master"} | {source: "branch"; branch: string | null; checkout: string};
export type WorkCopies = {workId: string; chosen: CheckoutInfo; rule: "home" | "name" | "recent"; others: CheckoutInfo[]};
export function findUnmigratedWorks(ctx: RepoContext, checkouts: CheckoutInfo[]): Promise<Map<string, CheckoutInfo[]>>;
export function chooseExecutionCheckout(workId: string, candidates: CheckoutInfo[], registry: Registry): Promise<WorkCopies>;
export function taskSource(workId: string, taskId: string, copies: WorkCopies | null, presence: TaskPresence, registry: Registry): RecordSource;
```

1. **判定没迁**（Proposal 第二节，按设计审查第 1 条改正）：对每个已检出的 linked worktree（分支或分离 HEAD），一个路径要同时出现在 `git diff --name-only --no-renames --diff-filter=AM master...<HEAD> -- .agents/works/`（分支自分出以来新增或改过）与 `git diff --name-only --no-renames master <HEAD> -- .agents/works/`（与当前 `master` 仍不同）两份结果里，才算分支上的记录改动；只取第三段符合 `WORK_ID_PATTERN` 的，按它归到 Work。只用三点 diff 会在分支按 t05 把记录恢复成 `master` 的版本之后，把 `master` 自分出以来改过的 Work 都误判成没迁。结果现算，不存标记。prunable 的 worktree 跳过并给 `prunable_worktree` 警告。某个 worktree 只有未提交的记录改动、没有已提交的差异时，不算没迁，只给 `uncommitted_branch_records` 警告。实测 10 个 worktree 一共 0.08 秒。
2. **执行 worktree**：依次按登记表 Work 条目的 `home`、目录名以 Work 编号开头且第二段不是 Task 号（`^w\d{5}-` 且不匹配 `^w\d{5}-t\d{2,3}-`）、最近改过记录的那一份（`git log -1 --format=%ct <HEAD> -- .agents/works/<workId>`）来认；同一条规则命中几份时取最近的，时间相同按 checkout 路径排序取第一个（w00001 的 5 个候选最后一次改记录是同一个提交）；其余列入 `others`，输出“另有 N 份副本”。
3. **合成**：没迁的 Work，README 从执行 worktree 读（工作区，含未提交内容）；Task 列表取执行 worktree 与 `master` 的并集。Task 在执行 worktree 里存在、且登记表里不是 `claimed` 的，来源记为 `branch`；其余（只在 `master` 上的，例如已迁的 t80、t81，以及经 `nbdev` 新建的）记为 `master`。
4. 只在某个已检出分支上、`master` 上完全没有的 Work 也列出，来源 `branch`。未检出的分支不读（只参与编号扫描）。
5. 写操作只认 `master` 来源：分支来源的记录以 `branch_maintained_record`（3）拒绝，输出分支名与 checkout 路径。
6. **“master 来源”的定义**：已提交到 `master` 的记录。只在主工作区工作树里、还没提交的记录（例如现在未跟踪的 `w00021-smart-ime-spike/`）照样列出，标 `uncommitted`，但不能经 `nbdev` 写：写操作要求 Work README 已在 `HEAD` 里（`git cat-file -e HEAD:<路径>`），否则报 `work_not_committed`（3）。否则只提交新 Task 的 README 会在干净 checkout 上留下没有 Work README 的 `master`（设计审查第 4 条）。

### `src/core/scan.ts`：编号扫描与撞号

```ts
export type IdLocation = {source: "main" | "worktree" | "ref"; checkout?: string; ref?: string; head?: string};
export type NumberScan = {works: Map<string, IdLocation[]>; tasks: Map<string, Map<string, IdLocation[]>>; registry: Registry};
export type NumberConflict = {kind: "work" | "task"; label: string; workId?: string; ids: Array<{id: string; live: boolean; locations: IdLocation[]}>; live: boolean};
export function scanNumbers(mainRoot: string, checkouts: CheckoutInfo[], registry: Registry): Promise<NumberScan>;
export function nextWorkNumber(scan: NumberScan): number;
export function nextTaskNumber(scan: NumberScan, workId: string): number;
export function findConflicts(mainRoot: string, scan: NumberScan): Promise<{conflicts: NumberConflict[]; registryOnly: string[]}>;
```

- 来源（Proposal 第五节）：
  1. 主工作区 `.agents/works/` 的目录项，含未提交、未跟踪的目录；
  2. 各 linked worktree 工作区的目录项；
  3. 全部 `refs/heads` 与 `refs/remotes`：一次 `for-each-ref` 列出，`cat-file --batch-check` 取各 ref 的 `<ref>:.agents/works` 树对象，按对象去重后每棵树跑一次 `ls-tree -r -d --name-only`，只取第一层与 `<w>/tasks/<t>` 两层。不 fetch。实测本机 113 个 ref 去重成 23 棵树，全程 0.15 秒；
  4. 登记表的全部条目（三种状态都算已用），只用来保留号段（求最大值），不作为撞号的位置来源。
- 只认合格式的目录名；Task 号按完整的 `workId` 分别计数。下一个号取最大值加一，不补空号。
- 撞号：同一序号在主工作区、worktree 或 ref 里出现两个以上不同的 id。每个 id 判 `live`（设计审查第 3 条）：出现在主工作区就是 `live`；出现在某个 worktree 或 ref 时，若它在 `merge-base(该 HEAD, master)` 的树里存在、而在已提交的 `master` 里已不存在，就是 `master` 改名或删除后留下的旧副本，这一处不算；有任何一处不是旧副本即为 `live`。一组撞号里至少两个 id 为 `live` 时，这组撞号 `live: true`。merge-base 只对参与撞号的位置现算并缓存。两种都输出，面板收件箱（t09）只列 `live` 的。
- 登记表里有、但所有扫描来源里都找不到的 id，另列为 `registryOnly`（例如领了号、目录被删的）。

### `src/core/registry.ts`：登记表

`.local/agent/registry.json`，`nbdev.registry/v1`：

```json
{
    "schema": "nbdev.registry/v1",
    "works": [
        {"workId": "w00022-dev-panel", "status": "imported", "at": "2026-10-12T18:00:00.000Z", "by": null, "home": null,
         "tasks": [{"taskId": "t06-cli-core", "status": "claimed", "at": "2026-10-12T18:05:00.000Z", "by": null, "home": null}]}
    ]
}
```

```ts
export function readRegistry(mainRoot: string): Promise<{registry: Registry; exists: boolean}>;
export function importScanned(registry: Registry, works: Map<string, string[]>, at: string): string[];   // 返回新补登的 id
export function claimWork(registry: Registry, workId: string, at: string): void;
export function claimTask(registry: Registry, workId: string, taskId: string, at: string): void;
export function writeRegistry(mainRoot: string, registry: Registry): Promise<void>; // 只在写事务内调用
```

- 只记领号的事实；标题、进度、状态一律读 README。条目按完整 id 记，同号不同名的各占一条。
- `claimed`、`imported`、`abandoned` 三种号都不再发。本片没有改成 `abandoned` 的命令，格式先留着。
- `by` 本片一律写 `null`，t07 接上会话身份后再写；`home` 由 t14 的 `worktree new` 写。
- 写入用同目录临时文件加改名，读者不会读到半个 JSON。`schema` 主版本不认识报 `schema_unsupported`（1）。
- 登记表不存在时，第一次做扫描的写事务在锁内按扫描结果整表导入，给一条 `registry_initialized` 警告；之后扫描到登记表里没有的号，补登为 `imported` 并给 `unregistered_ids` 警告（列出 id）。并发首写也只导入一次。
- 登记表不是可重新生成的原始输出：`registry import` 只能从扫描重建 `imported` 条目，`claimed`、`abandoned`、`home`、`by` 会丢失；丢失后“没迁的 Work 里 `claimed` 的 Task 算 `master` 来源”退回字面规则，同步过 `master` 的分支上经 `nbdev` 建的 Task 会被拒写。这一点写进 `.local/README.md` 与 `docs/file-formats.md`。

### `src/core/lock.ts`：锁

```ts
export type LockHolder = {pid: number; startedAt: string; command: string; cwd: string; alive: boolean};
export type RecordsLock = {assertHealthy(stage: string): Promise<void>; release(): Promise<Warning | null>};
export function acquireRecordsLock(mainRoot: string, waitMs: number): Promise<RecordsLock>;
```

- 取锁前 `mkdir -p .local/agent/run/tmp`（`.local/agent/` 不存在时，`proper-lockfile` 的 mkdir 报的是 ENOENT 而不是 ELOCKED），并比较 `.local/agent/run/tmp` 与 `.agents/works` 的 `st_dev`，不在同一个文件系统就报 `cross_device`（1）：`.local/` 属于用户区，可能被换成指向别的盘的符号链接，跨设备的 `rename` 不是原子的。
- `proper-lockfile` 锁 `.local/agent/registry.json`，`lockfilePath` 为 `.local/agent/registry.json.lock`，`realpath: false`，`stale: 10_000`，`update: 2_000`，`retries: 0`。本包自己循环重试到 30 秒（每次随机等 50 到 250 毫秒），只按错误码 `ELOCKED` 判断被占。等锁的预算要明显大于持锁者等 `index.lock` 的 10 秒加一次事务的耗时，否则持锁者一遇到 `index.lock` 被占，所有等待者都会超时。其它取锁错误报 `lock_failed`（1）。
- 持锁者信息写在 `.local/agent/run/lock-owner.json`（pid、启动时间、命令行、cwd），取锁后写、放锁前删。不能放进锁目录里：`proper-lockfile` 放锁用 `rmdir`，目录非空会失败。超时报 `lock_timeout`（1），带上这份信息与 pid 是否还活着。
- 取锁后记下锁目录的 inode 与 birthtime。`assertHealthy(stage)` 在写登记表、落位、提交之前各查一次：`onCompromised` 触发过，或锁目录已不是取到的那一个，就报 `lock_compromised`（1），不再往下做。`proper-lockfile` 接管过期锁是“判定过期、rmdir、mkdir”三步，不是原子的；设计审查在同一毫秒并发抢过期锁的实验里看到过两个持锁者，只靠 `onCompromised` 的心跳检测会晚一拍。

### `src/core/transaction.ts`：写事务

```ts
export type CommitOutcome =
    | {committed: true; sha: string; paths: string[]; viaOtherCommit: boolean}
    | {committed: false; reason: "nothing_to_commit"; paths: string[]}
    | {committed: false; reason: "git_lock_timeout" | "git_failed"; writtenPaths: string[]; detail: string};
export type TransactionOptions = {now?: () => Date; lockWaitMs?: number; gitLockWaitMs?: number};
export type WriteTx = {
    readonly now: Date;
    readonly registry: Registry;
    scan(): Promise<NumberScan>;                                                  // 同一事务内只扫一次；顺带把未登记的号补登为 imported
    claimWork(workId: string): void;                                              // 显式声明新号为 claimed
    claimTask(workId: string, taskId: string): void;
    createDirectory(targetDir: string, files: Record<string, string>): void;     // 落位时整体改名，目标必须不存在
    createFile(target: string, content: string): void;                            // 落位时独占创建（先写临时文件，再 link 到目标）
    replaceFile(target: string, content: string, expectedHash: string): void;    // 落位前重读比对哈希
    includePaths(paths: string[]): void;                                          // 调用方已写好的现有文件，一起提交
};
export function runWriteTransaction<T>(ctx: RepoContext, options: TransactionOptions & {repoWrites?: boolean},
    body: (tx: WriteTx) => Promise<{message: string | null; result: T}>): Promise<{result: T; commit: CommitOutcome; warnings: Warning[]}>;
export function resolveCommitOutcome(mainRoot: string, input: {startHead: string; paths: string[]; expectedBlobs: Map<string, string>;
    lastFailure: GitResult | null; timedOut: boolean}): Promise<CommitOutcome>;
```

- `message` 为 `null` 表示无需提交（`registry import`、状态没变），结果是 `nothing_to_commit`。`repoWrites: false` 的事务（`registry import`）不要求主工作区在 `master`，也不碰仓库。
- 错误码统一：命令行层面提交失败的错误码是 `commit_failed`，具体原因在 `CommitOutcome.reason`（`git_lock_timeout` 或 `git_failed`）。
- `lockWaitMs` 默认 30 秒，`gitLockWaitMs` 默认 10 秒；它们是库的参数，命令行不暴露，测试可以传小值，产品代码里没有测试分支。

| 步骤 | 做什么 | 失败时 |
|---|---|---|
| 1 前置 | 定位，`assertMainWritable`；建 `.local/agent/run/tmp`，查 `st_dev` | 不取锁、不写记录；`main_not_on_master`、`main_busy` 退出码 3，`cross_device` 1 |
| 2 取锁 | 见上节 | `lock_timeout`、`lock_failed`，退出码 1 |
| 3 锁内复查 | 再查一次 `master` 与合并状态；记下起始 `HEAD` | 放锁，不写；3 |
| 4 计算 | `body` 读登记表、扫描、分配编号、生成内容，只登记操作 | 放锁，原样抛出 |
| 5 校验 | 所有目标的路径护栏、`target_exists`、`hash_mismatch` 在动第一个目标之前查完 | 放锁；3 |
| 6 准备 | 在 `.local/agent/run/tmp/<txid>/` 建好新目录与新文件 | 删自己的 `<txid>` 目录，放锁；1 |
| 7 登记 | `assertHealthy`，写登记表（新号为 `claimed`，扫描补登的为 `imported`） | 放锁；1。先登记再落位，后面失败时号也不会被重发 |
| 8 落位 | `assertHealthy`；新目录整体改名到位；新文件 `link` 独占创建；改文件再比一次哈希后写临时文件改名 | 中途的 IO 失败保留已落位的文件，输出 `writtenPaths` 与 `committed: false`，1 |
| 9 提交 | `assertHealthy`；`git add -- <路径>`；`git diff --cached --quiet -- <路径>` 退出码 1 时 `git commit -m <消息> -- <路径>` | 退出码 128 在 10 秒预算内一律退避重试（不以锁文件是否存在为前提，`add` 与限定路径的 `commit` 都可以安全重放）；其它情况交给 `resolveCommitOutcome` |
| 10 判定 | `add` 或 `commit` 失败、或 `diff --cached` 为 0 时：`HEAD` 里这些路径的 blob 是否等于本次写入内容（`git hash-object`），`<起始HEAD>..HEAD` 是否有触及这些路径的提交 | 都相等且有触及的提交：`viaOtherCommit`（`committed: true`，带 `commit_via_other_commit` 警告）；都相等但没有：`nothing_to_commit`（例如把状态改回 `HEAD` 里的原值）；不相等：`committed: false`，`git_lock_timeout` 或 `git_failed`，退出码 1 |
| 11 核对 | 自己提交成功时，`git diff-tree --no-commit-id --name-only -r <sha>` 应恰好是本次路径 | 不一致给 `commit_paths_mismatch` 警告 |
| 12 放锁 | `finally` 里执行，并删掉自己的 `<txid>` 目录 | 放锁失败给 `lock_release_failed` 警告 |

第 10 步按结果判定，而不是按 Git 的退出码与锁文件判定：别的会话不带路径的提交可能发生在我们的 `diff --cached` 之后、`commit` 之前，这时我们的 `commit` 以退出码 1 失败，但文件其实已经入库；若报成 `committed: false`，Agent 会重跑 `task new`，领到第二个号（设计审查第 2 条）。

- 路径护栏：目标必须在 `<主工作区>/.agents/works/` 下；逐级 `lstat`，任何一级是符号链接就拒绝；不碰 `.git/`。临时目录不能放在 `.agents/works/` 下，`governance:check` 会把不合编号格式的目录报成错误。
- 新目录改名到位前只检查目标不存在，Linux 的 `rename` 能覆盖空目录；检查与改名之间的窗口只剩不经锁的手工建目录，编号已在锁内唯一。
- 提交消息：`docs(wNNNNN): …`（与仓库现有写法一致，用 Work 编号），不加署名行；以主工作区的 Git 身份提交。
- `run/tmp/` 里中断事务留下的目录不自动清理（Proposal 非目标“不自动清理 `.local/agent/`”），`.local/README.md` 写明可以手动删。

### `src/core/operations.ts` 与 `src/core/templates.ts`：命令行与面板共用的操作

```ts
export function createWork(ctx: RepoContext, input: {slug: string; title: string; goal: string; taskSlug: string;
    taskTitle?: string; issueNumber?: number; taskStatus?: TaskStatus}, options?: TransactionOptions): Promise<CreateResult>;
export function createTask(ctx: RepoContext, input: {workRef: string; slug: string; title: string; goal?: string;
    status?: TaskStatus}, options?: TransactionOptions): Promise<CreateResult>;
export function setRecordStatus(ctx: RepoContext, input: {workRef: string; taskRef?: string; status: string;
    includeUncommitted?: boolean; expectedHash?: string}, options?: TransactionOptions): Promise<SetStatusResult>;
export function importRegistry(ctx: RepoContext, options?: TransactionOptions): Promise<ImportResult>;
export function readProjectStatus(ctx: RepoContext, filter?: {workRef?: string; taskRef?: string}): Promise<ProjectStatus>;
// CreateResult = {workId; taskId; paths; commit: CommitOutcome; conflicts: NumberConflict[]; warnings: Warning[]}
```

- `workRef` 接受完整 id 或 `wNNNNN`，只在主工作区解析：几个同号目录报 `ambiguous_work`（3）；主工作区没有、只在分支上有报 `branch_maintained_record`（3）；哪里都没有报 `work_not_found`（5）。`taskRef` 同理（`tNN` 或完整 id）。
- `createWork`：Work 与首个 Task 一起建（Work 必须至少有一个 Task）。Work README 写 `status: active` 与 `updated`；Task 写 `status: planned`（或 `--status`）与 `updated`。`taskTitle` 缺省用 Work 标题。
- `createTask`：Work README 必须已提交（`work_not_committed`，3）；没迁的 Work 也一律写进 `master`；不改 Work README。
- `setRecordStatus`：记录必须是 `master` 来源；取值不合法报 `invalid_status`（2）；Work README 必须已提交；目标文件在主工作区有未提交改动（`git status --porcelain -uall -- <路径>` 非空）时报 `uncommitted_changes`（3）并附差异，`includeUncommitted` 才放行；取值与现值相同则 `changed: false`，不提交；否则改 `status` 与 `updated` 两行。`expectedHash` 留给面板（t10）传读取时的哈希，命令行在事务内现读现比。
- `readProjectStatus` 不取锁、不写任何文件。附带主工作区 `git status --porcelain -z -uall -- .agents/works` 的结果（`-uall` 才能把未跟踪目录拆到具体的 Task），按路径前缀给 Work 与 Task 标 `uncommitted`；主工作区不在 `master` 时照常读，给 `main_not_on_master` 警告。
- 模板：

```markdown
---
schema: nbook.work/v1
workId: w00023-<slug>
issueId: null
status: active
updated: 2026-10-12
---

# <标题>

## 目标

<--goal>
```

```markdown
---
schema: nbook.task/v2
taskId: t01-<slug>
status: planned
updated: 2026-10-12
---

# <标题>

## 目标与范围

<--goal，缺省“待补充”>

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-10-12 经 nbdev 新建，尚未开工。

## 下一步

待补充。
```

Task 模板故意不写“行为合同未变”这几个字：`docs:check` 靠它判断，占位文字会把应有的警告压掉。Work 模板不放 Task 表（`task new` 不改 Work README，表会过时），Task 列表以目录与 `nbdev status` 为准。

### `src/cli.ts` 与 `src/cli/`：命令行合同

| 命令 | 参数 | `schema` |
|---|---|---|
| `nbdev work new <slug>` | `--title`、`--goal`、`--task <slug>` 必填；`--task-title`、`--issue <n>`、`--status`（首个 Task） | `nbdev.work-new/v1` |
| `nbdev task new <workRef> <slug>` | `--title` 必填；`--goal`、`--status` | `nbdev.task-new/v1` |
| `nbdev work status <workRef> <status>` | `--include-uncommitted` | `nbdev.work-status/v1` |
| `nbdev task status <workRef> <taskRef> <status>` | `--include-uncommitted` | `nbdev.task-status/v1` |
| `nbdev registry import` | 无 | `nbdev.registry-import/v1` |
| `nbdev status` | `--work <workRef>`、`--task <taskRef>`（要求同时有 `--work`） | `nbdev.status/v1` |

- 参数用 `node:util` 的 `parseArgs`（`strict`，`allowPositionals`），不新增依赖。每个命令都接受 `--json`。
- `--json` 时 stdout 只有一个对象：`{schema, ok, data, warnings, errors}`；`warnings`、`errors` 的元素是 `{code, message, details?}`，调用方按 `code` 判断。诊断与进度走 stderr。不加 `--json` 时 stdout 打印一两行中文摘要。
- `status --json` 的 `data`：`works[]`（`workId`、`title`、`goal`、`status`、`updated`、`source`、`branch`、`checkout`、`otherCopies`、`uncommitted`、`taskCounts`、`tasks[]`，Task 同样带来源字段）、`conflicts[]`、`registryOnly[]`、`nextWorkNumber`。`--work` 时只含这个 Work；`--task` 时只含这个 Task。
- 写命令的 `data`：`workId`、`taskId`、`paths`、`commit`（`CommitOutcome`）、`conflicts`。`registry import` 的 `data`：`added`、`nextWorkNumber`、`nextTaskNumbers`（按 Work）、`conflicts`、`registryOnly`。
- 退出码（Proposal 第十一节）：

| 退出码 | 错误码 |
|---|---|
| 0 | 成功，含带警告的成功与撞号 |
| 1 | `lock_timeout`、`lock_compromised`、`git_failed`、`commit_failed`（附 `committed: false`）、`schema_unsupported`、`number_exhausted`、`internal` |
| 2 | `usage`、`invalid_slug`、`invalid_status` |
| 3 | `main_not_on_master`、`main_busy`、`branch_maintained_record`、`ambiguous_work`、`ambiguous_task`、`target_exists`、`hash_mismatch`、`uncommitted_changes`、`shim_exists` |
| 4 | 本片不用（`answers --wait` 超时，t08） |
| 5 | `repository_not_found`、`records_root_not_found`、`work_not_found`、`task_not_found`、`shim_target_not_found` |

### `src/install-shim.ts`

- `bun run --cwd packages/dev-panel install-shim [-- --bin-dir <dir>] [--target <checkout>] [--force]`。缺省写 `~/.local/bin/nbdev`，`--target` 缺省为主工作区（由脚本所在位置的 Git common dir 推出），目标里没有 `packages/dev-panel/src/cli.ts` 报 `shim_target_not_found`（5）。
- 内容三行：`#!/bin/sh`、标记注释 `# nbdev shim (installed by @notnotype/dev-panel)`、`exec "<安装时 command -v bun 的绝对路径>" "<target>/packages/dev-panel/src/cli.ts" "$@"`；权限 755。已有文件没有标记注释时报 `shim_exists`（3），`--force` 才覆盖。
- 测试只写临时 `--bin-dir`；写真实的 `~/.local/bin/nbdev` 要开发者授权（见“需要决定的点”）。

### `src/index.ts`：公开入口

只 re-export `src/core/` 的类型与函数（上面各节的签名）。`tsconfig.core.json` 只带 Node 类型检查这一部分（`include` 写目录 `src/core`，写成 `src/core/**` 会报 TS5010；排除测试文件，否则找不到 `bun:test`；带上包根的 `proper-lockfile.d.ts`），根脚本测试在 Node 下导入它，两者一起保证不混进 Bun 专有 API。`src/cli.ts`、`src/install-shim.ts` 也只用 Node API，但不承诺。

### `scripts/ci/dev-panel-records.test.ts`：根脚本一致性测试

- 在 Node 下（`bun x vitest run --config scripts/vitest.config.ts …`，已被 `scripts/ci/**/*.test.ts` 覆盖）导入 `@notnotype/dev-panel` 与 `#scripts/ci/agent-governance-contract` 的 `verifyWorkContracts`。
- 用例一：临时 Git 仓库里用 `createWork` 建 Work 与 t01；预先提交一个 `t99-seed`，再用 `createTask` 建出 t100；`verifyWorkContracts` 为空。
- 用例二：编号表 `t00 t01 t09 t10 t99 t100 t101 t999 t000 t001 t050 t1 t1000` 与 `w00000 w00001 w99999 w0001 w000001`：`parseTaskId`／`parseWorkId` 接受与否，必须与治理检查对同名目录是否报“标识格式无效”一致。
- 根 `package.json` 的 devDependencies 加 `"@notnotype/dev-panel": "workspace:*"`。

### 测试夹具 `tests/git-fixture.ts`

- `createTestTmpRoot("dev-panel", …)` 下建 `main/` 子目录作主工作区（根目录里有测试支持包的 `.nbook-tmp.json` 标记，不能当仓库根）：`git init -b master`，本地配置 user，写 `.gitignore`（`/.local/*`、`/.worktree/`），放一个种子 Work 并提交。
- 提供：加 linked worktree（`.worktree/<名>`）、在分支上提交记录、`update-ref refs/remotes/origin/<名>`、建未跟踪目录、在暂存区放改动、运行 CLI（`process.execPath src/cli.ts`，cwd 可指定）。
- 子进程环境：`GIT_CONFIG_GLOBAL=/dev/null`、`GIT_CONFIG_NOSYSTEM=1`，去掉继承来的 `GIT_*` 定位变量，避免读到开发者的全局配置。
- 每个测试 `afterEach` 删除自己的临时根。

## Spec 与文档改动

不改产品 Spec（Proposal“对 Spec 的预期改动”）。

| 文件 | 改什么 |
|---|---|
| `packages/dev-panel/AGENTS.md` | 引用 `../../AGENTS.md`；owner；验证命令；核心只用 Node API；测试用 `bun test`、`createTestTmpRoot` 与 Git 夹具的环境隔离 |
| `packages/dev-panel/CONTEXT.md` | 领域模型第三节的术语与不变量；补“运行不持有租约、提问四种结局、文档类产物”（Proposal）与本片的“登记表、写事务、来自分支、执行 worktree、撞号” |
| `packages/dev-panel/docs/cli.md` | 上面的命令表、`--json` 外壳、警告与错误码、退出码、写什么与失败时留下什么 |
| `packages/dev-panel/docs/file-formats.md` | 登记表格式；记录 frontmatter 的读法（`status`、`updated`、目标一节、`origin` 的含义）；`.local/agent/` 下锁、持锁者与 `run/tmp/` |
| `.agents/works/README.md` | “目录与身份”的 `status` 一条补 `updated: YYYY-MM-DD`（本机本地日期；`nbdev` 写入时自动更新，直接编辑记录时顺手改）；“记录只放主工作区”第三条写明没迁的 Work 新建 Task 也一律经 `nbdev` 写进 `master`；“编号分配”改为经 `nbdev` 领号；撞号一段把“分配者”改为由开发者或主 Agent 定保留项；保留小节标题，`#编号分配与记录位置` 锚点仍被三处引用 |
| `.agents/works/AGENTS.md` | 第 1 条：新编号经 `nbdev work new`、`nbdev task new` 领取；第 3 条：改状态用 `nbdev task status`、`nbdev work status`，记录还在分支上的 Work 照旧在原处改 |
| `.local/README.md` | Agent 区加 `registry.json`、`registry.json.lock/`、`run/lock-owner.json`、`run/tmp/`；改掉“只放能重新生成的原始输出”的说法：登记表例外，`nbdev registry import` 只能重建 `imported` 条目，会丢 `claimed`、`abandoned`、`home`、`by`；`run/tmp/` 的残留可以手动删 |

“编号分配”一节的新写法（草稿）：

1. 先复用符合目标的 Work。确需新编号时用 `nbdev work new`（Work 与首个 Task 一起建）或 `nbdev task new`：它在锁里扫描主工作区、登记表、全部本地与远程跟踪分支和各 worktree，取最大值加一，在主工作区建最小 README，并在 `master` 上路径限定提交。不手工挑号。
2. `nbdev` 命令不在 PATH 上时，用 `bun <主工作区>/packages/dev-panel/src/cli.ts …` 调同一入口；仍不可用才手工建号：按同样的来源取最大值加一、在主工作区建记录并提交，下次 `nbdev` 扫描会补登并给出警告。
3. 领号即占号，不要求 Issue 编号、push 或远端登记。`nbdev` 只在本机加锁，不是跨机器的编号服务。

### 要登记的位置

| 位置 | 改动 |
|---|---|
| 根 `package.json` | `workspaces` 加 `packages/dev-panel`；devDependencies 加 `@notnotype/dev-panel`；随后 `bun install` 更新 `bun.lock` |
| `packages/AGENTS.md` | 第二条的成员清单加 `dev-panel` |
| `docs/modules/monorepo-boundaries.md` | “当前布局”表加一行：开发工具 `packages/dev-panel/`，入口 `nbdev` 与（后续）面板，不进 Product、Desktop 与发布产物，根 `scripts/ci/` 的一致性测试导入其公开入口 |
| `scripts/ci/workspace-package-matrix.ts` | `WORKSPACE_PACKAGE_CHECKS` 加 `{name: "dev-panel", directory: "packages/dev-panel", commands: "bun run typecheck\nbun run test"}`（待决问题 15） |
| `.github/workflows/workspace-packages.yml` | `pull_request.paths` 加 `packages/dev-panel/**` |
| `.github/workflows/code-baseline.yml` | `pull_request.paths` 加 `packages/dev-panel/**`（`workspace-workflows.test.ts` 要求覆盖全部 packages 目录）；治理测试步骤加 `scripts/ci/dev-panel-records.test.ts` |
| `.github/workflows/product-platforms.yml` | `push.paths` 与 `pull_request.paths` 都加 `packages/dev-panel/**`（同一测试要求，且两处必须相等）；是否改测试豁免开发工具包，主 Agent 记入待确认清单 |
| 根 `AGENTS.md` | 仓库结构图加一行 `dev-panel/` |

## 切片

每片在集成分支上单独提交，只按路径暂存，提交前 `git diff --cached --check`。

| 切片 | 内容（对应上文各节） | 提交 | 自跑验证 |
|---|---|---|---|
| S1 骨架与登记 | 包骨架、`ids.ts`、`errors.ts`、`index.ts`、smoke 测试；AGENTS、CONTEXT、docs 初稿；“要登记的位置”除 code-baseline 的测试步骤外全部 | `feat(dev-panel): 新包骨架与登记（w00022 t06）` | `bun install`；`bun run --cwd packages/dev-panel test`、`typecheck`；`bun x vitest run --config scripts/vitest.config.ts scripts/ci/workspace-workflows.test.ts scripts/ci/agent-governance.test.ts`；`bun run governance:check`、`docs:check` |
| S2 只读核心 | `repo`、`git`、`frontmatter`、`records`、`sources`、`scan`、`registry` 的读、`readProjectStatus`；L1 与 L2 测试 | `feat(dev-panel): 记录读取、过渡期来源与编号扫描` | 包 `test`、`typecheck` |
| S3 写事务 | `lock`、`transaction`、登记表写与导入、`createWork`、`createTask`、`setRecordStatus`、`importRegistry`；L2 测试（临时仓库、`index.lock`、暂存区保留、撞号） | `feat(dev-panel): 写事务、领号与状态修改` | 包 `test`、`typecheck` |
| S4 命令行 | `cli.ts`、`cli/`、`install-shim.ts`；L3 命令合同测试与 L4 并发测试 | `feat(dev-panel): nbdev 命令行` | 包 `test`、`typecheck` |
| S5 一致性与规则 | `scripts/ci/dev-panel-records.test.ts` 与 code-baseline 的测试步骤；包 docs 定稿；“Spec 与文档改动”里的三份规则 | 测试一个提交，规则一个提交 `docs(governance): 编号经 nbdev 领取（w00022 t06）` | `bun x vitest run --config scripts/vitest.config.ts scripts/ci/dev-panel-records.test.ts`；`governance:check`、`docs:check` |
| S6 真实仓库 | 验收场景 8、9（见“验证”），结果由主 Agent 写进 Task README | 不提交 | 见下 |

## 验收映射

场景编号指 [实施计划 t06 一节](../t03-design/plan.md#t06-命令行核心包骨架写事务记录读取与领号) 的验收场景。

| 场景 | 覆盖 |
|---|---|
| 1 worktree 里 `work new`：所有来源的最大值加一，README 在主工作区，`master` 多一个只含两个 README 的提交 | `tests/cli.test.ts`（L3，夹具含主工作区、两个 worktree、未跟踪占号目录、只在分支上的 Work、远程跟踪 ref） |
| 2 暂存区里别人的改动留在暂存区 | `tests/cli.test.ts`；`src/core/transaction.test.ts` |
| 3 10 个进程同时 `task new`：号不同且连续，登记表合法，10 个提交 | `tests/concurrency.test.ts`（L4） |
| 4 核心库建出的 Work 与 Task（含 t100）通过 `verifyWorkContracts` | `scripts/ci/dev-panel-records.test.ts` |
| 5 主工作区不是 `master`：退出码 3，不写任何文件 | `tests/cli.test.ts`（前后比对 `git status --porcelain` 与 `.local/` 目录） |
| 6 两个同号不同名的 Work：照常发号，`conflicts[]` 列出两处 | `src/core/scan.test.ts`；`tests/cli.test.ts` |
| 7 分支上较新的 Work 标 `branch`（带分支名），只在 `master` 上的 Task 标 `master`；对前者 `task status` 退出码 3；分支按 t05 把记录恢复成 `master` 的版本后回到 `master` 来源 | `src/core/sources.test.ts`；`tests/cli.test.ts` |
| 8 真实仓库 `status --work w00017 --json` | 只读 smoke，S6 手动运行，结果写进 Task README |
| 9 真实仓库 `registry import --json`，与手工扫描一致，只写登记表 | S6 手动运行并与手工扫描对照（需要先定是否在真实仓库运行，见“需要决定的点”） |
| 10 `index.lock` 被占 15 秒：退出码 1，`committed: false`，列出已写文件 | `tests/cli.test.ts`（真实 10 秒等待，单测超时设 30 秒） |

另有：

- L1：`ids.test.ts`（格式、边界、上限）、`frontmatter.test.ts`（按行改写保留原文）。
- L2：`transaction.test.ts` 覆盖 `resolveCommitOutcome` 的三种判定（别的提交带走、改回 `HEAD` 原值、真失败），`--include-uncommitted` 把状态改回 `HEAD` 原值得到 `nothing_to_commit`，`.local/agent` 不存在，未提交的 Work 拒写（`work_not_committed`）；`scan.test.ts` 覆盖 merge-base 判 `live` 与 `registryOnly`。
- L3：`status` 不写任何文件（前后比对）。
- L4：`concurrency.test.ts` 预置过期锁目录，再并发多次 `task new`，号不重复（崩溃残留）。
- 夹具设 `GIT_CEILING_DIRECTORIES` 为临时根，`repository_not_found` 的用例不会爬到外层仓库。

## 验证

- 包内：`bun run --cwd packages/dev-panel test`（L1 到 L4，L4 只依赖 Git 与 Bun，CI 上可跑）；`bun run --cwd packages/dev-panel typecheck`。
- 根：`bun x vitest run --config scripts/vitest.config.ts scripts/ci/dev-panel-records.test.ts scripts/ci/workspace-workflows.test.ts scripts/ci/agent-governance.test.ts`；`bun run governance:check`；`bun run docs:check`。
- 真实仓库（S6，合入前在集成 worktree 里用 `bun packages/dev-panel/src/cli.ts …` 运行，命令行自己找到主工作区）：
  - 预期值在运行当时用独立的手工扫描脚本现算（放 `.local/agent/works/w00022-dev-panel/tasks/t06-cli-core/logs/`，不入库），不写死。2026-10-12 设计时的参考值：w00017 的执行 worktree 是 `.worktree/w00017-runtime-foundation`，另有 4 份副本；t80、t81 来自 `master`，其余 81 个 Task 来自分支；下一个 Work 号 w00023，w00017 下一个 Task 号 t84；撞号两处，w00003 的 t05 `live: false`，w00007 `live: true`。
  - 场景 8：`status --work w00017 --json`，与手工扫描对照来源分布；没有 `status` 的标 `unset`。
  - 场景 9：运行前确认主工作区的 `.local/agent/registry.json` 与 `.local/agent/run/` 原本不存在；`registry import --json` 的下一个号、撞号与手工扫描一致；判据是仓库工作区（`git status --porcelain`）无变化，`.local/agent` 下只多 `registry.json` 与 `run/`。核对完只删这次建出来的这几个文件与目录（合入前登记表格式还可能变）。
  - 首页量级的性能：整份 `status --json` 在本机 11 个 checkout、113 个 ref 下的耗时，目标 1 秒以内。
- 未验证边界：多台机器之间的撞号（不在范围）；会话身份（`by` 为 `null`，t07）；真实的 `~/.local/bin/nbdev` 安装（待授权）；别的会话在 `git add` 与 `git commit` 之间不加路径提交的竞争，只对 `resolveCommitOutcome` 做 L2 模拟（先 add 再由测试代替“别的会话”提交），真实并发时序未测。

## 不做与风险

- **不做**：租约与会话身份（t07）；产物、提问与答复（t08）；面板与 herdr；`worktree new`、`dev`（t14）；替别的会话迁移记录（t05）；从正文推断 Task 状态；自动清理 `.local/agent/`。
- **风险**：
  - w00017 分支也改过 `workspaces` 与 `bun.lock`，合并时会冲突；集成分支合入前要先合 `master`（主工作区的 `.agents/works/README.md` 也可能又被改过）。
  - 规则切换与可用性：新规则合入 `master` 后，没装 shim 的会话找不到 `nbdev`；规则里写了直接用 `bun <主工作区>/packages/dev-panel/src/cli.ts` 的退路，shim 最好与合入同时装。
  - 长期分支上的会话仍读旧规则、手工建号；扫描会看到并补登，但同一时刻手工建的号与 `nbdev` 发的号仍可能相同，这时以撞号报出。
  - 执行 worktree 的认法是启发式；几份副本时输出 `otherCopies`，靠人判断。
  - 锁的 `stale` 为 10 秒：持锁进程被 `SIGKILL` 后，下一个调用者可能先超时一次。
  - 根脚本测试在 Node 下导入包源码：核心里一旦用了 Bun 专有 API，typecheck 的第二步与一致性测试都会失败，这是有意的护栏。

## 需要主 Agent 或开发者决定的点

2026-10-12 主 Agent 的处理：第 1 到 8 条与第 11 条按推荐，其中第 3 条改用 merge-base 判据（设计审查第 3 条）；第 9 条 S6 在真实仓库跑一次 `status` 与 `registry import`，跑完只删这次建出来的文件；第 10 条不做，等开发者授权。

| 点 | 结论 | 性质 |
|---|---|---|
| 1. 一致性测试进 CI（`code-baseline.yml` 的治理测试步骤） | 加 | 交付配置 |
| 2. 根 `AGENTS.md` 的仓库结构图加一行 `dev-panel/` | 加 | 规则文件 |
| 3. 撞号分 `live` 两类，收件箱（t09）只列 `live` 的 | 采用，判据按 merge-base 继承 | 对 Proposal 的细化 |
| 4. 没迁的 Work 里，登记表 `claimed` 的 Task 一律算 `master` 来源 | 采用 | 对 Proposal 的细化 |
| 5. 只有未提交的分支记录改动不算“没迁”，只警告 | 采用 | 对 Proposal 的细化 |
| 6. 改状态遇到目标文件有未提交改动默认拒绝，`--include-uncommitted` 才放行 | 采用 | 行为默认值 |
| 7. 登记表不存在时第一次写事务自动整表导入 | 采用 | 低风险细节 |
| 8. Work 模板不放 Task 表，`task new` 不改 Work README | 采用 | 低风险细节 |
| 9. 在真实仓库跑 `status` 与 `registry import` | 跑一次，跑完只删这次建出来的文件 | 授权边界 |
| 10. 写 `~/.local/bin/nbdev`、真实仓库第一次用 `nbdev` 建 Work、合入 `master` | 不做，等开发者授权 | 开发者授权 |
| 11. 提交消息用 Work 编号 `docs(w00023): …` | 采用 | 低风险细节 |
| 12. `product-platforms.yml` 加路径，还是改测试豁免开发工具包 | 本片照现有测试加路径；豁免的备选由主 Agent 记入待确认清单 | 交付配置，开发者决定 |

## 与 Proposal、实施计划的不一致，以及读代码时发现的问题

1. **t04 第 2 项没有“先合入 master”**：实施计划的“前提”写它先合入；实际作为集成分支的第一个提交（`bc7284ab4`），要等整条分支合入才到 `master`。在此之前 `master` 上的 `governance:check` 仍拒绝 t100，`nbdev` 在 `master` 上也还不存在，两者同时生效，不冲突。
2. **“只在 master 上有的 Task 从 master 读”在分支同步 `master` 后会失效**：经 `nbdev` 在没迁的 Work 里新建的 Task 写在 `master`；分支之后合并 `master`（w00017 有 master-sync 的做法），这个 Task 在分支上也有了，按字面规则会被当成分支记录，`task status` 会被拒绝。计划用登记表的 `claimed` 补上这一条（决定点 4）。登记表丢失时退回字面规则。
3. **字面规则下，w00017 的 t01 到 t30 显示为“来自分支”**：它们在主线分支上自分出以来没改过，内容与 `master` 的占号副本相同。验收场景 8 要求“其余来自分支”，计划按 Work 级规则照做；按 Task 级差异判定会把它们标成 `master`，与场景 8 不符。
4. **本机现有两处撞号，性质不同**（设计审查第 3 条核实）：w00003 的 t05（`preview-retirement` 在 w00005、w00018 两个 worktree 与多个旧分支上，`master` 的提交 451f6319a 把它改名为 `component-lab`）是改名留下的旧副本；w00007（`desktop-supervisor-portable-fix` 只在 `origin/fix/windows-supervisor-bun`，不在它与 `master` 的 merge-base 里，`master` 上另建了 `workflow-message-only-invoke`）是真实的重复分配。初稿按“出现在哪里”判 `live`，两边都判错，现改为按 merge-base 继承判定（决定点 3）。
5. **“没迁”的判定会把 w00001 也标成来自分支**：w00017 主线、t80、t81 与 w00002 的分支都改过 w00001 的 8 个记录文件，没有以 w00001 命名的 worktree，执行 worktree 会按“最近改过”选。这符合规则，但面板上会多出一个意料之外的“来自分支”。
6. **已登记 worktree 不一定在 `.worktree/` 下**：写初稿时会话临时目录里有一个 `review-t79-r2/wt`（分离 HEAD），设计审查时已不在。这类 worktree 照样计入副本。
7. **`proper-lockfile` 放锁用 `rmdir`**：持锁者信息只能放在锁目录外（计划放 `run/lock-owner.json`）；它的心跳靠事件循环，持锁期间的 Git 调用必须异步。
8. **测试支持包的 `createTestTmpRoot` 会在根目录写 `.nbook-tmp.json`**：Git 夹具要在子目录里建仓库，否则这个文件会以未跟踪文件出现在每个断言里。
9. **`scripts/tsconfig.json` 的 typecheck 在没跑 `nuxt prepare` 的 worktree 里有 15 个既有错误**（`packages/neuro-book/server/utils/auth.ts`、`server/database/prisma.ts` 的 Nuxt 自动导入），与本片无关；本片的根脚本改动不依赖它。
10. **主工作区的暂存区与工作区里常有别的会话的 `.agents/works` 改动**（今天就有 w00019 的 5 处）：路径限定提交与“目标文件有未提交改动就拒绝”都不是假设出来的风险。

## 设计审查的处理

审查报告见 [`evidences/design-review.txt`](evidences/design-review.txt)（opus 子代理，1 阻断、4 重要、8 建议）。主 Agent 逐条核实后全部采纳，计划已按下表改过。

| 审查条目 | 处理 | 改在计划的哪里 |
|---|---|---|
| 1 三点 diff 判“没迁”（阻断） | 路径同时出现在 `master...HEAD`（AM）与 `master HEAD` 两份 `--no-renames` 结果里才算分支改动；只取符合 `WORK_ID_PATTERN` 的第三段；场景 7 加“恢复成 `master` 版本后回到 `master` 来源”的用例 | `sources.ts` 第 1 条；验收映射场景 7 |
| 2 提交结果的判定 | 锁内记下起始 `HEAD`；失败或 `diff --cached` 为 0 时按 blob 与 `<起始HEAD>..HEAD` 判 `viaOtherCommit`、`nothing_to_commit` 或真失败；退出码 128 在预算内一律重试 | 写事务第 9、10 步；`resolveCommitOutcome`；验收映射的 L2 |
| 3 `live` 判据与登记表 | 按 merge-base 继承判定；登记表只保留号段，另列 `registryOnly` | `scan.ts`；读代码发现第 4 条 |
| 4 未跟踪的 Work | 写操作要求 Work README 已在 `HEAD`，否则 `work_not_committed`（3）；统一“master 来源”为已提交到 `master` | `sources.ts` 第 6 条；`operations.ts` |
| 5 CI 登记 | `code-baseline.yml` 与 `product-platforms.yml`（push 与 PR 两处）加 `packages/dev-panel/**`；一致性测试进 code-baseline；豁免的备选记入待确认清单 | 要登记的位置；决定点 1、12 |
| 6 过期锁接管的竞态 | 记下锁目录的 inode 与 birthtime，写登记表、落位、提交前各比对一次；L4 测试预置过期锁 | `lock.ts`；验收映射的 L4 |
| 7 `tsconfig.core.json` | `include` 写目录，排除测试文件，带上 `proper-lockfile.d.ts` | 包骨架；公开入口 |
| 8 写事务接口 | 加 `createFile`、`includePaths`、`claimWork`、`claimTask`、`nothing_to_commit`；错误码统一为 `commit_failed` | `transaction.ts` |
| 9 锁的预算与前置条件 | 等锁 30 秒；取锁前 `mkdir -p .local/agent/run/tmp`；比较 `st_dev`，不一致报 `cross_device` | `lock.ts`；写事务第 1 步 |
| 10 执行 worktree 平局 | 时间相同按 checkout 路径排序 | `sources.ts` 第 2 条 |
| 11 S6 预期值 | 运行时用脚本现算；判据改为仓库工作区无变化、`.local/agent` 下只多 `registry.json` 与 `run/` | 验证 |
| 12 规则文字 | `.local/README.md` 写明登记表不可重新生成及重建会丢什么；Work 规则写明没迁的 Work 新建 Task 也经 `nbdev` 写进 `master`；`updated` 取本机本地日期；标未提交用 `-uall` | Spec 与文档改动；`operations.ts` |
| 13 测试缺口 | 补崩溃残留（过期锁、`.local/agent` 不存在）、第二个时间窗与改回原值、夹具设 `GIT_CEILING_DIRECTORIES` | 验收映射 |

## 实施中的偏差

2026-10-12 实施完成后对照计划，下列几处与上文不同，以代码与 `packages/dev-panel/docs/` 为准：

- 命令行只拆成 `src/cli/main.ts` 与 `src/cli/output.ts` 两个文件，没有按命令分文件；`install-shim` 另带 `--json`。
- 输出字段改名：`nextWorkId` 改为 `nextWorkNumber`（值是 `w00023` 这样的编号，没有名称），`registry import` 的 `nextTaskIds` 改为 `nextTaskNumbers`。
- 错误码在上文的表之外补了 `invalid_title`（2）、`target_missing`（3，要改或要一起提交的文件不存在）、`unsafe_path`（3）、`lock_failed`、`write_failed`（1）；警告补了 `tmp_cleanup_failed`。
- 登记表的写入函数与读取一起在 S2 提交，没有留到 S3。
- 引用解析 `matchRef` 放在 `status.ts`，写操作复用它。
- S1 的提交已经把 `code-baseline.yml` 与 `product-platforms.yml` 的路径加上（`workspace-workflows.test.ts` 要求），S5 只加 code-baseline 的测试步骤。
