# Profile Compiled Artifacts

本文是 Agent profile `.compiled/` 运行真相源的稳定契约。

## Layout

```text
.compiled/
  artifacts/
    <sha>.mjs
    <sha>.types.d.ts
  manifest.json
  .publish.lock
```

- `<sha>` 是编译输出字节的 sha256，不是源码输入哈希。
- artifact 是内容寻址不可变文件；同一 sha 正常只写一次。若 user asset sync 发现目标 sha 文件内容损坏，会先删除损坏文件，再从 system staging 重新安装。
- `manifest.json` 是当前指针，发布时通过同目录临时文件原子 rename 替换。
- `.publish.lock` 是 per-root advisory lock，发布前必须持有，依赖 `proper-lockfile` 直接依赖。

## Manifest

磁盘格式是 profileKey 映射：

```json
{
  "compilerVersion": 6,
  "generatedAt": "2026-06-30T00:00:00.000Z",
  "profilesRoot": "workspace/.nbook/agent/profiles",
  "profiles": {
    "writer": {
      "status": "loaded",
      "fileName": "builtin/writer.profile.tsx",
      "profileKey": "writer",
      "sourceSha256": "...",
      "sourceBytes": 123,
      "dependencyHash": "...",
      "artifactSha": "...",
      "artifactBytes": 456,
      "typeSha": "...",
      "typeBytes": 789,
      "dependencies": []
    },
    "broken.profile": {
      "status": "compile_failed",
      "fileName": "broken.profile.tsx",
      "profileKey": "broken.profile",
      "sourceSha256": "...",
      "sourceBytes": 12,
      "issues": [
        {"code": "compile_failed", "message": "compiled profile 没有默认导出有效 profile"}
      ]
    }
  }
}
```

Runtime reader 会规范化为：

- `entries`：包含 `loaded` 和 `compile_failed`。
- `profiles`：仅包含可指向 artifact 的 loaded entry。

## Status Rules

- `loaded`：manifest 有 loaded entry，artifact sha/bytes 匹配，源码在发布时一致，import 成功。
- `compile_failed`：最近一次构建失败；runtime 不回退旧 artifact。
- `compile_stale`：源码或 artifact/type artifact 校验失配；runtime 不继续使用旧 artifact。依赖变化由 watcher 触发重编，不由 reader 每次 rehash 判定。
- `not_compiled`：源码存在但没有 manifest entry。
- `compiled_load_failed`：artifact 存在但 import 失败。

`AgentProfileCatalog.get()` 只有 `loaded` 可返回 profile；其它状态必须抛错。

## Publishing

- 编译输出先进入 staging，再经 `ProfileReleasePublisher` 发布。
- CLI/preflight 使用 `disk_only` Publisher。
- HTTP runtime 挂 `ProfileBuildCoordinator`；保存/创建/删除/外部编辑 enqueue，500ms 单窗口去抖；worker 只返回 staging release，server 主线程用 `in_process` Publisher 发布并翻转 `ProfileRegistry`。前端 user-assets sync 也属于 HTTP runtime release，必须在返回前用同一个 in-process Publisher 翻转 system/user roots 的 Registry。
- `ProfileReleasePublisher` 对同一 profile root 使用进程内发布队列；磁盘 manifest 发布和 Registry 翻转必须按同一 root 串行完成。
- 磁盘 manifest 已提交但 Registry 翻转失败时，Publisher 抛 committed error；调用方不能再回滚与 manifest 匹配的 source，只能把请求作为强一致失败返回并等待下一次 release/refresh 修复内存态。
- single compile worker 只返回单条 entry staging；`ProfileReleasePublisher` 必须在 per-root publish lock 内读取当前 manifest 后合并 entry，不能发布 worker 预合并的旧 manifest。
- `compileAll()` 由主线程列出 user profile 源文件，向 worker 池并行派发单文件 entry 编译；主线程收集结果后 fan-in 成一份 manifest，一次性发布。发布前必须统一经过 `assertProfileFullReleaseFresh()`，重新校验 source file set 和每个 entry 的 `sourceSha256/sourceBytes`；新增、删除、重命名、同名源码内容变化都会让本轮 full build 标记 stale，不能发布旧 full manifest。
- 任何 full replacement 入口，包括 `compileProfileArtifacts()` 和旧 worker runtime，都必须在发布前校验 source file set + entry source hash/bytes；这个契约不能只存在于 HTTP worker service 主路径。
- profile assets sync 必须一次同步只发布一个 batch patch release；Publisher 在 publish lock 内把本次 entries 合并到当前 manifest，不能用同步开始时的旧 full manifest 覆盖并发发布。workspace sync 只准备 staging，不得锁外删除或覆盖真实 `.compiled/artifacts/**`。
- 发布前会重校验源码 sha/bytes；若源码在编译期间再次变化，本轮结果标记 `stale` 并丢弃，由 Coordinator 重新入队。
- staging cleanup 失败只写 warn，不改变编译或发布主结果。
- 启动时 `bootSweep()` 非阻塞扫描 user profile，把 not_compiled/stale/failed profile 入队自愈。

## GC

