# 开发流程与角色治理提案

状态：draft

## 问题

NeuroBook 已有根 `AGENTS.md`、PM / Leader / Tasker / Reviewer 角色合同、Proposal、Spec、Task、walkthrough、evidence、GitHub Issue / Project 和 `governance:check`。这些资产分别约束了授权、产品合同、任务执行、角色交接和结构检查，但还没有形成一套从需求输入到合并决策的统一开发流程。

当前主要问题有五类：

1. 根 `AGENTS.md` 同时承载开发入口、仓库导航、角色规则、Git 操作、发布载荷和用户文案细则。开发步骤被参考信息打断，默认读者也没有明确建模为能够承担全部职责的全能 Agent。
2. 通用 Agent Skills 提供需求分析、规格、任务拆分、增量实现、测试和代码审查等工作法，但项目只完成了按任务类型选择 Skill 的适配，尚未把完整生命周期、角色权限和文件交接连成一个项目流程。
3. 严格模式下，PM、Leader、Tasker 和 Reviewer 可以通过文件合同协作，但缺少表示多 Task 依赖、并行阶段、人类门禁和 Reviewer 返工循环的 Initiative 模型。
4. Proposal、Spec 和 Task 各有自己的状态，但没有稳定的结构化关联来判断一次角色交接是否具备前置条件。Proposal 状态仍写在正文中，Task v1 的 `actionIssueId` 也不能表达直接来自当前人类会话的授权。
5. `governance:check` 能检查仓库治理结构，却不能验证 PM → Leader、Leader → Tasker、Tasker → Reviewer 等交接，也不能在多个 Leader session 并发读取同一 Initiative 时拒绝基于过期状态的推进。

本提案只讨论开发治理，不改变 NeuroBook 产品运行时的 Agent、Skill、Workflow、Project Workspace 或用户数据协议。

## 目标与非目标

### 目标

1. 将根 `AGENTS.md` 重构为完整开发流程入口，默认把读者视为能够依次承担 PM、Leader、Tasker 和 Reviewer 职责的全能 Agent。
2. 建立敏捷模式和严格模式。两种模式使用同一套项目合同和证据，不产生两套 Proposal、Spec、Task 或完成定义。
3. 将通用 Agent Skills 的需求分析、规格、拆分、实现、测试和审查方法映射到 NeuroBook 的角色、真相源和授权边界。
4. 增加用于原始输入分流的 Intake，以及用于多 Task 依赖和阶段门禁的 Initiative。
5. 让非平凡开发能够跨 session 追踪目标、授权、依赖、实现、验证、审查、阻塞和交接；小改动继续由 Git diff、commit 和 PR 追踪。
6. 将 Proposal 状态和新 Task 合同迁入结构化 frontmatter，避免正文文本成为机器状态真相源。
7. 保留 `governance:check` 作为只读全量治理入口，并增加带 revision 的角色交接命令，拒绝不满足前置条件或基于过期状态的推进。
8. 保持角色职责互斥：严格模式中的角色不能执行其他角色负责的工作；敏捷模式中的全能 Agent 也必须按相同顺序和门禁完成逻辑角色切换。

### 非目标

- 不改变 NeuroBook 产品功能、数据、网络接口、数据库 schema、运行时 Skill 或用户 Workspace。
- 不把通用 Agent Skills 的默认 `SPEC-*`、`tasks/plan.md`、`tasks/todo.md` 或缺失的 `definition-of-done.md` 引入项目。
- 不要求所有任务执行完整的需求访谈、Proposal、Spec、Initiative、浏览器验收或发布流程。
- 不为小改动强制创建 Task；是否属于小改动由敏捷模式的全能 Agent 结合范围和风险判断。
- 不通过本提案授权远端写入、合并、发布、部署、数据库迁移、真实 Provider/Model、浏览器人工验收或数据删除。
- 不在首期实现角色级工具沙箱。严格模式的角色隔离由角色合同和交接门禁约束，不能物理阻止 Agent 调用宿主已暴露的工具。
- 不批量改写历史 Task、walkthrough 或已归档 Proposal。

## 当前行为与证据

### 现有真相源

- 根 `AGENTS.md` 与 `.omp/RULES.md`：仓库级授权、范围、安全、验证和报告边界。
- `docs/proposals/`：需要人类评审的长期方案；`accepted` 只授权后续 Spec 和实现 Task。
- `docs/specs/`：`planned` 目标合同与 `implemented` 当前合同的唯一真相源。
- GitHub Issue / Project：公开问题、实现授权、优先级、迭代和交付状态。
- `.agents/tasks/`：一次实现的执行合同、上下文、过程报告和正式证据。
- `.agents/roles/`：PM、Leader、Tasker、Reviewer 的职责和停止条件。
- `.agents/skills/agent-workflow-router/`：按任务类型选择最小充分 Agent Skills 路由。
- `governance:check`：治理资产、Task owner、迁移、monorepo 边界和 Agent Skills 适配结构检查。

### 已有角色边界

- PM 将人类目标转换为可决策计划，不实现代码。
- Leader 将已批准目标拆成 Task，组织 Tasker、请求 Reviewer 并准备合并决策。
- Tasker 只实现已批准 Task，不管理 Issue、PR、合并或发布。
- Reviewer 独立判断合同和证据是否满足，不修改被审查代码。

这些合同已经构成严格模式的基础，但没有统一的 session 入口，也没有 Initiative、原子交接或敏捷模式的全能 Agent 说明。

### 现有状态模型的缺口

- Proposal 使用正文 `状态：draft|reviewing|accepted|rejected|superseded`，缺少统一 frontmatter schema。
- Spec 已有稳定的 `nbook.spec/v1`、`capability`、`owners` 和 `planned|implemented`，不需要为了开发进度重做 Spec 模型。
- Task v1 有执行状态和 `agentWorkflow`，但 `actionIssueId` 不能统一表示 Issue、人类会话或 Proposal 授权，也没有结构化审查模式和并发 revision。
- 没有对象负责多个 Task 的依赖图、并行 Phase、人类阶段门禁和跨 Task 集成状态。

## 方案、备选方案和取舍

### 方案 A：统一生命周期、双执行模式和结构化交接（建议）

建立一套项目生命周期，由敏捷模式的全能 Agent或严格模式的四个角色执行。新增 Intake、Initiative、Proposal v1、Task v2、`agent-role` Skill 和 `governance:handoff`；保留现有 Spec、Task evidence 和 `governance:check`。

收益：

- 敏捷与严格模式共享一套合同，不需要重复记账。
- Leader 可以表达多 Task 的并行、依赖、人类门禁和 Reviewer 返工。
- 角色交接可以由机器检查 Proposal、Spec、授权、依赖、Task context、验证画像和 revision。
- 全能 Agent 仍能在单一 session 内走完流程，不被强制拆成四个 session。

