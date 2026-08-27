# Agent Tasks

这里保存 NeuroBook 开发 Agent 的单次派发合同、角色交接和正式证据。Task 由 Agent 主导执行，不承担产品规范或长期路线；能力合同和成熟度从 [`../../docs/specs/`](../../docs/specs/) 进入。

## 真相源分工

- GitHub Issue：只为重大或长期交付保存公开目标、总体范围与非目标、验收、重大依赖、Task 导航和交付状态；是多 Task 交付的唯一聚合根，不充当本地权限锁。
- GitHub Project：可选的优先级、迭代、负责人和交付状态投影。
- `docs/specs/`：`planned` 目标合同与 `implemented` 当前合同的唯一真相源。
- `docs/proposals/`：需要开发者决策的长期方案和取舍。
- `.agents/tasks/<task>/README.md` 与 `context.md`：Leader 写给 Tasker 的一次人机协作与执行合同。
- roadmap：尚未成为派发合同的候选阶段；没有 Task ID、状态、owner、允许文件或执行授权。
- `walkthroughs/` 与 `evidences/`：追加式结果、偏差和脱敏正式证据。

关系固定为 Issue 聚合、Task 扁平关联：一个 Issue 可以有 `0..N` 个 Task；一个 Task 通过 `actionIssueId` 关联 `0..1` 个 Issue。属于已有 Issue 验收范围的 Task 无论位于哪个 Task root 都写该正整数编号；不值得创建 Issue 的本地治理、隔离实验或机械工作显式写 `actionIssueId: null`。多个 Task 可共享同一编号；禁止统筹 Task、`parentTaskId`、`actionIssueIds` 和 `issueIds`。只有需要独立排期、独立验收或独立交付的结果才拆子 Issue，调研、设计和编码步骤默认仍是同一 Issue 下的 Task。

## 目录结构

```text
.agents/tasks/
├── AGENTS.md
├── README.md
├── ownership.json
└── 00000-task-title/
    ├── README.md
    ├── context.md
    ├── walkthroughs/
    └── evidences/

packages/<package>/.agents/tasks/
└── <package-owned Task records>
```

根 `.agents/tasks/ownership.json` 是根与主应用双 root 的唯一 owner 索引：登记的稳定 Task 名解析到应用包 root，未登记 Task 解析到根 root；解析器不得按候选路径 fallback。自治包的 `nbook.task/v1` Task 使用同一当前合同；无该 frontmatter 的导入记录只作历史资料。

## Task README

新 Task 一经创建就是可派发合同，使用最小 frontmatter：

```yaml
---
schema: nbook.task/v1
taskId: 00161-example
actionIssueId: 123
worktreeId: null
branchId: null
status: planned
createdAt: 2026-08-15T00:00:00Z
updatedAt: 2026-08-15T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: bug
  routes:
    - diagnosing-bugs
    - test-driven-development
    - code-review-and-quality
  verification:
    required:
      - regression-test
      - focused-test
      - diff-check
    notRun: []
---
```

- `taskId`：任务目录的稳定身份。根新 Task 使用五位 `00152+` 编号；历史身份按迁移快照精确识别，不由数值范围或缺字段推断。
- `actionIssueId`：必须显式为正整数或 `null`，只由工作是否属于重大 Issue 的交付范围决定，不按 root 或 owner 分叉。
- `worktreeId`、`branchId`：必须显式为 `null` 或非空字符串，记录实际执行身份。
- `status`：合法值为 `planned`、`in-progress`、`blocked`、`verifying`、`completed`、`abandoned`。`planned` 表示 Leader 已核实完整合同并派发，不表示开发者批准文件细节，也不授权受限动作。
- `agentWorkflow.profile` 固定为 `nbook.agent-skills/v1`；`kind` 允许 `feedback`、`design`、`research`、`bug`、`feature`、`refactor`、`docs`、`release`、`migration`。
- `routes` 是完成 Task 所需的最小 Skill 集合；API 设计必须包含 `api-and-interface-design`。
- `verification.required` 列出必须真实执行或报告不可执行的检查；适用但未获授权仍留在 required。
- `verification.notRun` 只表示不适用，必须有具体原因且不得与 required 重叠。

状态为 `planned`、`in-progress`、`blocked` 或 `verifying` 的当前 `nbook.task/v1` README 必须包含八个非空章节：

1. `## 目标`：单一完成结果及其 Issue/Spec 或“行为合同未变”依据。
2. `## Agent 工作`：执行角色和 Agent 主导的调查、设计、编码、验证、记录与交接动作，每项有可检查完成条件。
3. `## 开发者参与`：只列必须由开发者完成的设计、实际观察/验证、产品判断、风险接受或受限动作授权，并写触发时机与 Agent 提供的材料；没有参与点时写“无，Agent 在现有合同内完成”。
4. `## 任务产物`：精确文件、代码提交、Proposal/Spec、walkthrough/evidence 或运行结果，并标明 owner 和消费者。
5. `## 修改计划`：按依赖顺序写模块/文件、行为变化、消费者迁移和对应验证；research 写研究步骤与 evidence 落点，design 写唯一 Proposal/Spec 目标。
6. `## 完成门禁`：产物、验证、决定和审查条件；`verification.required` 必须逐项可映射。
7. `## Leader 继续条件`：Leader 继续所需的具体产物、开发者决定或验证结果，以及最小恢复集合。Leader 派发后停止，不预建依赖未知结果的后续 Task。
8. `## 允许文件`：精确写入边界；research/design 继续执行路径 containment，普通实现 Task 可列模块路径。

