---
schema: nbook.walkthrough/v1
taskId: 00149-monorepo-workspace-consolidation
sequence: 010
role: leader
status: green-focused-with-inherited-blockers
createdAt: 2026-08-18T11:05:00Z
---

# Leader：Workflow 0.2.0 params 观测侧道

## 问题

0.2.0 的 `ActivityRecord.fingerprint` 已是 `sha256:<hex>` 摘要；应用旧观察器直接 `JSON.parse(record.fingerprint)` 会在真实运行记录上抛 `Unexpected token`。同时，canonical 参数可能包含 prompt 或正文，不能直接暴露到 RunView 与事件 API。

## 决定

- `fingerprint` 永远只保存 SHA-256 摘要。
- 内核在同一次 canonicalization 后生成可选 `params` canonical JSON 侧道；`params` 不参与 Activity identity。
- 新记录优先读取 `params`；没有 `params` 的旧记录才允许读取 inline JSON fingerprint；SHA-256 fingerprint 不可逆。
- NeuroBook `projectActivityRecord()` 移除 `params`，`projectWorkflowEvent()` 移除 `activity_started.params`；invocation result 仍只移除 usage.cost，用户自定义 result.cost 保留。
- workflow 观察器统一通过 `parseActivityParamsObject` 读取参数；Activity result 统一按 `WorkflowValue` 的 inline/ref 形状读取。

## 修改

- `packages/nb-workflow/src/fingerprint.ts`
- `packages/nb-workflow/src/runtime.ts`
- `packages/nb-workflow/src/types.ts`
- `packages/nb-workflow/src/runtime-events.ts`
- `packages/neuro-book/server/agent/workflow/workflow-demo-service.ts`
- `packages/neuro-book/server/agent/workflow/workflow-run-vm.ts`
- `packages/neuro-book/server/agent/workflow/workflow-session-port.ts`
- 应用 workflow 测试 fixture 与 bundled workflow 类型合同
- `reference/agent/workflow/README.md`、`authoring.md`

## 已验证

- `packages/nb-workflow`: `bun test` 103 pass / 0 fail；`bunx tsc --noEmit` 通过。
- `packages/neuro-book`: `bun run typecheck` 通过；workflow 聚焦集 49 pass / 0 fail；全量 `bun run test -- --retry=3` 为 3078 pass / 3 skip。
- 端到端 smoke 观察到 `fingerprint=sha256:<64 lowercase hex>`，ActivityRecord 与 `activity_started` 均含 canonical `params`。
- 公共投影回归证明 journal/event 不含 `params`，invocation usage.cost 被移除，用户自定义 result.cost 保留。
- `bun run governance:check` 通过，frozen install 通过。

## 未通过或未验收

- `packages/llmlint bun run verify` 仍有 2 个继承失败；`bun run test -- --retry=3` 复现同两项。
- `docs:build` 仍有 15 个既有 dead links。
- `test:desktop-contract` 仍有 4 个因根路径解析旧于 `packages/neuro-book` 迁移的 ENOENT。
- Windows portable release 要求 clean checkout；当前迁移 worktree 按计划保持 dirty，未执行强行清理。
- 用户已选择“批准并继续”：允许承认已发生的 `0fdec90bac0456b67045185c99cb8b829e75bd6c` 计划外源仓提交，并仅使用其等价内容作为迁移输入；不允许新的原仓写操作。
- 原仓 T02 immutability gate 不宣称 clean-green，作为用户批准的计划外例外保留；主仓 merge/checkpoint 尚未执行，待本轮收敛。
