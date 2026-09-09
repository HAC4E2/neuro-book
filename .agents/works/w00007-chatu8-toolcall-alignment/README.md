---
schema: nbook.work/v1
workId: w00007-chatu8-toolcall-alignment
issueId: null
---

# chatu-8 Toolcall 与默认设置对齐

开发者已授权将固定版本 `damoshen123/st-chatu8` 的新版 Toolcall/Tail 生图预设能力完整落地到 NeuroBook 文生图 LLM 链路，并将上游默认设置加入 NeuroBook 默认配置。实现边界、默认文本指纹、调用方覆盖、验收矩阵和停止线由 [施工计划](tasks/t01-construction-plan/construction-plan.md) 定义。

当前实现入口：[t02-toolcall-alignment](tasks/t02-toolcall-alignment/README.md)，role 为 Tasker；规划 provenance：[t01-construction-plan](tasks/t01-construction-plan/README.md)。

本 Work 不绑定远端 Issue；依据是本会话开发者直接批准的目标与范围。代码改动使用 `.worktree/w00007-chatu8-toolcall-alignment` 隔离，主工作区既有修改不纳入本 Work。本次已按授权完成 HAC4E2 master 同步、冲突合并和 `new-text-to-picture` push；真实 Provider/Model、浏览器人工验收、PR、发布和部署仍未执行。

目标 Spec：[media/text-to-image-llm-toolcall.md](../../../docs/specs/media/text-to-image-llm-toolcall.md)。实现提交 `0ac96723` 已应用到主工作区，Spec 已切换为 `implemented`；旧同步 merge 已结案为 `0e71893e`，HAC4E2 最新 `origin/master=106f5e7b` 已合并为 `4faa1205`，并已推送到 `origin/new-text-to-picture`。真实 Provider、浏览器人工验收、PR、发布和部署仍未执行。
