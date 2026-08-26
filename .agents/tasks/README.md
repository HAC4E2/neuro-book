# Agent Tasks

这里保存 NeuroBook 开发 Agent 的任务合同、角色交接和正式证据。Task 记录一次实现，不承担产品规范；能力合同和成熟度从 [`../../docs/specs/`](../../docs/specs/) 进入。

## 真相源分工

- GitHub Issue：公开目标、范围、验收、子项、整体依赖和协作状态，是多Task交付的唯一聚合根；不充当Leader本地权限锁。
- GitHub Project：可选的优先级、迭代、负责人和交付状态投影。
- `docs/specs/`：`planned`目标合同与`implemented`当前合同的唯一真相源。
- `docs/proposals/`：需要开发者决策的长期方案和取舍。
- `.agents/tasks/<task>/README.md`与`context.md`：Leader写给Tasker的一次设计或实现文件合同。
- `walkthroughs/`：Leader、Tasker、Reviewer的追加式结果和偏差报告。
- `evidences/`：脱敏后的正式证据。

Task 不复制 Issue 的 `module`、`priority`、labels 或 iteration；变化只在 Issue / Project 更新。

关系固定为Issue聚合、Task扁平关联：一个可执行叶子Issue进入调研、设计或实现后有`1..N`个Task；每个Task的`actionIssueId`最多关联一个Issue。多个Task直接共享同一`actionIssueId`，不创建统筹Task、不增加`parentTaskId`。容器Issue或等待下一位Leader继续拆分的Issue可以暂时没有直接Task，但必须列出子Issue或下一拆分入口。产品Issue未获远端写入授权并取得编号前只保留Issue草稿、Proposal和Spec，不创建对应产品Task、不伪造本地Issue ID。无Issue的本地治理、实验或机械工作允许`actionIssueId: null`。

## 目录结构

```text
.agents/tasks/
├── AGENTS.md
├── README.md
├── ownership.json
└── 00000-task-title/
    ├── README.md
    ├── context.md
    ├── evidences/
    └── 00000-role-YYYY-MM-DD_HH-mm-title.md

packages/neuro-book/.agents/tasks/
└── <ownership.json 登记的应用 Task 目录>

根 `.agents/tasks/ownership.json` 是双根 owner 选择的唯一索引：登记的稳定 Task 名解析到应用包 root，未登记 Task 解析到根 root；解析器不得按候选路径 fallback。

## Task README

新任务 README 使用最小 frontmatter：

```yaml
---
schema: nbook.task/v1
taskId: 00161-example
issueRequired: true
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

- `taskId`：任务目录的稳定身份。根新Task使用五位`00152+`编号；历史身份按迁移快照精确识别，不由数值范围或缺字段推断。
- `issueRequired`、`actionIssueId`：当前Task必须显式声明。应用owner `packages/neuro-book/.agents/tasks`固定为`issueRequired: true`和正整数Issue；根owner允许`true`+正整数，或无Issue本地治理/实验/机械Task使用`false`+`null`。禁止`parentTaskId`和多Issue数组。
- `worktreeId`、`branchId`：必须显式存在且为`null`或非空字符串；记录实际执行身份，治理文档直接在当前工作区修改时可为`null`。
- `status`：`draft`只供开发者审阅，Tasker不得执行；`draft`→`planned`的唯一接受点是开发者明确接受该Task目标、范围、依赖、验收和停止条件，由Leader翻转并在context/walkthrough记录来源和时间。`planned`表示可派发但不授权受限动作；其后为`in-progress`、`blocked`、`verifying`、`completed`或`abandoned`。
- `createdAt`、`updatedAt`：任务记录时间。
- `agentWorkflow`：Leader为新建或重新打开Task填写的执行与验证画像；它指导Tasker自觉工作，不是角色状态机。
- `profile`固定为`nbook.agent-skills/v1`；`kind`允许`feedback`、`design`、`bug`、`feature`、`refactor`、`docs`、`release`、`migration`。
- `kind: design`只产出Task指定的Proposal/Spec草案、证据和决策简报；可由Tasker直接与开发者协作，不实现业务代码。
- `routes`记录Tasker完成任务所需的最小Skill集合；API设计必须包含`api-and-interface-design`。
- `verification.required`列出必须真实执行或报告不可执行的检查；适用但未获授权仍留在required并报告阻塞，不能用较弱命令冒充。
- `verification.notRun`只表示不适用，必须写具体适用性原因且不得与required重叠；未获授权不是不适用。

`kind: design`的README还必须包含四个非空章节：

- `## 设计类型`：一个不超过64字符的明确单行类型；API只是需要专属Skill的特例，其它明确类型同样合法；
- `## 设计产物`：唯一Proposal/Spec目标路径和决策简报；
- `## 决策范围`：允许Tasker与开发者确认的产品取舍；
- `## 允许文件`：唯一Proposal/Spec和当前Task直属walkthrough/evidence路径。

