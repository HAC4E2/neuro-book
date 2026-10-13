---
schema: nbook.work/v1
workId: w00023-workflow-message-only-invoke
issueId: null
---

# Workflow message-only invoke 修复

修复 Workflow Agent 扩展把未提供的 invocation input 归一化为 JSON null，导致无 PayloadSchema profile 的 message-only 调用被 NeuroBook Harness 拒绝的问题；保持显式结构化 input 与显式 JSON null 继续受 PayloadSchema 校验。

## 编号

原编号 `w00007-workflow-message-only-invoke`，与远程分支 `fix/windows-supervisor-bun` 上的 `w00007-desktop-supervisor-portable-fix` 撞号。2026-10-13 开发者定由工作量小的这一个改号，改为 `w00023`；Task 局部序号不变。历史提交与本 Work 的 walkthrough 里仍写旧编号。
