# Issue 草稿

本目录只承载尚未获远端 Issue 写入授权的临时 Issue 草稿；GitHub Issue 创建后仍是公开目标、范围、验收、子项和依赖的唯一正文。

## 路径与恢复

- 草稿按 `.agents/issues/drafts/<english-kebab-slug>.md` 懒创建；路径是远端创建前的稳定恢复键，不是 Issue ID。
- Leader 开始或恢复时先检查 `drafts/`，按目标、Proposal 和 Spec 去重；聊天不承担草稿正文。
- 草稿至少包含：目标、范围、非目标、验收、子 Issue/依赖、关联 Proposal/Spec、远端创建授权请求及开发者来源。
- 草稿不得创建 `actionIssueId`、本地数字 Issue ID、Task 聚合状态或 Project 状态；未取得远端编号前不创建对应产品 Task。

## 迁移到 GitHub

1. Leader向开发者请求当前草稿的远端 Issue 写入授权；该授权不外推到 Project、PR、push 或其它远端动作。
2. 获授权后，Leader用草稿内容创建 GitHub Issue，并在正文加入唯一 `Draft-Key: <slug>`，便于中断后只读定位。
3. GitHub返回正整数编号后，Leader创建`1..N`个扁平draft/planned Task，并在创建时把该编号写入每个Task的`actionIssueId`；中断恢复时只更新已存在但尚未闭合链接的同一批Task。
4. 确认远端Issue、Proposal、Spec和Task链接闭合后，删除本地草稿；Leader walkthrough记录草稿路径、Issue编号和迁移结果。不得保留第二份状态正文或兼容入口。

容器 Issue 或仍待下一位 Leader 拆分的 Issue 可以没有直接 Task；可执行叶子 Issue 开始调研、设计或实现后必须有 `1..N` 个直接关联的扁平 Task。