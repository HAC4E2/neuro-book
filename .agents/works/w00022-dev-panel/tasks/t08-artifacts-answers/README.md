---
schema: nbook.task/v2
taskId: t08-artifacts-answers
status: done
updated: 2026-10-13
---

# 产物、提问与答复（命令行）

## 目标与范围

按 [Proposal](../../../../../docs/proposals/dev-panel.md) 第三节与 [实施计划的 t08 一节](../t03-design/plan.md#t08-产物提问与答复命令行)：发布记录与提问标记解析、挂在 Task 上的提问（没有页面的产物）、提问的四种结局、答复与确认的格式、状态现算、图片体积检查、文档类产物索引；命令 `artifact publish`、`artifact close`、`ask`、`answers`（含 `--wait`、`ack`、`record`）；`status` 输出收件箱；design-review 改用 `nbdev artifact publish`。

行为合同未变：开发工具，不改产品 Spec；工具合同写在包内文档。

## 执行位置

集成分支 `feat/w00022-dev-panel`，worktree `.worktree/w00022-dev-panel`。测试只在临时仓库里发布，不在真实仓库发布（真实仓库第一次使用 nbdev 要开发者授权）。

## 当前状态

- 2026-10-12 开工，[plan.md](plan.md) 写成后交 opus 子代理做设计审查（[报告](evidences/design-review.txt)）：0 阻断、7 重要、13 建议。20 条全部采纳，其中：
  - 答复与确认的 id 在锁内单调生成，“未确认”按集合差算；
  - close 撤回未答的题，重新打开时恢复；
  - 答复按最新一版的题校验；
  - 发布与答复不改 README 的 `updated`；
  - 写入要求 Task 来自 master；
  - 提问标记前缀改为 `data-nbdev-*`；
  - “空闲会话被 `--wait` 唤醒”由主 Agent 在主会话里验证。
- S1 到 S5 已在集成分支提交（`cdcaf2cd`..`f3257f02`，另有 `365ecaa9` 修 t07 测试留下的 sleep 残留）：
  - 提问标记解析（`data-nbdev-*`，parse5 按需导入）；
  - 读取与现算（答复按最新一版校验、未确认按集合差、provenance 带 sha256）；
  - 写入（锁内解析与生成 id、Task 须来自 master、`--force-version`）；
  - 八个命令与 `--wait`，`status` 的收件箱、产物与文档索引；
  - 包文档、根一致性测试，design-review Skill 改用 nbdev 并带过渡条款。
  
  偏差记在 [plan.md](plan.md) 的“实施中的偏差”。
- 主 Agent 复跑：
  - 包测试 135 通过（22 个文件，含 L4）；typecheck 通过；根上 175 通过；测试后没有残留进程；
  - 真实仓库只读 `status` 约 0.88 秒，现有三块评审板与报告显示为“未发布”，收件箱只有两处撞号。
- 唤醒验证（主 Agent，主会话）：在临时仓库里后台挂 `nbdev answers … --wait`，结束本轮空闲；20 秒后另一个进程代录一份答复。`--wait` 在答复写入后约 0.3 秒退出，输出带这份答复，主会话被后台任务唤醒。
- 未验证的边界：
  - Claude Code 单个后台任务能活多久；
  - 真实仓库里的第一次发布（要开发者授权）；
  - 给 t10、t11 的接口只有核心层用例。

- 实现审查（opus 子代理，[报告](evidences/impl-review.txt)）：0 阻断、3 重要、11 建议，三条重要都由审查者复现。14 条全部采纳，修正在集成分支 `892b03cf`..`cde9f5c6`（15 个提交），偏差记在 [plan.md](plan.md) 的“实现审查之后的改动”。主要改动：
  - `answers ack --through <cursor>`，只确认会话读过的答复；
  - 提问集不能关闭；
  - `--include` 在落位前校验；
  - 提交失败的残留随下一次写入补交；
  - `--wait` 先列目录再读，并能发现新建的产物。
- 主 Agent 复跑：包测试 146 通过（含 L4）；typecheck 通过；根上 175 通过；没有残留进程，也没有 pane 标签。
- 2026-10-13 开发者授权后，集成分支 `16cfb817e` 本地合入 `master`（合并提交 `7e837bd80`，没有 PR、没有 push master）；合并提交上复跑包测试 173 个、typecheck、`build:web`、根上三个测试文件 175 个、`governance:check`、`docs:check` 都通过。

## 下一步

无。已合入 `master`，标为 `done`。
