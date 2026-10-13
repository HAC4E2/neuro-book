---
schema: nbook.task/v2
taskId: t10-panel-writes
status: active
updated: 2026-10-13
---

# 面板写入：答复、新建与编辑

## 目标与范围

按 [Proposal](../../../../../docs/proposals/dev-panel.md) 第二、三、八节与 [实施计划的 t10 一节](../t03-design/plan.md#t10-面板写入答复新建与编辑)，开发者在面板上能做的写操作：

- 在产物页答复提问；
- 新建 Work 与 Task；
- 切换 Task 与 Work 的状态；
- 编辑记录与文档。

全部经与命令行同一套写事务入库。待决问题 8 按推荐处理：要改的文件已有别人未提交的改动时，默认拒绝并给出差异，开发者明确选择后才连同这些改动一起提交。

本片只在回环上开放写操作，并要求 CSRF 令牌；按设备分级在 t13，通知在 t11。

行为合同未变：开发工具，不改产品 Spec；工具合同写在包内文档。

## 执行位置

集成分支 `feat/w00022-dev-panel`，worktree `.worktree/w00022-dev-panel`。

## 当前状态

- 2026-10-13 开工。编码子代理写 [plan.md](plan.md)，交 opus 子代理做设计审查（[报告](evidences/design-review.txt)）：0 阻断、5 重要、13 建议，主 Agent 定为全部采纳。重要的五条：
  - 写接口要放在登录检查之后，CSRF 令牌不登录也能拿到；
  - Bun 默认 10 秒空闲超时会在等锁时切断请求，写入却照样发生；
  - `classifyDoc` 不能当编辑白名单；
  - “落位后再查 `git status`”的判据不成立，改为提交前重读文件、比对哈希；
  - README 编辑要在锁内校验 frontmatter，不许经编辑改 `status`。
- 页内答复（原 S4）推迟，这一片只做侧栏表单；记入 [待确认清单](../../pending-confirmations.md)。
- 2026-10-13 实施完成（集成分支 `16cfb817..d734dd21`，已 push）：S1 核心、S2 写接口、S3 前端、S5 文档与 L4，S4 没做。各片的提交、浏览器验收 17 项与偏离处理意见的 7 处见 [plan.md](plan.md) 的“实施进度”；与 Proposal 的出入见同文件“不一致”第 9 到 14 条。
- 主 Agent 复跑：包测试 199 个（含两条 L4）、typecheck（含 `vue-tsc`）、`build:web`、根上三个测试文件 177 个、`governance:check`、`docs:check` 都通过；没有残留进程，herdr 只剩 `default`。
- 主 Agent 看截图发现一处：暗色模式下“未提交改动”对话框的底是半透明的，后面编辑器的字透出来，叠在说明文字上（本地 `shots/t10-edit-uncommitted-1440-dark.png`），交实现审查一并看。
- 验收只在临时仓库上做，没有在真实仓库上用面板写入。
- 未验证：`commit_included_foreign_changes` 只用 git 垫片验证过；只验了 Chrome；关标签页时的 `beforeunload` 提示没在有界面的浏览器里看；两个标签页同时编辑同一个文件只有 L3 覆盖。

## 下一步

交 opus 子代理做实现审查（不阻塞），同时开始 t11。