代价：

- 增加 Intake 和 Initiative 两类开发治理对象。
- Proposal、Task、角色合同和治理脚本需要一次 clean cutover。
- Markdown 状态的原子 compare-and-swap 需要明确写入和失败恢复协议。
- 文档契约和门禁只能在交接时发现越权，不能代替工具级权限隔离。

### 方案 B：只重写根 AGENTS.md

只在根入口介绍完整流程和两种模式，不增加 schema、Initiative 或交接命令。

收益是改动小，能够改善 Agent 首次读取体验。缺点是严格模式仍无法稳定表达依赖图和并发交接，规则继续依赖 Agent 自觉，多个 session 之间也无法判断状态是否过期。

### 方案 C：所有开发都采用严格角色流水线

任何改动都必须由 PM、Leader、Tasker、Reviewer 四个独立 session 依次处理。

这种方式边界最清楚，但会让文档修正、局部 Bug 和小型重构承担不成比例的交接成本，也不符合用户需要的敏捷全职模式。不采用。

### 方案 D：只依赖通用 Agent Skills 生命周期

直接使用 `interview-me → spec-driven-development → planning-and-task-breakdown → incremental-implementation → test-driven-development → code-review-and-quality`，沿用通用 Skill 的默认文件和完成定义。

这种方式会创建第二套 Spec、计划、Task 和 DoD，并绕开项目现有 Proposal、Spec、Issue/Project、Task、角色和授权边界。不采用。

## 目标开发流程

### 固定生命周期

项目开发按以下逻辑顺序推进：

1. **输入收集**：保存灵感、反馈、Bug 报告或其他来源，区分原始输入、已验证事实和推断。
2. **需求分析与建模**：明确用户目标、非目标、术语、假设、影响和需要决策的取舍。
3. **决策与合同**：需要长期方案时评审 Proposal；行为变化进入同一 capability 的 `planned` Spec；既有 Bug 和内部重构按当前合同确定执行边界。
4. **交付拆分**：单一非平凡改动创建 Task；多个 Task、依赖、并行工作或阶段门禁创建 Initiative DAG。
5. **实现与验证**：Tasker 在每个增量内执行复现或 RED、最小实现、focused 验证和证据记录，不把测试推迟到全部实现结束后。
6. **代码审查**：Reviewer 或敏捷模式的全能 Agent核对合同、diff、测试、失败、安全、性能和证据；高风险任务必须使用独立 Reviewer session。
7. **集成与合并决策**：Leader 汇总 Task、依赖、审查和剩余风险；人类明确授权后由 Leader执行合并和清理。
8. **发布**：只有获得独立发布授权后才进入现有发布流程。

这些是逻辑阶段，不要求每项工作都创建全部文档。Proposal、Spec 和 Initiative 由请求类型、长期影响和依赖结构触发。

### Agent Skills 映射

| 阶段或任务类型 | Agent Skills 工作法 | 项目产物 |
|---|---|---|
| 输入不清或需要访谈 | `interview-me`、`idea-refine` | Intake、决策问题、必要时 Proposal |
| 术语和能力边界 | `domain-modeling`、`spec-driven-development` | Proposal、同一 capability 的 Spec |
| Bug、失败或回归 | `debugging-and-error-recovery`、`test-driven-development` | 复现、Task、回归证据 |
| 任务拆分和依赖 | `planning-and-task-breakdown` | Initiative DAG、Task 和 context；不创建 `tasks/plan.md` 或 `tasks/todo.md` |
| 多文件实现 | `incremental-implementation` | Tasker walkthrough、代码和 focused evidence |
| 测试和运行时验证 | `test-driven-development` 及按表面追加的浏览器、性能或安全 Skill | required / notRun、命令结果和 evidence |
| 审查 | `code-review-and-quality`，必要时追加安全、性能或简化 Skill | Reviewer verdict 或全能 Agent 总报告中的审查段 |
| 合并与发布 | `git-workflow-and-versioning`、`shipping-and-launch` | PR、合并决策、发布证据；均受人类授权 |

Agent Skills 只提供工作法。项目的授权、状态、文件落点、完成门槛和角色边界继续由本仓库合同决定。
## 批量输入与 PM 分流

一次 PM session 可以收到一份包含多个事项的批量输入，例如 `local://paste-1.md`。批量输入必须先作为一个 Intake 保存，再由确定性预处理和一次批量语义分析生成候选项；不能按原始编号直接创建多个实现 Task，也不能把整份输入的一个整体状态当作所有事项的状态。

### 计数与去重

批量输入的计数必须区分三层，避免 selection-set 和覆盖率基线混淆：

1. `rawItemCount`：按来源文档的结构化条目计数，不合并、不丢弃原文。`local://paste-1.md` 当前基线为 `48` 条原始编号项，分段计数为 `7 + 8 + 3 + 5 + 20 + 5 = 48`。
2. `deduplicatedCandidateCount`：只合并有相同可观察目标、验收边界和来源证据的精确重复项；每个合并项保留全部来源指针，canonical 摘要必须覆盖全部来源项约束（例如 WorldEngine 合并项同时保留“可选”与“默认关闭”）。按当前批量输入，只有“WorldEngine 非强制 / 默认关闭”是明确精确重复组；World Engine Dialog 与全部 Dialog Window 当前判为 `related`，判定依据是后者显式把 diff 窗口纳入验收而前者未提及；该判定及置信度必须记录在 relations 中，若人类复核推翻该判定，示例基线相应变为 `46` 并同步修订本节与验收场景。当前示例去重基线为 `47` 个候选项。
3. `clusterCount`：按主题、依赖或可能的 Initiative 聚类的数量。聚类不是去重；一个 cluster 可以包含多个独立候选项，selection set 默认选择候选项而不是无条件选择整个 cluster。`clusterCount` 必须由本次 PM 产物实际记录，不能用预设常数代替。

PM 必须在 Intake 中同时记录 `rawItemCount`、`deduplicatedCandidateCount`、每个原始来源项到 canonical candidate 的映射、每个 `duplicate-of` / `related-to` 关系和每个候选的覆盖状态。覆盖状态不是独立的候选状态字段，由来源映射完整性推导：所有原始来源项都有归属即视为全覆盖。未能证明两个事项的可观察目标和验收边界相同，只能标记为 `related-to`，不能为了减少数量而合并。已有 Issue 或 Task 的关联也不是原始输入去重；它们使用独立关系类型。

### 候选项合同

一个 Intake 持有候选项数组。每个候选项至少需要：

