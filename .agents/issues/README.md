# Issue 草稿

本目录只承载尚未获远端 Issue 写入授权的临时 Issue 草稿；GitHub Issue 创建后仍是公开目标、范围、验收、子项和依赖的唯一正文。

## 路径与恢复

- 草稿按 `.agents/issues/drafts/<english-kebab-slug>.md` 懒创建；路径是远端创建前的稳定恢复键，不是 Issue ID。
- Leader 开始或恢复时先检查 `drafts/`，按目标、Proposal 和 Spec 去重；聊天不承担草稿正文。
- 草稿至少包含：目标、范围、非目标、验收、子 Issue/依赖、关联 Proposal/Spec、唯一 `Draft-Key: <slug>`、拟用的一个`type:*`和一个`status:*`、请求的远端动作集合及开发者授权来源。创建Issue、设置标签和取得编号后回写链接分别授权，一个动作不外推到其它动作。
- 草稿不得创建 `actionIssueId`、本地数字 Issue ID、Task 聚合状态或 Project 状态；未取得远端编号前不创建对应产品 Task。

## 迁移到 GitHub

1. Leader向开发者请求当前草稿所列的具体远端动作；授权不外推到Project、PR、push或其它远端动作。
2. 获授权后，Leader先查找精确`Draft-Key: <slug>`：搜索所有状态Issue并按正文独立行复核，PR不计入。0个精确匹配才创建Issue，并在正文写入唯一Draft-Key、同时设置草稿中的一个`type:*`和一个`status:*`；1个精确匹配复用其正整数编号；多个精确匹配立即阻塞并记录冲突编号，不创建或删除远端Issue。
3. 取得或复用编号后，Leader只创建`status: draft`、`issueRequired: true`且写入该`actionIssueId`的`1..N`个扁平Task；中断恢复只补同批已存在Task。开发者逐个接受目标、范围、依赖、验收和停止条件后，Leader才原地改为`planned`并记录接受来源和时间。
4. Leader闭合远端Issue、Proposal、Spec和Task双向链接，并在walkthrough持久化授权来源和动作范围、时间或稳定引用、Draft-Key、Issue编号、实际标签、创建或复用结果、Task列表及链接结果。上述记录完成后最后删除本地草稿；不得保留第二份状态正文或兼容入口。

容器 Issue 或仍待下一位 Leader 拆分的 Issue 可以没有直接 Task；可执行叶子 Issue 开始调研、设计或实现后必须有 `1..N` 个直接关联的扁平 Task。