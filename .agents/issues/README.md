# Issue 草稿

本目录只承载尚未获远端 Issue 写入授权的临时草稿。只为重大或长期交付创建 GitHub Issue；Issue 创建后是公开目标、总体范围与非目标、验收、重大依赖、Task 导航和交付状态的唯一正文。

## 路径与恢复

- 草稿按 `.agents/issues/drafts/<english-kebab-slug>.md` 懒创建；路径是远端创建前的稳定恢复键，不是 Issue ID。
- Leader 开始或恢复时先检查 `drafts/`，按目标、Proposal 和 Spec 去重；聊天不承担草稿正文。
- 草稿至少包含目标、范围、非目标、验收、重大依赖或真正子 Issue、关联 Proposal/Spec、唯一 `Draft-Key: <slug>`、拟用的一个 `type:*` 和一个 `status:*`、请求的远端动作集合及开发者授权来源。
- 草稿不得创建 `actionIssueId`、本地数字 Issue ID、Task 状态或 Project 状态；未取得远端编号前不创建属于该 Issue 交付范围的 Task。
- 不值得公开长期追踪的本地治理、隔离实验和机械工作不创建 Issue 草稿，Leader直接创建 `actionIssueId: null` 的 `planned` Task。

## 迁移到 GitHub

1. Leader向开发者请求当前草稿列出的具体远端动作；授权不外推到 Project、PR、push 或其它远端动作。
2. 获授权后先查找精确 `Draft-Key: <slug>`：搜索所有状态 Issue 并按正文独立行复核，PR 不计入。0 个精确匹配才创建 Issue，并设置草稿中的一个 `type:*` 和一个 `status:*`；1 个精确匹配复用其正整数编号；多个精确匹配立即阻塞并记录编号。
3. 取得或复用编号后，Leader按当前已确定结果创建唯一完整 `status: planned` Task，写该正整数 `actionIssueId`、Agent 工作、开发者参与、任务产物、修改计划、完成门禁和 Leader 继续条件。不得预建依赖未知结果的后续 Task。
4. Leader闭合 Issue、Proposal、Spec 和 Task 链接，在 walkthrough 持久化授权来源和动作范围、Draft-Key、Issue 编号、实际标签、创建或复用结果及当前 Task，然后最后删除本地草稿；不得保留第二份状态正文。

Issue 可以有 `0..N` 个 Task；等待拆分或只作聚合导航的 Issue 可以暂时没有 Task。开始调研、设计或实现后只创建当前可执行 Task；满足其 Leader 继续条件后，下一位 Leader 根据真实结果更新路线并按需创建唯一下一 Task。只有需要独立排期、独立验收或独立交付的结果才拆子 Issue。