```yaml
id: candidate-001
source:
  items:
    - uri: local://paste-1.md
      startLine: 5
      endLine: 5
      sha256: sha256:<source-or-span-hash>
kind: bug
summary: Workflow 待处理入口在无待处理项时仍显示
status: observed
cluster: agent-workflow-ui
markers: []
relations: []
```
`status` 只表示 canonical candidate 的生命周期，至少需要区分 `observed`、`triaged`、`needs-decision`、`deferred`、`promoted`、`closed` 和 `blocked`；`duplicate`、`related`、`selected` 不属于生命周期状态。`markers` 承载确定性预处理识别的低优先级 / 存疑标记。`relations` 表示与其他候选或已有 Issue / Task / Proposal 的正交关系，只容纳带目标的关系类型，每条必须记录 `kind`、目标类型、目标 ID、依据和置信度；没有既有对象匹配的候选保持空 `relations`，“新建档”是匹配结论而不是关系。`duplicate-of` 用于候选域内部去重指向；`duplicate` / `related` / `follow-up` / `supersedes` / `blocked-by` 指向已有对象。source span 的哈希域是条目起止行之间规范化文本的 SHA-256，算法与域必须显式记录。selection set 是候选与人类授权选择之间的唯一关系真相源；候选本身不保存单值 selection set 字段，因此同一候选可以被多个先后或并行的不可变 selection set 引用。原始来源项必须映射到一个 canonical candidate；精确重复来源通过 `duplicate-of` 关系或来源映射表达，不能创建第二个带 `status: duplicate` 的候选。Intake 的汇总状态由 canonical candidate 状态和未决选择推导，不能用单一 `promoted` 覆盖仍待决或已延期的候选。
### Selection set 与批量授权

PM 的分析结果不等于实现授权。人类选择后生成不可变 `selectionSet`，至少记录：

```yaml
selectionSetId: paste-1-selection-001
intakeId: paste-1
intakeRevision: 7
analysisRevision: 3
candidateIds:
  - candidate-001
  - candidate-014
candidateSetFingerprint: sha256:<sorted-canonical-candidate-id-json>
presentationHash: sha256:<sanitized-presentation-hash>
authorization:
  actor: <authenticated-human-session-id>
  confirmationEventId: <unforgeable-confirmation-event-id>
decision:
  kind: user-selection
  recordedAt: 2026-08-22T00:00:00Z
  scope:
    allowedWorkKinds:
      - bugfix
      - feature
    sideEffectClass: repo-local
  expiresAt: 2026-09-05T00:00:00Z
  revocable: true
  summary: 批准 Alpha 阻断组，World Engine 默认关闭仍需产品决策
```

`candidateIds` 必须按稳定 ID 排序；`candidateSetFingerprint` 是对排序后的 canonical JSON candidate ID 数组计算的 SHA-256，用于证明选择集成员没有被替换；它只是完整性证明，不是授权证明——授权效力来自 `authorization` 中不可伪造的人类确认事件。`intakeRevision` 必须等于 selection set 创建时的 Intake revision；`analysisRevision` 标识生成候选分析产物的版本，防止候选 ID 不变但摘要被重新分析后旧授权被静默沿用。`presentationHash` 绑定人类实际看到的脱敏呈现物。`scope` 限定允许的工作类型、目标与副作用等级，超出 scope 的下游动作必须重新取得人类确认。selection set 是唯一的候选选择关系来源，候选可以被多个 selection set 引用；不同 selection set 仍必须分别记录人类决策、用途和下游授权。

selection set 具有生命周期 `confirmed → handed-off | revoked | expired`：交接成功置为 `handed-off`；对已 `handed-off` 的 selection set 重复发起交接收敛为幂等 no-op 并返回首次结果，不登记新范围。候选项或其来源映射变更时必须递增 Intake revision；revision 失效只阻止新的交接与候选 claim，不追溯撤销已经创建的 Task，历史 selection set 记录保留供审计且不可改写。没有任何有效 selection set 引用的候选不得进入 PM → Leader 批量交接；未被当前 selection set 选择的候选继续保持自己的生命周期状态，例如 `triaged`、`deferred`、`needs-decision` 或 `closed`，不能把“未选中”复制成另一个候选状态。needs-decision 的解除走 PM → Human 决策请求，由人类在新一轮 PM session 中重新选择并生成新 selection set。
### 批量 PM → Leader 交接

```bash
bun run governance:handoff \
  --from pm \
  --to leader \
  --intake=<intake-id> \
  --selection-set=<selection-set-id> \
  --intake-revision=<n> \
  --candidate-set-fingerprint=<sha256> \
  --expected-revision=<n>      # 调用方最后读取的 Intake revision
```

该交接只登记已批准候选和 Leader 的待拆分范围，不直接创建实现 Task，也不修改任何候选的生命周期状态。handoff 必须逐个校验 `candidateIds` 的当前 `status` 属于允许交接集合（`triaged`，或附有人类决策记录的 `needs-decision`）；命中 `closed`、`blocked`、`deferred` 或 `promoted` 时整体拒绝并列出违规候选。handoff 还必须重新读取并校验 selection set 的 `intakeRevision`、`analysisRevision`、当前 Intake revision、`candidateSetFingerprint`、按排序 candidate ID 重算的 fingerprint、`authorization` 人类确认事件、scope 匹配、生命周期状态和不可变记录；`--expected-revision` 是调用方最后读取的 Intake revision，提交时必须等于当前 Intake revision 且等于 selection set 的 `intakeRevision`，三者任一不等即拒绝。任一校验失败或批量登记部分失败时，整个操作保持原状态并返回可恢复错误。选中候选的下游引用字段（脱敏摘要、source span/hash、kind、cluster、risk、决策点）必须齐全；摘要不足以让 Leader 直接撰写 Task 上下文时按 PM 返工处理。

Leader 后续以候选为粒度执行原子 claim：唯一约束是 `intakeId + candidateId + workKind`。claim 前必须解析候选 relations 指向的已有对象：`duplicate-of` / `duplicate` 解析到既有 Task 或 Issue 时必须复用或挂接该对象，不得创建第二个平行 Task；`related-to` 不自动抑制新工作；`follow-up` 显式允许创建后续工作。同一候选再次出现在新 selection set 中时，相同 `workKind` 返回既有 claim 及其 Task，不同 `workKind` 需要新的明确授权，不得静默扩大范围。候选认领、Task / Phase 登记和 Initiative 引用在同一个受控操作中完成；`observed|triaged → promoted` 只能由成功的 claim 写入。实现必须提供持久化 intent journal 或单一 claim 台账作为提交点，使崩溃后的重试按台账收敛：既不重复创建 Task，也不留下孤儿 Task 或没有 Task 的 `promoted` 候选。

