---
schema: nbook.task/v1
taskId: 00160-leader-driven-development-workflow
actionIssueId: null
worktreeId: null
branchId: null
status: completed
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T19:19:25+08:00
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: refactor
  routes:
    - writing-for-agents
    - documentation-and-adrs
    - code-review-and-quality
  verification:
    required:
      - focused-test
      - docs-check
      - governance-check
      - diff-check
    notRun: []
---

# Task 00160：Leader 主导的顺序开发流程

## 目标

把现行四角色状态机收敛为开发者→Leader→Tasker→Leader→开发者的顺序流程。Leader产出可继续拆分的Issue、draft/planned Task、Proposal和Spec；Issue统筹多个扁平Task；普通Tasker只消费文件合同并实现，design Tasker可直接与开发者协作制定API等规范并写回文件；PM和Reviewer按需。

## 授权来源

开发者在当前对话明确要求：Leader不等待PM，负责Issue、Spec与Task；Leader产物包括交给下一位Leader继续拆分的Issue、Task草案、可执行Task、Proposal和Spec；Leader可派发API等design Task，让Agent与开发者直接协作制定并写入Spec；Issue采用聚合根+扁平Task模型，不创建统筹Task。

## 范围

- 根开发入口与仓库工作流中的角色顺序和授权边界。
- PM、Leader、Tasker、Reviewer canonical 角色合同。
- Task 创建、恢复、交接和验证合同。
- accepted P-005 的当前决策与索引。
- 与上述文本耦合的治理静态检查和测试。

## 非目标

- 不修改产品代码、产品 Spec 或 Issue #191 实现计划。
- 不执行远端Issue/Project/PR写入、push、合并、发布、部署、数据库迁移、真实Provider/Model、浏览器人工验收或数据删除。
- 不新增角色状态机、交接 CLI、权限沙箱或第二套 Task schema。
- 不批量改写历史 Task 和 walkthrough。

本Task只调整开发治理合同，NeuroBook产品行为合同未变，因此不创建或修改产品Spec。

## 行为合同

1. 开发者批准目标后，Leader可完成范围内本地编排，不以claimed、PM同步或逐项本地许可为前置。
2. Leader明确选择五类产物：下一位Leader继续拆分的Issue、draft Task、planned Task、Proposal、Spec。
3. Issue是多Task交付聚合根；取得远端Issue编号后，可执行叶子Issue使用`1..N`个共享`actionIssueId`的扁平Task，不创建统筹Task或Task父子状态。
4. 未获远端Issue写入授权时，Leader在`.agents/issues/drafts/<slug>.md`保存恢复草稿并请求授权，不伪造Issue ID或创建产品Task；取得编号后迁移并删除草稿。
5. draft Task不可执行；planned Task可派发，但不授权任何受限动作。design Tasker只把决定写入指定Proposal/Spec草案，不实现业务代码。
6. 普通Tasker只通过文件合同实现、验证并报告偏差，不修改Issue、Proposal、Spec或Task范围。
7. PM/Reviewer按需；合并前仍有人审查，高风险改动使用独立Reviewer。
8. 受限动作分别授权并记录具体动作、范围与来源；一个授权不外推到其它动作。本Task仅获本地治理文件编辑与验证授权。

## 验收
- 现行合同只有一条完整顺序主线，不再出现Leader必须等待PM claim或PM状态迁移的前置。
- Issue聚合、未编号草稿迁移与扁平Task关系明确，不存在统筹Task或Task父子状态。
- Tasker开始和恢复所需信息来自文件；design Task有受控类型、唯一设计产物、决策范围和允许文件。
- 根/应用双Task root的新合同身份、`actionIssueId`和禁用聚合字段有负向门禁。
- P-005、角色合同、Task合同、仓库流程和治理检查语义一致。
- 聚焦治理测试、`docs:check`、`governance:check`与diff check通过。
