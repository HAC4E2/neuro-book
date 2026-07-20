# Task 111：Workflow 正式接入 NeuroBook Agent

状态：规划中（2026-07-19 立项）。上游：Task 110（内核端口化 + demo 页 + `wf.chart` 状态图已定形）。

## 用户需求（原话要点）

1. 以状态机可视化为主，整理核心代码，把 workflow 正式接入 NeuroBook 的 agent。
2. 设计 workflow 工具；建立几个内置 workflow。
3. 存储：workflow 不放进 skill，单独建一个和 skill 同构的 `workflows` 文件夹，同样支持用户资产覆盖。
4. 前端对 workflow 工具调用做适配：一个功能强大的 workflow 展示气泡。
5. workflow 工具返回值：除了 workflow 自定义返回值，还必须返回创建的 session id、token 用量等元数据。
6. agent 能指定 workflow 使用的模型 id；用户在设置中自定义「agent 可见模型清单」（每条 = `provider-id/model-id` + 一句用途描述；通常 ≤5 条；默认 1 条 = 当前模型）。
7. workflow API 与使用指南**不要绑死在工具描述里**，写进 `reference/` 文档，工具只给文档引用（渐进式加载）。

## 验收标准（用户定）

- 拆书 workflow 可以使用。
- leader 能像 skill catalog 一样按需主动调用对应 workflow。
- 用户能主动触发 workflow。
- workflow 工具需要用户审批。
- 前端能看到 workflow 执行情况（状态图为主）。
- agent 能根据用户需求随机应变地写出 workflow，且写得好——会用 `wf.chart` 可视化 API 展示运行情况。

## 调研结论（2026-07-19）

- **Skill 存储范式**（`server/agent/skills/skill-catalog.ts`）：`SkillCatalog(systemRoot, userRoot)`，目录名 = key，用户同名目录整体覆盖系统目录，frontmatter 出 name/description/whenToUse。harness 构造处（`neuro-agent-harness.ts:555`）用 `<systemNbookRoot>/agent/skills` 与 `<userNbookRoot>/agent/skills` 双根。workflow 复刻此范式即可：`agent/workflows` 双根 + `WorkflowCatalog`。
- **Prompt 接入范式**：`profile-dsl.ts` 的 `SkillCatalog({mode})` fragment 渲染目录清单进 system prompt，agent 再用文件工具读 SKILL.md——正是用户要的「渐进式加载」。workflow 照做：`WorkflowCatalog` fragment 只列 key/描述/whenToUse + 指向 reference 文档。
- **工具契约**（`server/agent/tools/types.ts`）：`defineAgentTool` 支持 `approvalRequired: true`（用户审批）、`executeWithContext`（拿 harness/sessionId）、`onUpdate` 流式部分结果（气泡实时刷新可用）、`details: JsonValue`（结构化结果，前端气泡消费）。
- **模型链**：`modelResolver(config, profileKey, {modelKey})` 已支持 per-invocation 模型覆盖（`neuro-agent-harness.ts:2715`）；`config.models.providers` 为真相源。设置侧已有 `model-settings-draft/view` + `ModelLibraryDialog` 等组件可挂新表单。
- **前端气泡范式**：`app/components/novel-ide/agent/tool-render-registry.ts` 按工具名注册 `{mode, typeLabel, component}`；`WorkflowRunPanel.vue`（demo 页）已有状态图/时间线/卡片渲染，可下沉复用。
- **Task 110 遗留清单直接并入本任务**：waiting 穿透、面 B `run_workflow` 工具、脚本沙盒化、`harness.createAgent` 补 kind+tags、直聊互斥统一、D15 剩余、chart 事件进公共 projection DTO。
- **F9 红线**：加载用户 workflow 源码用 `require("typescript")` 转译，勿 ESM import（dev OOM）。

## 模块拆分

| 模块 | 计划文档 | 负责 | 内容 |
| --- | --- | --- | --- |
| A 核心 | [PLAN-A-core.md](PLAN-A-core.md) | 主会话（本 agent） | workflow API 定形、WorkflowCatalog 存储、`run_workflow` 工具（审批 + 返回契约 + 模型指定）、run 事件投影到工具 details、拆书内置 workflow |
| B 设置 | [PLAN-B-model-roster.md](PLAN-B-model-roster.md) | 子任务 agent | 「agent 可见模型清单」配置模型 + 设置 UI + prompt 渲染 |
| C 前端 | [PLAN-C-workflow-bubble.md](PLAN-C-workflow-bubble.md) | 子任务 agent | workflow 展示气泡（状态图为主），tool-render-registry 接入，复用 workflow-preview 组件 |
| D 文档与内置库 | [PLAN-D-reference-and-builtins.md](PLAN-D-reference-and-builtins.md) | 子任务 agent | `reference/agent/workflow/` 编写指南（含 `wf.chart` 可视化规范）、除拆书外的内置 workflow |

依赖关系：A 先行（API/DTO 定形是 B/C/D 的地基）；B 独立可并行；C 依赖 A 的 details DTO；D 依赖 A 的 API 定稿。

## 执行记录

### 2026-07-20 模块 A 实施（主会话）

按 [PLAN-A-core.md](PLAN-A-core.md) 完成，实际落地与计划的出入见文末。