这份批量协议以 `local://paste-1.md` 作为验收基线：原始条目计数必须为 `48`，精确去重后的 canonical candidate 计数当前判定为 `47`（依据见“计数与去重”：Dialog 对因 diff 窗口验收差异判为 `related`），所有 `48` 个原始来源项都必须映射到 canonical candidate 或明确的 `duplicate-of` 来源关系，所有 canonical candidate 都必须有独立生命周期状态，未被有效 selection set 引用的候选不得生成实现 Task。语义 cluster 数量不作为固定验收常数，但必须写入分析产物并可从候选 cluster 字段重算。


### 既有对象关系

PM 必须先用确定性路径、Issue 编号、Task 路径、代码路径和已有元数据匹配，再使用模型提出语义关系建议。关系字段与生命周期字段正交，候选关系至少区分：

- `duplicate-of`：当前候选或来源项与另一个 canonical candidate 的可观察目标和验收边界相同；
- `related-to`：共享主题或依赖，但验收边界不同；
- `duplicate`：与已有对象的可观察目标和验收边界相同；
- `related`：与已有对象共享主题或依赖，但验收边界不同；
- `follow-up`：已有对象完成后的后续事项；
- `supersedes`：明确替代已有方案或合同；
- `blocked-by`：实现前依赖已有对象。

关系必须记录目标类型、目标 ID、匹配依据和置信度；伞形对象（如双子项 Issue）的部分对应必须在匹配依据中记录子项范围，禁止整体 `duplicate`。目标对象缺少可比对的验收边界元数据（例如正文为空的 Issue）时，禁止 `duplicate` / `supersedes` 判定，降级为 `related` 并置 `needs-decision`。关系目标包含已拍板的安全或数据取舍时，相关候选强制 `needs-decision`，不得随批量选择默认推进。模型提出的 `duplicate`、`supersedes` 或 `blocked-by` 不能直接改变远端或历史对象，需由 PM 或人类确认。明确 URL、Issue 编号或 Task 路径可以由工具确定提取；Task 路径解析依次尝试根级与包级 `.agents/tasks/`，历史 `docs/tasks/` 链接按迁移索引回退；URL 默认只做本地解析，不发起网络抓取。选中候选实现后对关联 Issue 的评论回链、标签和关闭属于远端写入，需要人类明确授权，不在 handoff 或 claim 中隐式发生。

### PM 批量运行顺序

对批量输入，工具和模型按以下顺序运行，结果持久化后供后续 session 复用：

1. **确定性预处理**：读取来源并按以下规则切分条目、保留章节和行号：
   - 行首有序列表编号开始新条目，容忍缺句点变体（如 `18 （低优先级）`）；
   - 代码围栏（三反引号）内的行和 `>` 引用行永不作为条目起点；
   - 其余行并入当前条目，章节标题只决定归属，编号序列连续性不作为信号；
   - 无法解析为条目的行必须产生告警，不允许静默丢弃。
   同时计算 span hash（条目起止行之间规范化文本的 SHA-256）、提取 Issue / Task / URL / 代码路径（Task 路径搜索根包括根级与包级 `.agents/tasks/`，历史 `docs/tasks/` 链接按迁移索引回退）、识别低优先级标记（`（低优先级）`、`（低优先级，存疑）` 与行内 `优先级不高`，写入候选 `markers` 字段）；不调用模型。
2. **一次批量语义分析**：对整批候选提出标准化摘要、类型、cluster、关系、风险、优先级和需要人类决定的事项。来源内容必须作为不可信 data 与指令分隔注入，模型不得遵循来源文本中的指令，输出只是未经授权的建议；错误栈等重证据先做确定性截断和脱敏，完整原文保留在受控存储。输出结构化候选建议，不写仓库代码、Issue、Task 或远端对象。
3. **确定性校验**：逐候选校验 schema、ID、source span、hash、关系目标、计数、重复关系和覆盖率。结构性失败由确定性工具自动修复；语义失败只携带失败候选定点重试，最多两轮后转人类处理；不重新从头分析整份输入。步骤 1 的切分、哈希和提取结果持久化复用，修复轮次不重跑预处理。
4. **人类批量选择**：PM 按候选或 cluster 呈现建议；人类可以一次选择一组进行后续设计，也可以逐项选择、延期、关闭或要求补充分析。
5. **只对已选择且仍有歧义的集合继续调用模型**：一次有效的 selection set 最多触发一组批量补充调用，生成 Proposal 方向、Spec 方向与候选聚类建议；Initiative 和 Task 的技术拆分由 Leader 在交接后产出，PM 不做技术拆分。未选择项不生成实现计划。
6. **批量交接**：只有已确认的 immutable selection set 才能从 PM 交给 Leader；Leader 再为选中候选创建或复用 Initiative、Phase 和 Task。

模型调用必须遵守“工具先、模型后”：切分、哈希、结构校验、明确对象匹配、幂等校验和交接状态检查使用确定性工具；模型只做语义归一化和建议。候选分析结果带 source revision / hash、`analysisRevision` 和输入 fingerprint，可在同一输入未变化时复用，避免 PM、Leader、Tasker 和 Reviewer 重复解析完整原文。下游 context 只引用选中候选的脱敏摘要、source span/hash 和必要 evidence，不复制整份批量输入；PM 摘要必须自足——Leader 仅凭摘要加引用字段即可撰写 Task 上下文，需要额外原文才能决策时按 PM 返工。批量输入设字节预算，超长证据外置为受控引用；`local://paste-1.md` 规模单次调用可行，更大输入的切块与跨块合并协议留给实现 Task 定义。

### 原始输入和敏感证据

批量输入可能包含错误栈、文件路径、项目名、会话内容或其他敏感信息。原文只能放在受控临时根或明确授权的私密存储，并记录 data owner、用途、允许的访问者和保留期限；撤销或到期后下游读取 fail-closed。进入 Git、Issue、walkthrough、evidence 或下游 context 前，必须先经过确定性脱敏并满足字段级 allowlist：公开载荷不得包含原始错误栈、源码绝对路径、项目或会话标识、URL query/fragment、私密线程标识或秘密；每次脱敏产出 redaction manifest（规则版本、命中字段、审查者和脱敏后内容 hash），任一未确认脱敏的内容一律拒绝写入。`codex://` 线程与 Issue URL 等外部引用默认只解析不抓取；确需网络获取时必须有人类授权、host allowlist，且禁止凭据、query 和 fragment 泄露。不得因为需要复现就把未脱敏原文复制到 Git、远端 Issue 或多个下游 Task；读取受控原文必须按最小必要范围并记录访问边界。