GC 在 publish lock 内、manifest 写入之后执行，只清理 `.compiled/artifacts/` 中不被 current manifest 引用的 artifact/type artifact。

优先级：**最小安全年龄地板 > 硬字节预算 > orphan grace**。

- **current manifest 引用的 sha 永不删除。**
- **最小安全年龄地板**（`PROFILE_COMPILED_ARTIFACT_GC_MIN_AGE_MS`，10 分钟）：预算回收不得删除年龄小于该值的 orphan，即使仍然超预算。它保护的是**在途读者**——进程 A 已读到 manifest v1 并准备 import 其中的 artifact 时，进程 B 发布 v2；没有这条地板 A 会拿到 ENOENT 变成 `compiled_load_failed`。因此 512 MiB 不是绝对硬上限，短时间内高频发布可以短暂超预算，`overBudgetBytes > 0` 会被 warn 出来。
- **硬字节预算**（`PROFILE_COMPILED_ORPHAN_BUDGET_BYTES`，512 MiB/root）：orphan 总字节超预算时，从**最久未被引用**的开始回收，此时突破 7 天 grace。
- **orphan grace**（`PROFILE_COMPILED_ARTIFACT_GC_GRACE_MS`，7 天）：超过 grace 的未引用 sha 无条件回收。
- **mtime 语义 = 最后一次仍被 current 引用的时间。** `installImmutableArtifact` 幂等复用已存在 artifact 时不刷新 mtime，所以 GC 会对 keep 集合内每个文件 `utimes(now)`。没有这一步，一个被连续引用很久的 artifact 会带着很旧的 mtime，刚脱离 current 就成为最优先驱逐对象——正好是最可能马上被重新引用的那一个。
- **退化状态守卫**：`manifest.profiles` 为空（没有任何 loaded entry，例如宿主依赖临时缺失导致全量编译失败）时，可达集合为空、全部 artifact 都会成为驱逐对象。此时**跳过预算回收**，只保留 grace 行为，并以 warn 上报 `skippedDegenerate`。
- GC 返回 `ProfileArtifactGcReport`（current/orphan/deleted/failed/protected/overBudget 字节与最大 artifact），由发布路径按 `agent.profileArtifact.gc` 上报；命中退化守卫或仍超预算时升为 warn。
- 单个 artifact 删除失败（Windows 文件占用等）只累计 `failedFiles`，不影响 release 主结果。
- staging 位于 profile root **同级** `.staging/`，不在 `.compiled/` 下；`.publish.lock` 是目录且不匹配扩展名过滤，两者都不会被 GC 误伤。

## Sync

Profile assets sync 不直接写 `manifest.json`。它把 system artifact copy 到 staging，经 Publisher 发布 user manifest。

非 force 情况下，用户源码已手改时不会同步 compiled artifact；force 覆盖源码后才同步系统 artifact。

user-assets sync 的发布点是不可回滚边界：磁盘 release 一旦提交，后续 Registry 失败、sync state 写入失败或 backup cleanup 失败都不能回滚 user profile source，否则会让 manifest 指向不存在的 source hash。

## Tests

- profile/workspace 测试不得直接写真实 `workspace/.nbook` user-assets。需要覆盖 user/system assets 时，使用隔离 root context 或 `server/workspace-files/test-workspace-fixture`。
- Test Workspace Fixture 默认共享 vitest `globalSetup` 建立的 **run 级只读 system assets snapshot**（`<root>/assets` 是指向 snapshot 的 junction）。snapshot 是对已发布 release 的纯投影：源码 + manifest + manifest 当前引用的 artifact，排除 orphan、`.staging` 和 runtime import cache；它**不做编译**，系统 assets 的编译由 `bun run dev` / `system-assets:prepare` 负责。
- **会修改 system assets 的测试必须显式声明 `systemAssets: "isolated"`**，拿到一份可写副本。默认共享模式下写 system assets 会污染整个 run。
- `<root>/assets/workspace/.nbook` 这个**物理相对路径必须始终存在**：profile 编译按 cwd 相对记录依赖路径（`normalizeArtifactPath`），user-assets sync 又按 `assets/workspace/.nbook/agent/profiles` 这个字符串标签把 system entry rehome 成 user entry。把 system root 挪到 cwd 之外会让依赖标签退化成临时目录绝对路径，rehome 随之失配。
- 每个 fixture root 写 `.nbook-fixture.json` owner marker（schema/createdAt/pid/runId/purpose）。`globalSetup` 启动时保守回收残留：必须是真实目录、marker schema 一致、超过 24 小时、owner PID 不活跃，任何一步无法证明安全一律保留并报告。
- fixture root 下含指向仓库本体的 junction，清理必须先 `lstat` 判定 reparse point 再 `rm(recursive)`（`fs.rm` 对 symlink/junction 只解链接、不进入目标）。**绝不能直接对 root 递归删除。**
- 隔离 root context 必须支持嵌套恢复；内层 fixture 结束时恢复外层 context，不能直接清空全局测试 root。
- 并行测试必须能独立运行；禁止用备份/恢复真实 `.compiled` 目录作为长期隔离方案。
