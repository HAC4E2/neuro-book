---
schema: nbook.task/v1
taskId: 00149-monorepo-workspace-consolidation
actionIssueId: null
worktreeId: .worktree/monorepo-main-app-migration
branchId: chore/t149-monorepo-workspace
status: in-progress
createdAt: 2026-08-16T14:59:07Z
updatedAt: 2026-08-16T17:26:39Z
---

# NeuroBook Workspace 收敛与主应用迁移

## 目标

按已批准的 `local://monorepo-main-app-migration-plan.md`，把 NeuroBook 收敛为单一 monorepo：主应用迁入 `packages/neuro-book`，六个独立项目收编为 workspace，跨宿主合同和测试基础设施拆成私有包，root 只保留 workspace、产品编排、发布和治理入口。

## 执行范围

- S0–S8 全部阶段、检查点和恢复规则。
- 原六个 checkout 只读取并导入快照；不修改、推送、归档、重命名或发布原仓。
- 根用户工作树现有改动作为输入保留；实现只在迁移分支/worktree进行。
- 浏览器、Docker、Windows runner、真实 provider/model、私有 corpus、远端部署和发布按计划的可执行/未验收边界记录。

## 权威来源

- 批准计划：`local://monorepo-main-app-migration-plan.md`
- 当前治理规则：根 `AGENTS.md`、`.agents/tasks/README.md`、`.agents/tasks/AGENTS.md`、相关作用域 `AGENTS.md`
- 当前产品规范：`docs/specs/` 注册表及其指向正文

## 检查点

`S0-baseline-and-import-manifests`、`S1-common-governance-and-test-support`、`S2-import-independent-projects`、`S3-single-source-integrations`、`S4-cross-host-boundaries`、`S5-application-identity-roots-source-dev-prisma`、`S6-main-app-physical-cutover`、`S7-build-release-ci`、`S8-final-monorepo-workspace`。

## 完成标准

每个阶段聚焦验证、共同安装/治理门禁和阶段新增行为检查通过后才进入下一个阶段；失败保留现场并按计划从上一绿色检查点恢复。交付报告逐项列出实际命令、结果、未运行项、阻塞和数据不变性证据；不自行 push、merge、发布或删除用户数据。

## 当前状态

S0 已完成基线提交、annotated tag 与专用迁移 worktree；S1 测试支持、治理门禁、显式 workspace 清单和冻结安装已完成，下一检查点为六个自治项目收编。后续实现仍只在 `chore/t149-monorepo-workspace` / `.worktree/monorepo-main-app-migration` 进行；root 用户 worktree 的既有改动和六个原仓保持原地。