## 两种执行模式

### 敏捷模式：全能 Agent

用户直接开启普通 Code Agent session 时，根 `AGENTS.md` 默认把该 Agent视为全能 Agent。它可以在一个 session 中依次承担 PM、Leader、Tasker 和 Reviewer 的逻辑职责，并完成非平凡任务的端到端开发。

敏捷模式遵守以下边界：

- 角色职责按生命周期依次切换，不能因为是同一 Agent 就跳过需求、合同、验证或审查。
- 非平凡任务使用 Task、walkthrough 和 evidence；多 Task 或有依赖图时使用 Initiative。
- 敏捷模式只写一份追加式全能 Agent 总报告，按实际阶段记录分析、拆分、实现、验证、审查和交接，不伪造四个独立 session。
- Task v2 结构化记录审查模式。数据、安全、隐私、公开接口、安装、发布或跨模块合同等高风险变化必须另开独立 Reviewer session；普通低风险任务允许同一 Agent自审。
- 全能 Agent判断为小改动时，可以不创建治理 Task，只由 Git diff、commit 和 PR 追踪。根规则因此应表述为“非平凡开发必须形成治理文档记录”，不再宣称所有改动都有过程文档。
- 合并、发布、部署和其他受限动作仍需要人类明确授权。

### 严格模式：单角色 Session

严格模式由用户显式调用一个新的 `agent-role` Skill，并提供 `pm|leader|tasker|reviewer` 和目标 Intake、Initiative 或 Task。Skill 在当前 session 中加载对应角色合同和最小上下文，并要求该 session 只执行本角色职责。

建议固定交接关系：

```text
PM → Leader
PM → Human           # 请求产品、优先级或风险决策
Leader → Tasker
Tasker → Reviewer
Reviewer → Leader
Leader → Tasker       # 返工
Leader → Human        # 请求产品、风险或合并决策
Human → Leader        # 授权继续或执行合并
Human → PM            # 提供决策，生成新一轮 selection set
```

严格模式角色合同是行为约束，不是宿主工具沙箱。首期治理可以在交接时拒绝缺失产物、非法状态和越权结果，但不能保证 Agent 从未调用过宿主已暴露的其他工具。

## 角色职责

### PM

PM 负责输入、需求分析、建模、分流和决策准备：

- 保存 Intake，核对仓库事实和当前 Spec；
- 分类 feedback、bug、feature、refactor、docs、release 或 migration；
- 起草 Proposal、行为合同和决策简报；
- 判断输入进入 Proposal、Issue、Task 还是关闭；
- 可以自主接受 PM 判断为低风险的 Proposal：仅限 `kind: behavior` 中不涉及产品行为变化、数据、接口、权限、用户资产、隐私、外部共享、安装、发布、迁移或不可逆承诺的澄清类方案；`kind: governance` 与 `kind: architecture` 一律必须人类确认。自主接受必须记录判断依据和影响分析；治理命令只检查记录存在，不能证明该语义判断正确，且自主接受不构成实现授权（见“安全与授权”）。

PM 不实现代码，不做技术 Task 拆分，不代替人类接受产品风险或不可逆承诺。

### Leader

Leader 负责交付拆分、协调和集成：

- 从已批准输入、Proposal、Spec 或 Issue 建立 Initiative 和 Task；
- 定义 Initiative Phase、依赖、并行关系、human gate 和 reviewer gate；
- 生成 Task context、Agent Skills 路由和验证画像；
- 协调多个 Tasker，处理阻塞和 Reviewer 返工；
- 在 Reviewer 证据闭合后，将相关 `planned` Spec 晋升为 `implemented`；
- 准备合并决策，并在人类明确授权后执行 merge、同步和 worktree 清理。

Leader 不替 Tasker实现业务代码，也不把产品取舍伪装成技术细节。多个 Leader session 可以读取和推进同一 Initiative，不记录固定 Leader owner；每次有状态交接必须使用 revision 检测过期上下文。

### Tasker

Tasker 只实现 Leader 派发的 Task：

- 读取 Task、context、Spec、Initiative Phase 和 `agentWorkflow`；
- 建立复现或 RED，再完成最小实现和 required 验证；
- 写 Tasker walkthrough 和 evidence；
- 合同、范围、数据、安全或环境前提不成立时停止并报告。

Tasker 不修改 Initiative DAG、Issue、Project、PR、合并或发布状态，不自行扩大批准范围。

### Reviewer

Reviewer 独立核对合同、diff、测试和证据：

- 检查目标、非目标、Spec、Task、实际改动和 required / notRun；
- 区分通过、失败、未验证、环境阻塞和观察项；
- 输出建议合并、需要修复、未完成验证或无法判断；
- 将结论交回 Leader。

Reviewer 不修改被审查代码，不替 Tasker修复，也不直接晋升 Spec 或执行合并。

## 进度与真相源模型

### Intake

新增 Intake 作为需要保存和分流的原始开发输入。建议落点为 `.agents/intake/<intake-id>.md`；精确 schema、ID 和包级 owner 规则在本 Proposal 接受后由 Task 设计并提交审查。

Intake 至少需要表达：

- 输入身份、来源和记录时间；
- 原始目标或报告；
- 已验证事实、推断和缺失信息；
- 类型和影响；
- 批量输入时的 `rawItemCount`、`deduplicatedCandidateCount`、来源项到候选的映射、关系与聚类信息；
- PM 分流结论；
- 后续 Proposal、Issue、Initiative 或 Task 引用。

建议生命周期为 `captured → triaged → promoted|closed`。Intake 不定义产品行为，也不是所有小改动的前置文件。

### Selection set

Selection set 是批量分流中承载人类选择授权的不可变对象，建议落点为 `.agents/intake/<intake-id>/selections/<selection-set-id>.md`。它绑定 `intakeRevision`、`analysisRevision`、排序 candidateIds、`candidateSetFingerprint`、脱敏呈现物 hash 和认证人类确认事件，是候选选择关系的唯一真相源。生命周期为 `confirmed → handed-off | revoked | expired`，记录一旦写入不可修改；失效语义与幂等行为见“Selection set 与批量授权”。精确 schema 与包级 owner 规则在本 Proposal 接受后由 Task 设计并提交审查。

### Proposal v1

Proposal 的机器状态迁入 YAML frontmatter。目标 schema 至少包含稳定 ID、`kind`、`status` 和时间；精确字段待本 Proposal 审查后确定。

`kind` 至少区分：

- `behavior`：产品可观察行为或长期能力，accepted 后必须关联同一 capability 的 `planned` Spec；
- `architecture`：内部架构和难以逆转的边界决策；
- `governance`：开发流程、角色、仓库规则和治理命令，不为此伪造产品 Spec。

