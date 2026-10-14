---
schema: nbook.task/v2
taskId: t85-master-merge
status: done
updated: 2026-10-14
---

# 合并回 master

## 目标与范围

把 w00017 集成分支合入 master：在集成 worktree 里合并、解冲突、全量验证；push master 前按仓库流程重写含本机其他账户名的历史（见 [w00022 README](../../../w00022-dev-panel/README.md) 的“实施”一节），并做一轮仓库空间清理。开发者 2026-10-13 授权 master 的历史重写与推送、空间清理；主工作区未提交的旧应用 UI 改动要保留，供新应用迁移时参考。

合同：行为合同未变。合并只解冲突，产品代码与 w00017 一致；开发者面板提案按新的提案规则补 frontmatter。

执行位置：`.worktree/w00017-t85-master-merge`，分支 `chore/w00017-t85-master-merge`（从 `master` 经 nbdev 创建）。

## 进展

- 主工作区未提交的改动（2026-09-28 至 10-02，w00019 的提示词编辑器、Lab 治理、输入框，w00021 的记录，owned-process 的改动，共 194 个路径，含已暂存的组件改目录）原样存进本地分支 `archive/legacy-ui-tuning`（`865c9f593`），逐个路径与工作区文件比对一致；不合并、不推送。没放进去的：w00022 t15 的 `plan.md`（另一个会话正在改，之后它自己提交了）与根目录的 `install.sh`（ossutil 安装脚本）。主工作区的文件与暂存区没有动。
- 合并提交 `ba09fcc97`（父提交 `35c889008`、`e4cbd1248`），9 处冲突的处理写在提交说明里：CI 照 w00017（`product-platforms.yml` 删除，`code-baseline.yml` 补 `packages/dev-panel`）；根 `package.json` 保留两边的包；`AGENTS.md`、`packages/AGENTS.md`、Monorepo 边界、提案索引用 w00017 的写法并补开发者面板；测试规范取并集；本 Work README 的 Task 行按编号合并。
- 验证（合并结果）：`bun install --frozen-lockfile` 无变化；`governance:check`、`docs:check` 0 失败；`test:affected --all --typecheck` 17 项中 14 项通过，失败 3 项是 w00017 分支原有的（在 `.worktree/w00017-runtime-foundation` 原样复现，合并没改这两个包）：llmlint 的 `typecheck` 找不到 `diff-match-patch`、`test:vitest` 找不到 `web/` 的 tsconfig，neuro-book-test-support 的 `paths.test.ts` 一例（超长临时根没有被拒绝）。
- 新应用全套 e2e（合并结果，先 `build:server`、`build:web`、`build:e2e`）：199 例中 198 例通过；`workbench-shell.e2e.ts` 的“同一客户端的两个窗口”首屏 15 秒没出来（本机内存只剩约 4 GB，记忆里记过的首屏超时），单独重跑通过，整个文件 14 例重跑全过。
- 开发者面板对新应用的冒烟：`nbdev dev start --checkout .worktree/w00017-t85-master-merge` 起新应用的 `dev` 并就绪，`nbdev shot -- -c TitleActions --vp phone` 出 4 张图、无问题，`nbdev dev stop` 有序停下；日志与截图在本地 `.local/agent/works/w00017-application-runtime-architecture/tasks/t85-master-merge/`。
- 历史重写已演练（只生成对象，不动引用）：从 `8065e1aa2` 起 138 个提交换号，13 个旧文件版本删去账户名（用词与 `ec0990171` 的清理一致），各分支末端的树与原来逐字节相同；新历史里能到达的 24380 个文件版本没有账户名。受影响的引用：`master`、`feat/w00022-dev-panel`、`archive/legacy-ui-tuning`、本 Task 分支，以及 `w00022-t15-review` 的分离 HEAD 和三处 ORIG_HEAD。w00022 记录里引用的 94 个提交号要随之更新。
- 2026-10-14 重验：w00022 在 10-14 01:51 把 t15 阶段 1 的面板代码合进了 master，第一次切换在核对处停下、什么都没改。在当时的 master 上重建合并（`c820d1660`）：新应用、内核、nb-ui 与验证过的树一致，面板改动部分重跑 `bun install --frozen-lockfile`（无变化）、`governance:check`、`docs:check`（0 失败）、仓库脚本（110 例）与 dev-panel 的类型检查和测试（374 例）全过。
- 2026-10-14 合入：`master` 快进到合并提交 `bc2081d8b`（父提交 `b9cc666ab`、`e4cbd1248`），开发者在主工作区执行 `window_a.sh`（自动模式拦下了 Agent 执行）。主工作区先移走 184 个旧应用改动（逐个核对与归档分支一致；第一次执行在暂存的新路径上缺 `-f` 停了一次，补上后从断点续跑），旧应用被忽略的 `.env`、`.nuxt`、生成文件与 `node_modules` 挪到 `packages/neuro-book-legacy/`，之后 `bun install`。主工作区只剩原地保留的 11 个改动（w00019、w00021 的记录，owned-process，`install.sh`）。
- 2026-10-14 历史重写（开发者授权；w00022 先停下并核对无进行中的 git 操作）：从 `2cca6d3fa` 起 176 个提交换号，13 个旧文件版本删去账户名，`master`、`feat/w00022-dev-panel`、`archive/legacy-ui-tuning`、本 Task 分支与三处 ORIG_HEAD 一次性按旧号核对后移动，各分支末端的树不变；删去指向旧提交的 reflog 条目约 366 条（原文留在系统临时目录的审计里），gc 后核对旧根、全部旧提交与含账户名的对象都不存在，`fsck --connectivity-only` 通过；从全部引用、reflog 与暂存区可达的 37467 个文件版本与全部提交说明里没有账户名（图片里的随机字节不算）。新旧提交号对照见 [evidences/history-rewrite-map.txt](evidences/history-rewrite-map.txt)；记录里引用的旧号 166 处（25 个文件）已换成新号。
- 空间清理第一批：删除 governance 标为“待清理”的 `.worktree/w00018-pre-nb-ui-baseline`、`.worktree/w00020-startup-exit-api-auth` 与本地分支 `chore/w00018-pre-nb-ui-baseline`、`fix/w00020-startup-exit-api-auth`（都已在 master，工作区干净）。

## 收尾（2026-10-14）

- 推送：`master` 从 `6faecf815` 快进到 `2a08d0ef8`（推送前核对旧根已不存在、远端为快进）。
- 清理第二批：删除 `.worktree/w00017-t80-settings-ui`、`w00017-t84-menu-contributions`、`w00017-t85-master-merge`、`w00017-t80-drafts`（3 个未提交的草稿文件随之丢弃，t80 已完成、决定已入记录），本地分支 `t80/settings-ui`、`t80/drafts`、`feat/w00017-t84-menu-contributions`、`chore/w00017-t85-master-merge`、`remote`（与 `origin/master` 同一提交）、`backup/w00017-before-trailer-cleanup`；再 gc 一次。`.git` 206 MB，`.worktree/` 从 12 GB 降到 9.6 GB。
- 开发者关掉编辑器与开发服务后，同日删除 `.worktree/w00017-runtime-foundation` 与本地分支 `refactor/w00017-runtime-foundation`（已在 `master`；远端同名分支保留）。保留本地分支 `archive/legacy-ui-tuning`（旧 UI 改动的参照）。
- 未做：远端分支只读核对，99 个里 10 个已合入（含 `feat/w00017-t84-menu-contributions`、`refactor/w00017-runtime-foundation`），89 个按祖先关系未合入（多为 8 月的旧分支，可能已 squash 合并）；删除远端分支要开发者另行同意。
