---
schema: nbook.walkthrough/v1
taskId: 00160-leader-driven-development-workflow
sequence: 1
role: leader
status: completed
createdAt: 2026-08-26T18:10:00Z
---

# Leader 主导的顺序开发流程

## 开发者决策

- 主线改为开发者→Leader→Tasker→Leader→开发者；Leader不等待PM、`status: claimed`或Project状态。
- Leader正式产出五类文件合同：交给下一位Leader继续拆分的Issue、不可执行的draft Task、可执行的planned Task、Proposal、Spec。
- Leader可创建`agentWorkflow.kind: design`设计Task。design Tasker可直接与开发者协作制定API等合同，只更新Task指定的Proposal/Spec草案和报告，不实现业务代码。
- 普通Tasker只通过文件合同实现、验证和报告偏差；PM与Reviewer按需。
- 开发者批准范围覆盖本地可逆动作；远端写入、push、PR、合并、发布、部署、数据库迁移、真实Provider/Model、浏览器人工验收和数据删除仍分别授权。

## 已完成合同

- 同步根入口、OMP规则、四个canonical角色、Task目录规则、Proposal/Spec生命周期、仓库Issue/Project/Git工作流与accepted P-005。
- `draft`与`planned`成为Task执行成熟度边界；`design`加入`nbook.agent-skills/v1`合法kind，并要求受控类型、唯一Proposal/Spec产物、决策范围和允许文件。
- Issue成为唯一多Task聚合根。未编号Issue使用`.agents/issues/drafts/<slug>.md`恢复，取得远端编号后迁移并删除；不伪造Issue ID或本地`actionIssueId`。
- 根Task `00152+`和应用Task `149+`使用完整当前合同；历史例外按明确名单/截止线兼容。新Task拒绝缺README、错schema、非法`actionIssueId`和`parentTaskId`/`actionIssueIds`/`issueIds`。
- 旧`verifyPostMergeUnifiedReviewContract()` clean cutover为`verifyLeaderDrivenDevelopmentContract()`；检查覆盖12份canonical合同，并用表驱动mutation拒绝PM/claimed前置、planned直接授权受限动作、draft执行以及Task/PR/Reviewer/CI单独导致Project Done。
- Issue #191及其产品计划保持暂停；本Task不修改产品代码或产品Spec。

## 验证证据

- 初始RED：聚焦测试为37 passed / 3 failed；失败仅为`design`尚未合法及新verifier未实现。
- 中间GREEN：实现首轮合同后为40 passed / 40；后续增强到43 passed / 43。
- 最终聚焦测试：`bun x vitest run --config scripts/vitest.config.ts scripts/ci/agent-governance.test.ts`，47 passed / 47。
- `bun run docs:check`：通过，`failures: []`，`checkedFiles: 5305`。
- `bun run governance:check`：通过，`failures: []`、`warnings: []`。
- `git diff --check`：退出码0；仅输出工作区换行转换warning。
- 独立Reviewer两次因基础设施返回`404 Model "gpt-5.6-luna" is not supported by any configured account in this group`，未形成Reviewer通过证据。
- fresh-context限定终审只复核Issue草稿恢复、双Task root、聚合字段和反向mutation四项；结论`建议合并`，`findings: []`、`residualRisks: []`。该结论不是独立Reviewer walkthrough。
- 完成时间：`2026-08-26T19:19:25+08:00`。

## 工作区边界

检查时工作区包含本Task外既有差异。本报告只认领本Task角色、流程、Task、Proposal/Spec规则、Issue草稿规则、`.gitignore`治理allowlist和治理脚本改动；不把其它差异写成Task产物。`.agents/skills/report/SKILL.md`本轮只删除文件尾多余空行，其余已有diff不归入本Task。