**内核（sibling nb-workflow，commit 358d680，已 sync 回灌 vendor）**
- `wf.agents.create` 加 `model?: string`（进参数指纹与 SessionPort.createSession init）。
- `begin/start` 加 run 级选项 `defaultModel`（create 未显式指定时的兜底模型）与 `workspace`（per-run workspace 端口，覆盖 RunEnv 全局端口——面 B 按发起方 Project Workspace 注入）。
- `AgentInvokeOutcome` 加 `usage?: {inputTokens, outputTokens} | null`：随 journal 持久，宿主据此汇总 run 级用量。

**NeuroBook 侧新增/改动**
- `server/agent/workflow/workflow-catalog.ts`（新）：与 SkillCatalog 同构的双根 WorkflowCatalog（`agent/workflows/<key>/workflow.ts`，用户覆盖系统，目录名=稳定 key）；`require("typescript")` 转译（F9）+ 无 require 受限求值（workflow 源码禁 import）；mtime 缓存；`compileInline` 供内联脚本。挂进 harness：`harness.workflows`（`neuro-agent-harness.ts` 与 skills 同层）。
- `server/agent/harness/agent-visible-models.ts`（新）：`resolveAgentVisibleModels`（唯一真相源：配置过滤失效条目，空则兜底单条默认模型）+ `assertVisibleModel`。配置面：`EffectiveConfig.agent.visibleModels`（`server/config/types.ts` + normalizer 规范化/解析，global-only）。
- `server/agent/tools/workflow-tools.ts`（新）：`run_workflow`（approvalRequired；workflowKey/script 二选一；model 按可见清单校验；onUpdate 心跳推 runId+状态图 partial；waiting 是正常返回并告知 agent 勿重调）+ `list_workflows`。返回契约 details：`{runId, workflowKey, status, result, error, pendingAsks, sessions[{sessionId,profileKey,title,tokens}], usage, chartMermaid}`。注册进 builtin tools。
- `workflow-demo-service.ts` 提升：`startWorkflowRun`（defaultModel/workspace 透传）、`runSummary`（解析 journal 指纹汇总 session+usage）、runInfo 泛化（phase 观测不再依赖 demo 场景表）；createRealSession 回调支持 model（经 `runCommand model` 落 model_change entry）与 kind/tags。
- `HarnessAgentPort` 回传 usage；`NeuroWorkflowSessionPort` createSession 面加 model/kind/tags。
- **A8**：`harness.createAgent` 面补 `kind`/`tags` 透传（CreateAgentInput → repo.createSession）。
- 正式 API：`server/api/agent/workflow/`（catalog.get / runs.post / runs/[runId].get / runs/[runId]/resume.post）。
- Prompt 面：profile-dsl 新 fragment `WorkflowCatalog`（ctx.workflows 快照，3 个 harness prepare site + profile 预览注入；jsx-runtime、source-parser、profile-template.dto、模板编辑器登记）；`builtin.workflow.run/list` 绑定；`leader.default` 挂 fragment + 两工具。
- 内置拆书：`assets/workspace/.nbook/agent/workflows/split-book/workflow.ts`（researcher ×N 并发逐章摘要 → 合并剧情分析；全程 wf.chart；ephemeral session）。
- `reference/agent/workflow/README.md`（新）：编写参考（wf API / chart 口诀 / 确定性红线），已登记 reference/agent/README.md 索引；工具与 prompt 只留引用（渐进式加载）。
- 测试：`workflow-catalog.test.ts`（双根覆盖 / 内联编译与 require 拒绝 / bundled split-book 防语法回归）。

**验证**：`bunx vitest run server/agent/workflow`（10/10）+ profile-dsl（42 含）全绿；`bun run typecheck` 全绿。`server/config/config-service.test.ts`「删除 Provider 前扫描…」1 例失败为**既有失败**（干净树复现，与本次无关）。

**与计划的出入**
- waiting 穿透（A8 备选）按降级方案落地：`wf.ask` 挂起时 `run_workflow` 正常返回 waiting + runId，应答走 run API/气泡，不阻塞工具调用——未做「工具内等待用户」。
- 内联 script 沙盒 V1 = 无 require 白名单 + 用户审批门（PLAN 预告过，维持）；完整沙盒记后续 TODO。
- 直聊互斥统一到 harness 未做（仍是 Task 110 已知边界），记后续 TODO。
- `reference/agent/workflow/README.md` 由 A 先写核心版（原计划全归 D）；D 仍负责 chart 好坏示例扩写与其余内置 workflow。
- ctx.workflows 为可选字段（避免炸旧测试构造面），fragment 空时渲染为空。

## 后续 TODO

- [ ] B/C/D 三模块分发实施（B 设置 UI、C 气泡、D 文档扩写+内置库）。
- [ ] run 观测态仍内存（重启丢 run 不丢 session）；run-as-session 持久化。
- [ ] 完整脚本沙盒化；`run_workflow` 的 AbortSignal 取消透传。
- [ ] 直聊互斥统一到 harness 层。
- [ ] D15 剩余（systemRole 并入 kind + session 列表按 kind 隐藏）；findByTag 索引化。
- [ ] 拆书 workflow 真跑验收（真实项目 manuscript + 审批 + 气泡）——待 C 完成后浏览器走查。
