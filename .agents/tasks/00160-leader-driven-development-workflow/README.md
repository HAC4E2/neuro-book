---
schema: nbook.task/v1
taskId: 00160-leader-driven-development-workflow
issueRequired: false
actionIssueId: null
worktreeId: .worktree/t160-leader-driven-workflow
branchId: refactor/t160-leader-driven-workflow
status: completed
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-27T02:15:49Z
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
    notRun:
      - check: browser
        reason: 本Task仅修改开发治理文档和静态脚本，没有浏览器可见表面
---

# Task 00160：Leader 主导的顺序开发流程

## 目标

把现行四角色状态机收敛为开发者→Leader→Tasker→Leader→开发者的顺序流程。Leader产出可继续拆分的Issue、draft/planned Task、Proposal和Spec；Issue统筹多个扁平Task；普通Tasker只消费文件合同并实现，design Tasker可直接与开发者协作制定API等规范并写回文件；PM和Reviewer按需。

## 授权来源

开发者在当前对话明确要求：Leader不等待PM，负责Issue、Spec与Task；Leader产物包括交给下一位Leader继续拆分的Issue、Task草案、可执行Task、Proposal和Spec；Leader可派发API等design Task，让Agent与开发者直接协作制定并写入Spec；Issue采用聚合根+扁平Task模型，不创建统筹Task。

开发者随后明确要求“提交 PR”，授权本 Task 在专用 worktree 创建本地 commit、push `refactor/t160-leader-driven-workflow` 并创建 PR；该授权不包含合并、发布、部署或 Issue/Project 元数据写入。

## 范围

- 根开发入口与仓库工作流中的角色顺序和授权边界。
- PM、Leader、Tasker、Reviewer canonical 角色合同。
- Task 创建、恢复、交接和验证合同。
- accepted P-005 的当前决策与索引。
- 与上述文本耦合的治理静态检查和测试。

## 非目标

- 不修改产品代码、产品 Spec 或 Issue #191 实现计划。
- 不执行远端Issue/Project元数据写入、合并、发布、部署、数据库迁移、真实Provider/Model、浏览器人工验收或数据删除。
- 不新增角色状态机、交接 CLI、权限沙箱或第二套 Task schema。
- 不批量改写历史 Task 和 walkthrough。

本Task只调整开发治理合同，NeuroBook产品行为合同未变，因此不创建或修改产品Spec。

## 行为合同

1. 开发者批准目标后，Leader可完成范围内本地编排，不以claimed、PM同步或逐项本地许可为前置。
2. Leader明确选择五类产物：下一位Leader继续拆分的Issue、draft Task、planned Task、Proposal、Spec。
3. Issue是多Task交付聚合根；可执行叶子Issue使用`1..N`个共享`actionIssueId`的扁平Task，不创建统筹Task或Task父子状态。
4. 未获远端Issue写入授权时，Leader保存含唯一Draft-Key、type/status标签和具体授权请求的草稿；获授权后先查找精确`Draft-Key`，0个匹配才创建、1个复用、多个阻塞。取得编号后只创建`status: draft`且`issueRequired: true`的同批扁平Task；开发者接受后由Leader改为planned，闭合链接并持久化授权和迁移结果后最后删除草稿。
5. draft Task不可执行；planned Task可派发但不授权受限动作。Tasker可在verifying补required证据或同合同修复；合同变化由Leader取得开发者决策后退回in-progress。design Tasker只修改密封合同允许的Proposal/Spec和报告，不实现业务代码。
6. 普通Tasker只通过文件合同实现、验证并报告偏差，不修改Issue、Proposal、Spec或Task范围。
7. PM/Reviewer按需；合并前仍有人审查，高风险改动使用独立Reviewer。
8. 受限动作分别授权并记录具体动作、范围与来源，一个授权不外推。本Task已获动作与未授权边界以`context.md`为准，不在行为合同维护第二份授权摘要。

## 验收
- 现行合同只有一条完整顺序主线；Leader可直接本地编排，PM与远端claimed状态不是前置。
- Issue聚合、Draft-Key幂等迁移、先draft后开发者接受、授权留痕和最后删除顺序明确。
- Tasker开始和恢复所需信息来自文件；verifying返工、Design密封基线和真实diff边界有门禁。
- 根/应用双Task root的历史身份、owner `issueRequired`、`actionIssueId`和禁用聚合字段有负向门禁。
- P-005、角色合同、Task合同、仓库流程和治理检查语义一致。
- 聚焦治理测试、`docs:check`、`governance:check`与diff check通过。