迁移后 frontmatter 是唯一机器状态真相源；正文不继续双写 `状态：...`。历史和活跃 Proposal 的迁移范围、无 frontmatter 时的失败语义和归档规则需要由实现 Task 明确。Proposal v1 的状态变更由单一写者（人类会话或按角色合同的 PM）串行执行并在 frontmatter 记录时间与操作者，不参与 `governance:handoff` 的 compare-and-swap。

本文件在提案获准前继续使用当前有效的正文 `状态：draft`，不以自身提前启用待批准 schema。

### Spec

继续使用现有 `nbook.spec/v1`。Spec 只记录稳定行为、架构或术语合同，不承载开发阶段、Task 状态或 Initiative 进度。

- 新功能或长期行为变化：accepted behavior Proposal → `planned` Spec → 实现和证据闭合 → Leader 晋升为 `implemented`。
- 既有 Bug：以 `implemented` Spec 为目标；缺少唯一预期行为时先补合同或回到 Proposal。
- 纯内部重构：记录行为基线和“行为合同未变”依据，不伪造 Spec 状态变化。

### Initiative

新增 Initiative 表达多 Task 依赖和阶段门禁。建议落点为 `.agents/initiatives/<initiative-id>/README.md`。只有存在多个 Task、并行或顺序依赖、人类阶段门禁或跨模块协调时才创建。

Initiative 至少需要表达：

- 稳定 ID、状态和 revision；
- 关联 Intake、Proposal、Issue 和 capability；
- Phase ID、状态、`dependsOn`、负责人角色或 human gate；
- Phase 关联 Task；
- 阻塞原因和完成条件。

固定角色交接与 Initiative Phase 是两个维度：角色交接使用稳定协议；Phase A/B/C/D 由每个 Initiative 自定义，可以表示实现、集成、人类审查或代理审查。

例如：

```text
Phase A ─┐
         ├→ Phase C: human gate → Phase D: reviewer gate
Phase B ─┘
```

建议 Initiative 生命周期为 `planned → active → blocked|completed|abandoned`，Phase 生命周期为 `pending → ready → in-progress → blocked|completed`。最终枚举和转换表仍待审查。

### Task v2

新建和重新打开的非平凡 Task 迁入 `nbook.task/v2`；历史 v1 保持可读，不批量迁移。Task v2 目标是统一授权、审查、并发和 Initiative 关联，不复制 Issue、Spec 或 Initiative 正文。

目标字段包括：

- 稳定 Task ID、状态和 revision；
- 可选 Initiative / Phase 引用；
- capability 引用；
- 从批量分流派生时的结构化 lineage：`intakeId`、`selectionSetId`、`candidateId`、`workKind` 和 claim 引用；该组合在仓库内唯一，用于候选 → Task 追溯与幂等校验；
- 结构化 `authorization`，统一表达 Issue、当前人类会话、Proposal 或其他批准来源；
- 结构化 `review.mode: self|independent` 和受控 `review.reasons`；
- 现有 `agentWorkflow` 路由和 required / notRun；
- worktree、branch、时间和 context 身份。

`actionIssueId` 不与 `authorization.reference` 长期双写。历史 v1 重新打开时如何 clean cutover 到 v2、状态是否加入 `changes-requested|reviewed`、高风险 reason 枚举和总报告引用格式仍待审查。

### Walkthrough 与 Evidence

- 严格模式继续由 PM、Leader、Tasker 和 Reviewer 写各自追加式 walkthrough。
- 敏捷模式对一个 Task 写一份追加式全能 Agent 总报告，按真实阶段记录逻辑角色切换。
- 高风险敏捷 Task 额外写独立 Reviewer walkthrough。
- evidence 继续保存脱敏后的命令结果、日志、截图、JSON 和正式产物，不保存运行态或秘密。
- 当前状态只存在于 Proposal、Spec、Initiative 或 Task 自己的结构化字段；walkthrough 是历史，不成为第二个状态真相源。

## 治理命令

### `governance:check`

保留 `bun run governance:check` 作为类似 typecheck 的只读治理入口。它聚合治理类检查，但不运行或替代 typecheck、测试、build、browser、真实 Provider 或发布验证。

新增检查方向：

- Intake、Proposal v1、Initiative 和 Task v2 的 schema 与唯一 ID；
- Proposal kind、状态、决策记录和 capability / Spec 关系；
- Initiative DAG 无环、依赖引用存在、Phase 和 Task 状态组合合法；
- Task 授权、review、agentWorkflow、context、walkthrough 和 evidence 引用；
- selection set 的 revision / fingerprint 绑定、认证授权字段和生命周期状态一致性；
- Task lineage 组合唯一性以及候选 claim 与既有对象复用的一致性；
- 高风险独立审查是否存在单独 Reviewer 记录；
- 历史 v1 与新 v2 的允许边界；
- 根 `AGENTS.md`、角色合同和 `agent-role` Skill 的完整入口。

默认检查不得自动修改状态。

### `governance:handoff`

新增有状态的角色交接入口，建议命令形状为：

```bash
bun run governance:handoff \
  --from leader \
  --to tasker \
  --task=<task-id> \
  --expected-revision=<n>
```

存在 Initiative 时追加 `--initiative=<initiative-id>` 和 `--phase=<phase-id>`。

命令存在两种参数形态：task 形态用于 Leader → Tasker 等实现交接，使用 `--task` 与 `--expected-revision`（Task revision）；intake 形态用于 PM → Leader 批量交接，使用 `--intake`、`--selection-set`、`--intake-revision`、`--candidate-set-fingerprint` 与 `--expected-revision`（调用方最后读取的 Intake revision）。两种形态共用同一入口与下列流程，第 3 步按形态校验各自的前置对象。

交接命令必须：

1. 解析唯一目标，不按候选路径 fallback；
2. 检查 `from → to` 是否属于固定交接图中的允许交接；
3. 检查 Proposal、Spec、授权、Initiative 依赖、Task context、验证画像和审查模式；
4. 比较调用方读取的 `expected-revision`；
5. 在同一受控操作中更新状态、递增 revision 并追加结构化交接记录；
6. revision 过期或写入失败时保持原文件不变，并要求调用方重新读取。

Markdown 文件的原子替换方式、跨 Initiative/Task 双文件更新顺序、崩溃恢复和 Windows 文件占用语义是实现前必须解决的风险。本提案不预先批准不具备原子性的“先 check、再由 Agent 手改”方案。

## 根 AGENTS.md 的目标结构

根入口默认面向全能 Agent，优先展示每次开发都需要的步骤；按任务触发的参考信息通过明确指针下沉。建议结构：

