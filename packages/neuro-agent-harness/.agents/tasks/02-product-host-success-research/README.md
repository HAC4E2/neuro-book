---
schema: nbook.task/v1
taskId: 02-product-host-success-research
actionIssueId: 193
worktreeId: null
branchId: null
status: in-progress
createdAt: 2026-08-26T09:52:57Z
updatedAt: 2026-08-27T05:49:49Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: research
  routes:
    - domain-modeling
    - decision-brief
    - doubt-driven-development
  verification:
    required:
      - docs-check
      - governance-check
      - diff-check
    notRun: []
---

# Task 02：目标宿主与首版成功标准

## 目标

为 Issue #193 持久决定两个问题：`D-PRODUCT-01` 第一版首先服务哪类宿主；`D-PRODUCT-02` 宿主观察到什么结果才算第一版成功。本 Task 不设计 API，不选择 Runtime、Session、Store 或包拓扑；这些必须由本 Task 的真实结果约束后续路线。

行为合同未变：本 Task 只产生研究证据、开发者观察、决策简报和决定记录，不修改产品源码、公开接口、数据或持久化状态。

## Agent 工作

1. **证据阶段，已完成。** Leader已固定官方来源、三类宿主画像、反例和空白开发者观察模板，产物为 `walkthroughs/001-host-evidence-and-observation.md` 与 `evidences/host-evidence-manifest.json`。manifest状态为 `evidence-ready-observation-pending`。
2. **观察后简报。** 开发者完成独立观察后，Agent逐项核对观察来源、未检查项和证据缺口；只有观察完整时才写 `walkthroughs/002-product-decision-brief.md`。简报分别为两个 decision ID 给出候选、建议、选错代价、可逆性和证据缺口。
3. **决定后记录。** 开发者明确判断后，Leader写 `walkthroughs/003-product-decision-record.md`，保存引用版本、结论、拒绝项、适用范围、不服务范围和重开条件。
4. **交接。** Leader按完成门禁更新Task状态和Issue #193路线图；不自动恢复已删除的03–11，不预建完整后续链。

## 开发者参与

当前参与点是**独立观察**。开发者阅读：

- `walkthroughs/001-host-evidence-and-observation.md` 的三类宿主画像；
- `evidences/host-evidence-manifest.json` 的固定来源、覆盖和限制；
- walkthrough 中的“空白开发者独立观察模板”。

开发者填写每类宿主的真实需要、假想需要、明确不服务、不可接受失败、观察来源与方法、未检查项和证据缺口。Agent不得代填，也不得在此之前给产品推荐。

简报完成后，开发者针对 `D-PRODUCT-01` 与 `D-PRODUCT-02` 明确选择、拒绝或判定证据不足。开发者不审批Skill、允许文件、验证命令或Task状态。

## 任务产物

- Agent/Leader → 开发者：`walkthroughs/001-host-evidence-and-observation.md`，固定证据、三类宿主画像和观察模板；已完成。
- Agent/Leader → 自动校验与开发者：`evidences/host-evidence-manifest.json`，来源provenance、覆盖、限制和阶段状态；已完成。
- Agent → 开发者：`walkthroughs/002-product-decision-brief.md`；必须等待开发者观察完成。
- Leader → 下一位Leader：`walkthroughs/003-product-decision-record.md`；必须等待两个decision ID都有开发者判断。

## 修改计划

1. 保持现有001 evidence和manifest不变，让开发者在空白模板记录独立观察。
2. Agent验证观察是否覆盖三类宿主、事实/推论分离、未检查项和证据缺口；不足则记录精确缺口并停止。
3. Agent根据已记录观察写002简报，不修改产品合同或路线图。
4. 开发者分别判断两个decision ID；Leader把判断和依据写入003。
5. Leader运行required检查，满足完成门禁后完成Task，并依据结果更新非绑定路线图或创建唯一下一Task。

## 完成门禁

- `D-PRODUCT-01` 与 `D-PRODUCT-02` 均有固定证据、开发者独立观察、决策简报、明确判断和持久记录，或被明确记录为 `evidence-insufficient` 并说明缺口。
- 首要宿主有边界，不能只写“所有人”；成功标准是宿主可观察或可测量的结果，不是内部实现清单。
- 明确记录首版不服务范围、不可接受失败和两个决定的重开条件。
- 001/manifest、002、003 的引用版本一致；外部事实、研究推论和开发者判断可区分。
- `docs-check`、`governance-check` 与 `diff-check` 对当前文件集合有真实结果；未执行项不伪装成通过。

## Leader 继续条件

Leader只在下列输入到达时继续对应阶段：

1. 开发者已完整填写 `001` 的独立观察模板：Agent核对覆盖与证据缺口，随后写 `002-product-decision-brief.md`；
2. 开发者已针对 `D-PRODUCT-01`、`D-PRODUCT-02` 和对应简报版本明确判断：Leader写 `003-product-decision-record.md` 并检查完成门禁；
3. walkthrough 已记录 `evidence-insufficient`、精确缺口和需要开发者或新研究提供的材料：Leader保存阻塞并停止。

恢复所需最小集合：Issue #193、[`../../../docs/issue-193-roadmap.md`](../../../docs/issue-193-roadmap.md)、本 README、`context.md`、001/manifest，以及存在时的002/003。完成门禁满足后，新Leader先更新路线图，再按真实结果创建最多一个下一`planned` Task；不恢复已删除草案。

当前条件尚未满足：证据材料已就绪，开发者观察 `not-recorded`。Leader/Agent现在停止在开发者参与点，需要开发者填写001中的空白观察模板才能继续。

## 研究问题

- `D-PRODUCT-01`：第一版首先服务哪类宿主？允许选择一个首要宿主、明确组合，或判定证据不足；不能只写“所有人”。
- `D-PRODUCT-02`：第一版达到什么宿主可观察结果才算成功？必须包含不可接受失败。

## 研究产物

- `packages/neuro-agent-harness/.agents/tasks/02-product-host-success-research/walkthroughs/001-host-evidence-and-observation.md`
- `packages/neuro-agent-harness/.agents/tasks/02-product-host-success-research/evidences/host-evidence-manifest.json`
- `packages/neuro-agent-harness/.agents/tasks/02-product-host-success-research/walkthroughs/002-product-decision-brief.md`
- `packages/neuro-agent-harness/.agents/tasks/02-product-host-success-research/walkthroughs/003-product-decision-record.md`

## 决策范围

开发者只决定首要宿主和首版成功标准。Runtime、Session字段、Store、API、包拓扑、Proposal和Spec不在本Task决策范围内。

## 允许文件

- `packages/neuro-agent-harness/.agents/tasks/02-product-host-success-research/walkthroughs/001-host-evidence-and-observation.md`
- `packages/neuro-agent-harness/.agents/tasks/02-product-host-success-research/evidences/host-evidence-manifest.json`
- `packages/neuro-agent-harness/.agents/tasks/02-product-host-success-research/walkthroughs/002-product-decision-brief.md`
- `packages/neuro-agent-harness/.agents/tasks/02-product-host-success-research/walkthroughs/003-product-decision-record.md`

README 和 `context.md` 由 Leader 维护，不属于 Research Tasker 的允许文件。

当前不授权源码、依赖/lockfile、scratch、branch/worktree、Git、真实Provider/Model、Proposal、Spec、Issue/Project远端写入、浏览器人工验收或数据删除。