活跃Design Task首次提交时，README和context共同密封Design合同；context恰好记录一个密封提交严格祖先、创建前Git SHA的`基线 revision`。治理门禁以该首次密封合同的kind、执行身份、设计产物和允许文件检查从基线到退出Design窗口的实际diff；同一diff修改当前frontmatter、状态、context基线或allowlist不能关闭或扩大门禁。Design Task已提交退出活跃状态后不得重开；后续设计必须创建并密封新Task。普通Task不要求Design基线字段。

API类型必须路由`api-and-interface-design`。Design Task不得包含业务源码路径，不得把Spec晋升`implemented`；Leader在后续实现与证据闭合后处理成熟度。

Task README 只记录执行合同；实际命令、结果、revision、环境、截图、日志和正式产物仍写入追加式 walkthrough / evidence。Task 不复制 Issue / Project 的 `module`、`priority`、labels 或 iteration。

Task 状态只描述本次执行记录，不替代 Issue 或 Project 状态；Task `completed` 也不能触发对应 Issue 项目条目的 Project `Done`。Project 的交付状态和统一评审门禁以 [`docs/standards/repository-workflow.md#project-交付状态与统一评审`](../../docs/standards/repository-workflow.md#project-交付状态与统一评审) 为准。

Tasker可执行`planned`、`in-progress`和`verifying`：前两者用于实现，`verifying`用于补required证据或修复不改变目标、Spec、owner、允许文件和验收的验证缺陷，状态保持`verifying`并重跑required。合同变化时Tasker阻塞并交回Leader；Leader取得开发者决策、更新合同后退回`in-progress`再派发。`verifying`→`completed`只由Leader在验证与审查闭合后翻转。

## Context、Walkthrough 与 Evidence

- `context.md`由Leader维护，保存Tasker恢复所需的开发者决策、基线、依赖、风险、非目标和已获受限动作授权的具体动作、范围与来源；未记录即未授权，一个动作授权不外推到其它动作。
- Leader、Tasker和Reviewer分别追加walkthrough，不覆盖他人报告；Tasker结果和计划偏差必须落文件，不依赖聊天。
- 正式脱敏产物进入`evidences/`；运行数据遵守系统临时根规则。

## 顺序工作流

1. 开发者批准目标、范围和关键取舍；这足以让Leader开始本地编排，不等待PM或Issue claimed。
2. Leader选择产物：交给下一位Leader继续拆分的Issue、供审阅的draft Task、可执行的planned Task、Proposal或Spec。
3. 产品目标未有远端Issue编号时，Leader按`.agents/issues/README.md`维护草稿；获具体远端动作授权后先按Draft-Key查询，取得或复用编号后只创建共享`actionIssueId`的draft扁平Task，开发者接受后再planned。
4. 大目标可先建调研/design Task；design Tasker可以直接与开发者协作，把未决方案写Proposal，把明确接受的合同写入指定planned Spec。
5. Leader检查ownership和编号，创建Task README、context、切片、owner和agentWorkflow；默认顺序执行。
6. 普通Tasker只通过文件合同实现、验证和报告；design Tasker只修改Task列出的Proposal/Spec与报告文件。
7. 每次合并前必须有人审查。低风险文档/机械改动可由Leader自审；高风险变化或Task要求使用独立Reviewer。
8. 代码、验证和Spec闭合后，Leader将planned Spec原地晋升implemented并报告受限下一动作。Task completed不触发Project Done。

## 恢复

- Leader恢复：先读取`.agents/issues/drafts/`中的未编号Issue草稿，再读取Issue/Spec、Task README、context、最新walkthrough/evidence和当前diff，从最后一致状态继续；远端Issue创建后按`.agents/issues/README.md`迁移并删除草稿。
- Tasker恢复：只以Task文件和当前diff为依据；文件合同缺失、过期或矛盾时写阻塞报告，不从聊天猜计划。
- PM与Reviewer按需加载，不构成Leader或Tasker的等待条件。
- 静态治理检查只证明文件结构，不证明Agent理解产品意图或完成运行时验证。


## 历史任务

历史兼容只来自`legacy-index.json`与`.migration-complete`首次共同添加commit中的密封迁移快照：治理重算该快照manifest，并取其固定`sourceRevision`中的`docs/tasks/<taskId>/README.md`与同源同目标README mapping交集。当前index/marker的`sourceRevision`和mapping identity projection必须与密封快照一致；后续只可按完整迁移门禁同步source/destination hash。根`1..148`、应用ownership登记的`1..148`据此识别；根只另保留三个精确过渡合同`00149-monorepo-workspace-consolidation`、`00150-monorepo-boundary-convergence`、`00150-ui-spec-verification`，`00151-*`无效，根`00152+`和应用`149+`使用完整当前合同。数值0、伪造低号slug、后续可达commit或只改当前mapping均无效。历史Task不补当前新增字段；已声明有效`nbook.task/v1`仍校验status、时间、context和agentWorkflow基础不变量。`00158-notification-contrast-fix`只豁免历史缺失`context.md`。旧`docs/tasks/`正文不为流程切换批量改写。
