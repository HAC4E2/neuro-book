---
schema: nbook.task/v2
taskId: t02-toolcall-alignment
role: tasker
---

# Toolcall/Tail 功能对齐实现

## 目标

按 [施工计划](../t01-construction-plan/construction-plan.md) 实现 `media.text-to-image.llm-toolcall` 的完整合同：固定上游默认 Tool/Tail、全局与 Provider 覆盖、五类 LLM 请求、完整与 SSE 响应解析、设置 UI、独立导入导出、无网络预览和聚焦测试。

## 输入与边界

先读取所属 Work、施工计划、已应用到主工作区的 [implemented Spec](../../../../../docs/specs/media/text-to-image-llm-toolcall.md)、本 Tasker 合同、`packages/neuro-book` 及 `server` 作用域规则。实现只在 `.worktree/w00007-chatu8-toolcall-alignment` 与本 Task 允许的治理证据文件进行；不修改数据库 schema/migration，不新增 Agent tool loop，不扩展 RunningHub/video/Extra Body/Headers/翻译/NovelAI 语义，不调用真实 Provider/Model，不进行浏览器人工验收；远端同步、合并和 push 按开发者后续授权执行并记录在验证证据中。

## 执行顺序

1. 记录当前提交、worktree 状态、固定上游 commit 和默认字符串/样本指纹；确认主工作区用户改动未被带入。
2. 建立共享 DTO 与唯一默认常量，接入全局规范化和 Provider 继承/完整覆盖解析；先补合同测试。
3. 抽取共用 Tool/Tail 请求构造与 JSON/SSE 解码；保持既有 `requestLlmCompletion(): Promise<string>` 和 Tool 关闭旧行为。
4. 接线正文生图、角色设计、角色展示、角色修改、Tag 修改及管理端测试/预览；预览只返回最终非敏感 messages/tools/tool_choice，不发网络请求。
5. 扩展现有 LLM 设置组件：全局字段/消息编辑排序、恢复默认、Provider 继承/覆盖、独立上游格式导入导出；确保凭据不进入配置文件。
6. 运行施工计划第 9 节的聚焦测试、类型检查和文档检查；按 C01–I03 逐项记录证据。
7. 在本 Task 的 `walkthroughs/` 与必要的 `evidences/` 写入实际改动、命令、退出码、关键结果、未运行项、偏差和下一步；不把模拟或未授权真实调用写成通过。

## 完成标准

- 施工计划白名单内的代码、调用方、UI、测试和清理全部闭合；没有无关文件变更。
- 默认 Tool/Tail 的运行时 Unicode 内容和计划中的 SHA256 完全一致；Provider 缺省继承、完整覆盖和显式 false/空数组均有证据。
- 五类请求及预览覆盖同一有效配置；Tool 关闭不发送 tools/tool_choice/Tail；Tool 响应、重试工具名和 SSE 分片合同有测试。
- `bun run --cwd packages/neuro-book typecheck`（或仓库当前等价命令）、受影响 Vitest、`bun run docs:check` 的实际结果已记录；失败项区分基线问题与新增问题。
- Tasker 交回 Leader 前，当前 diff、测试和文档证据足以让 Leader 无需依赖聊天重建结论。
- 本地实现提交为 `0ac96723`；其 20 个功能文件与最终分支逐文件一致，实际由已包含同一实现的旧同步 merge `0e71893e` 带入，因此没有重复 cherry-pick 该提交。HAC4E2 最新 `origin/master=106f5e7b` 已合并为 `4faa1205`，并已推送到 `origin/new-text-to-picture`。

## 开发者参与点

不需要新的产品取舍。若实现发现 Spec、施工计划与现有代码存在不能由现有合同唯一解决的冲突，暂停扩大范围，报告具体路径、证据和选项；真实 Provider/Model 或浏览器人工验收需要另行授权。