`kind: research` 还必须包含 `研究问题`、`研究产物`、`决策范围`；它只产生只读或隔离实验的证据和开发者判断，不借用 design。每项研究产物必须是本 Task `walkthroughs/` 或 `evidences/` 下的精确单层路径，声明式 `允许文件` 必须与研究产物集合一致；README/context 由 Leader 维护，不属于 Research Tasker allowlist。对 active research，提交前门禁检查 owner scope 内 staged、unstaged 和 untracked 的全部实际路径，只额外放行该 Task README/context；owner scope 固定为根 Task 覆盖全仓、主应用 Task 覆盖 `packages/neuro-book/`、自治包 Task 覆盖所属 `packages/<package>/`。门禁只检查相对 `HEAD` 尚未提交的当前工作树差异，不追溯已进入 `HEAD` 的历史 diff；首次进入 HEAD 后固定 kind、状态和研究产物，HEAD 列表或单文件读取失败均 fail closed，且不得回退当前树合同。同一 owner scope 同时存在多个 active research 时 fail closed。`kind: design` 还必须包含 `设计类型`、唯一 `设计产物`、`决策范围` 和 `允许文件`；只产出指定 Proposal/Spec 草案、证据和决策简报，不实现业务代码。

活跃 Design Task 首次提交时，README 和 context 共同密封合同；context 恰好记录一个密封提交严格祖先、创建前 Git SHA 的 `基线 revision`。门禁以首次密封的 kind、执行身份、设计产物和允许文件检查实际 diff；同一 diff 不能通过修改当前 frontmatter、状态、context 或 allowlist 关闭或扩大门禁。Design Task 已提交退出活跃状态后不得重开。

## Context、执行与恢复

- `context.md` 只保存当前基线、权限、上游决定、阻塞和下一合法动作；不复制 README 完整合同。受限动作必须记录具体动作、范围与开发者来源，未记录即未授权。
- Tasker 可执行 `planned`、`in-progress` 和 `verifying`；`blocked` 只在解除条件满足后由 Leader 恢复。`verifying` 只补 required 证据或修复不改变目标、Spec、owner、允许文件和验收的缺陷。
- Tasker 在 `开发者参与` 的触发点准备证据、选项和建议后停止该步骤；开发者作出设计、观察、验证或判断后，Agent 继续。Tasker不得把未取得的人类决定替换为自身决定。
- 合同变化时 Tasker写偏差报告交回 Leader；Leader取得必要产品决定、更新合同后退回 `in-progress` 再派发。
- Leader读取 Task README、context、最新 walkthrough/evidence 和当前 diff 恢复；满足 `Leader 继续条件` 后才按真实结果更新 roadmap、完成当前 Task 或创建唯一下一 Task。
- 每次合并前必须有人审查。低风险文档/机械改动可由 Leader 自审；高风险变化使用独立 Reviewer。
- Task `completed` 不触发 Project `Done` 或任何远端动作。

## 顺序工作流

1. 开发者批准重大目标和产品取舍；Leader在范围内完成本地编排，不等待 PM 或 claimed 状态。
2. 值得长期公开追踪的目标进入 Issue；其余本地工作直接使用 `actionIssueId: null` Task。
3. Leader按需创建一个完整 `planned` Task，明确 Agent 工作、开发者参与、产物、修改计划、完成门禁和继续条件，然后派发并停止。
4. Tasker按文件合同主导执行，在明示参与点让开发者完成判断或验证，并把结果写回 walkthrough/evidence。
5. Leader只在继续条件满足后读取真实结果，更新 Issue/roadmap/Spec，或创建唯一下一 Task；不预建完整 Task 链。
6. 实现、验证和 Spec 闭合后，Leader完成审查、更新状态并报告仍需单独授权的动作。

## 历史任务

历史兼容只来自 `legacy-index.json` 与 `.migration-complete` 首次共同添加 commit 中的密封迁移快照。根 `1..148`、应用 ownership 登记的 `1..148` 据此识别；根另保留三个精确过渡合同 `00149-monorepo-workspace-consolidation`、`00150-monorepo-boundary-convergence`、`00150-ui-spec-verification`。历史 Task、已 `completed`/`abandoned` Task 和无 v1 frontmatter 的导入记录不为本次流程切换回填八章节；旧 walkthrough 不改写。已声明有效 `nbook.task/v1` 仍校验 status、时间、context 和 agentWorkflow 基础不变量。