1. **适用对象与执行模式**：全能 Agent 默认模式、严格角色模式和二者共享合同。
2. **完整开发流程**：输入、分析、合同、拆分、实现验证、审查、集成、合并和发布。
3. **角色职责与交接**：四个角色的边界、固定 handoff 和人类授权点。
4. **进度对象与真相源**：Intake、Proposal、Spec、Initiative、Task、walkthrough、evidence、Issue / Project 和 Git 的职责。
5. **阶段门禁**：何时运行 `governance:check`、何时使用 `governance:handoff`，以及结构检查不能替代的运行验证。
6. **Agent Skills 路由**：按任务类型选择最小充分工作法，详细矩阵指向 `agent-workflow-router`。
7. **授权与停止条件**：数据、发布、远端、浏览器和不可逆动作；角色遇到范围或合同变化时的停止规则。
8. **追加读取规则**：按目录和改动面加载最近 `AGENTS.md`、Spec、测试和编码规范。
9. **汇报与提问**：保留结论、证据、决策和事实保真合同。
10. **仓库导航与命令**：只保留最小入口和专项规则指针。

建议下沉或删除的内容：

- `RELEASE.md` 的完整版本模板和发布载荷细则移至 `scripts/release/AGENTS.md`；
- 面向用户文字的详细规则移至文档或发布规范，根入口只保留触发指针；
- 分支、worktree、PR、merge 和 Windows 清理细节移至 `docs/standards/repository-workflow.md`；
- 角色操作步骤只保留在 `.agents/roles/<role>/AGENTS.md`；
- 仓库结构与文档真相源合并，删除重复入口说明；
- 删除当前根文件中重复的只读、验证和授权表述。

根 `AGENTS.md` 继续受非空行上限保护；新增流程必须通过下沉参考信息实现，而不是扩大长期上下文。

## 数据、接口、安全、迁移、发布与回滚影响

### 数据

不改变产品数据库、用户作品、Workspace 或运行时状态。新增和迁移的是版本控制内的 Markdown、YAML frontmatter 和治理脚本输入。

### 接口

新增开发治理接口：Proposal v1、Intake、Initiative、Task v2、`agent-role` Skill 和 `governance:handoff` CLI。它们属于仓库开发合同，不是产品公开 API。

### 安全与授权

角色 Skill 和 handoff 不增加任何现有授权。外部 Issue、PR、评论、日志和 Intake 来源继续按不可信输入处理。远端写入、合并、发布、部署、数据库迁移、真实 Provider/Model、浏览器人工验收和数据删除仍需明确人类授权。角色合同是行为约束，不是授权证明；依赖真实权限隔离的高风险流程，在宿主运行时能够校验调用者身份与 scope 之前必须保持阻塞。

PM 自主接受只产生 `accepted` 状态本身，不构成实现授权：它不能触发 Spec 实现落地、实现 Task 创建或 PM → Leader handoff；实现授权只能来自携带认证人类确认事件的 selection set 或等效的 Task v2 授权记录。涉及产品行为、数据、接口、安全、兼容、安装、发布或不可逆承诺时，现有授权和人类决策边界继续优先。

本节语义与现行合同存在已知冲突：`docs/proposals/README.md` 当前把 `accepted` 定义为“批准修改规范和创建实现 Task”，`.agents/roles/pm/AGENTS.md` 也要求人类批准前只输出计划诊断；本提案在 `draft` 阶段不改写这些现行合同。收口方式是：实现 Task 必须一次性更新 `docs/proposals/README.md` 生效规则、PM 角色合同和 `governance:check` 检查，使三处与上述受限自主接受语义一致；在该迁移完成前，PM 自主接受路径保持停用，任何实现者不得依据本节单方面启用它。

### 迁移

- Proposal 从正文状态迁入 frontmatter 时必须一次性切换读取者、文档索引、测试和治理检查，不长期双写。
- 新 Task 使用 v2；历史 v1 保持可读。重新打开历史 Task 时迁入 v2，不在全库批量改写。
- 现有 accepted Agent Skills 适配 Proposal 继续有效；本提案扩展的是开发生命周期和交接，不回滚其路由和验证画像。
- 新增 Initiative 和 Intake 后，不把历史 Task 反向包装成虚构 Initiative 或 Intake。
- 实现交付物必须包含一次 clean cutover：更新 `docs/proposals/README.md` 的生效规则、`.agents/roles/pm/AGENTS.md` 和 `governance:check`，使 PM 受限自主接受语义在四处（含本提案“安全与授权”）完全一致；迁移未闭合前该路径停用，不保留两个互斥的 `accepted` 语义。

### 发布

本提案不改变产品版本或发布载荷。治理脚本进入现有 CI 的具体门禁需要在实现 Task 中按运行成本评估；未经批准不修改发布流程。

### 回滚

在任何实现前，可将本 Proposal 标记为 `rejected` 或 `superseded`，不产生运行影响。

实现后若回滚：

1. 停止创建 Proposal v1、Initiative 和 Task v2；
2. 完成或显式封存已存在的有状态对象，不能让它们成为无读取者文件；
3. 删除 `agent-role` 和 `governance:handoff` 的唯一入口及对应检查；
4. 恢复根 `AGENTS.md` 和角色合同到仍能解释现存历史记录的状态；
5. 保留历史 walkthrough、evidence 和交接记录，不伪造状态回退；
6. 不保留兼容 alias、静默 fallback 或两个可写 schema。

## 对 Spec 的预期改动

本提案是 `kind: governance` 的开发流程变更，不改变 NeuroBook 产品可观察行为，不创建产品 capability，也不要求新建产品 Spec。

实现期间若发现该流程会改变产品运行时 Agent、用户 Workspace、数据、公开接口、安全或发布承诺，必须另行进入对应 behavior / architecture Proposal 和 Spec，不由本提案隐式授权。

## 待审查问题

以下细节尚未由本 Proposal 确定，接受前需要审查方向，接受后仍需由实现 Task给出可测试的精确合同：

1. Intake、Selection set 和 Initiative 的最终路径、ID 格式、schema 字段与包级 owner 规则。
2. Proposal v1 的完整 frontmatter、现有 Proposal 迁移清单和无 frontmatter 时的失败语义。
3. Task v2 的状态枚举、历史 v1 重新打开迁移、`authorization` 来源枚举和 `review.reasons` 高风险枚举。
4. 敏捷模式全能 Agent 总报告的文件名、frontmatter 和追加章节格式。
5. Initiative 和 Phase 的最终状态转换表，以及 human gate 的批准证据格式。
6. `governance:handoff` 的跨文件原子写入、锁、compare-and-swap、崩溃恢复和 Windows 文件占用合同。
7. PM 自主判断低风险 Proposal 时必须提供的最小影响分析；结构门禁不能判断语义结论是否正确。
8. 全能 Agent判断小改动的项目指引。当前选择保留 Agent 判断，不建立机器枚举；需要在根规则中避免将其描述成可自动证明的边界。
9. 高风险敏捷审查的受控 reason 列表，以及跨模块但不改变合同的机械改动是否必须独立审查。
10. 现有 `governance:context` 是否扩展为 `agent-role` 的上下文生成后端，还是由 Skill 直接读取合同。
11. selection set 认证人类确认事件的载体（签名、宿主 session 证明或审计日志格式）、scope 枚举与过期撤销的机器可校验编码。
12. 候选 claim 台账 / intent journal 的存储位置、格式、崩溃恢复重放协议与 Windows 文件占用下的并发语义。
13. 外部 URL 默认不抓取策略的例外授权流程、host allowlist 格式与私密线程内容的分级规则。
14. redaction manifest 的精确字段表、字段级 sink allowlist 清单与 fail-closed 校验的执行位置。
15. Intake `analysisRevision` 与批量分析缓存复用、超大输入切块的字节预算与跨块合并协议。

## 验收方向

Proposal 接受后，实施结果至少应通过以下场景证明：

1. 全能 Agent 能从一个非平凡用户请求开始，在一个 session 中按逻辑角色完成 Task、验证、审查和合并决策记录，不创建第二套 Spec 或 Task。
2. PM session 能保存并分流 Intake，但不能通过合法 handoff 直接进入代码实现。
3. Leader 能建立 A/B 并行、C 等待 A/B、D 依赖 C 的 Initiative；依赖未满足时 handoff 失败。
4. 两个 Leader 基于同一 revision 开始工作时，先提交的合法交接成功，后提交的过期交接失败且不覆盖文件。
5. Tasker 缺少有效授权、Spec、context 或 required 验证画像时，Leader → Tasker 或 Tasker → Reviewer 交接失败。
6. Reviewer 要求修复后，原 Task 回到允许的实现状态并追加记录；Tasker 不能自行扩大范围。
7. 高风险敏捷 Task 缺少独立 Reviewer walkthrough 时不能进入合并决策；低风险 self review 按 Task v2 合同通过。
8. behavior Proposal accepted 后缺少 planned Spec 时门禁失败；governance Proposal 不被迫创建产品 Spec。
9. 历史 Task v1 保持可读；重新打开时按明确规则迁入 v2，不批量改写历史正文。
10. `governance:check`、文档检查、脚本 typecheck 和相关治理回归通过；结构检查不冒充产品测试或运行时验收。
11. 用 `local://paste-1.md` 跑通批量协议：切分得到 48 个原始项（含 `18 （低优先级）` 这类缺句点编号的容错）、47 个 canonical candidate、全部来源项映射完整；没有任何有效 selection set 引用的候选不产生实现 Task。
12. Leader 登记中途失败后重试同一 selection set：Task / Phase 无重复、无孤儿 Task，`promoted` 只能由成功 claim 写入。
13. selection set 缺少认证人类确认事件、scope 不匹配、已过期、已撤销或已 `handed-off` 时，PM → Leader 交接失败或收敛为幂等 no-op，不登记新范围。
14. 已 `closed` / `blocked` / `deferred` / `promoted` 的候选出现在 selection set 中时，交接被整体拒绝并列出违规候选。
15. 目标对象缺少可比对验收边界元数据时，`duplicate` 判定被降级为 `related` 并置 `needs-decision`；PM 自主接受的 Proposal 无法通过 handoff 进入实现链路。
16. PM 自主接受语义完成合同收口后才能启用：`docs/proposals/README.md`、`.agents/roles/pm/AGENTS.md` 与 `governance:check` 对 `accepted` 的解释一致，且 governance / architecture 类 Proposal 无法绕过人类确认。

## 决策记录

- 2026-08-22｜状态：draft｜记录本轮开发流程讨论，等待人类审查；本记录不是实现授权。
- 2026-08-22｜讨论选择｜根 `AGENTS.md` 默认面向全能 Agent；严格模式继续使用 PM、Leader、Tasker、Reviewer。
- 2026-08-22｜讨论选择｜采用敏捷与严格两种模式；严格模式使用单一 `agent-role` Skill，角色隔离采用文档合同和治理门禁。
- 2026-08-22｜讨论选择｜新增 Intake；多 Task 或有依赖图时新增 Initiative；固定角色交接与 Initiative 自定义 DAG 分开建模。
- 2026-08-22｜讨论选择｜Proposal 状态迁入 frontmatter 并增加 `kind`；新建或重新打开的 Task 使用 Task v2 和结构化授权、审查字段。
- 2026-08-22｜讨论选择｜`governance:check` 保持只读；新增带 revision 的 `governance:handoff`；多个 Leader 不设固定 owner，通过 revision 拒绝过期交接。
- 2026-08-22｜讨论选择｜敏捷模式使用一份全能 Agent 总报告；高风险改动要求独立 Reviewer；非平凡开发形成治理文档，小改动可只由 Git 追踪。
- 2026-08-22｜讨论选择｜Reviewer 给出结论后由 Leader 晋升 Spec；人类明确批准后由 Leader执行合并和清理。
- 2026-08-22｜修订｜批量协议补充候选级 claim 幂等（`intakeId + candidateId + workKind`）、既有对象复用、`promoted` 受控写入时机与 intent journal / claim 台账恢复合同。
- 2026-08-22｜修订｜selection set 增加认证授权、scope、presentationHash、analysisRevision 与 `confirmed → handed-off | revoked | expired` 生命周期；失效不追溯撤销已建 Task。
- 2026-08-22｜修订｜handoff 增加候选状态门禁与 expected-revision 三方比对；固定交接图补充 PM → Human 与 Human → PM。
- 2026-08-22｜修订｜收紧 PM 自主接受范围（排除 governance / architecture 与高风险类别）并明确其不构成实现授权。
- 2026-08-22｜修订｜新增模型输入指令 / 数据隔离、脱敏 sink 门禁、URL 默认不抓取、两级修复与重试预算、摘要自足标准。
- 2026-08-22｜修订｜补确定性切分与低优先级标记 grammar、Task 路径多命名空间解析、duplicate 降级规则、`new` 移出关系枚举、Task lineage 落点、selection set 真相源章节与 paste-1 验收场景。
- 2026-08-22｜修订｜明确 PM 自主接受的合同冲突收口：README / PM 角色合同 / `governance:check` 的一次性更新列为实现交付物，迁移完成前该路径停用并纳入验收场景 16。
