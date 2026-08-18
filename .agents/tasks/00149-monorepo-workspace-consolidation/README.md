---
schema: nbook.task/v1
taskId: 00149-monorepo-workspace-consolidation
actionIssueId: null
worktreeId: .worktree/monorepo-main-app-migration
branchId: chore/t149-monorepo-workspace
status: verifying
createdAt: 2026-08-16T14:59:07Z
updatedAt: 2026-08-18T12:02:00Z
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

S0 已完成基线提交、annotated tag 与专用迁移 worktree；S1 测试支持、治理门禁、显式 workspace 清单和冻结安装已完成；S2 已按 S0 manifest 将六个自治项目收编到 `packages/*`，保留 llmlint 的 `web`/`skill` 独立安装岛，完成逐文件摘要复核、自治治理资产、根忽略和 workspace lock 更新；S3 已删除 History/Workflow vendor、同步脚本和 llmlint tracked mirror，主应用切换正式 workspace 包入口，`packages/llmlint/skill` 成为唯一 Skill source 并接入 system assets projection，History/Workflow/llmlint/Product closure 与 root 全量回归通过；S4 已完成 Desktop 聚合 depot/卸载回执纯合同抽取、Shared/Manager 宿主适配器切换、Portable packager Manager 正式子路径入口和 scripts 可承载项迁移，并由 clean worktree 确认 checkpoint `00dacf89`；S5 已完成应用 identity-only manifest、repository/application 双根 resolver、平台用户级 Source Dev State/Cache 默认、Prisma application-root 路径和 Manager fixture 解耦，并由 clean worktree 确认 checkpoint `b3d202ff`。S6 workflow 侧道已完成：nb-workflow 0.2.0 SHA-256 fingerprint 与 canonical `params` 观测侧道已接入 NeuroBook，公共 Run/event projection 保持 prompt/正文隐私，应用与包验证完成。主应用全量命令必须使用 `bun --cwd packages/neuro-book test -- --retry=3`；本轮实际结果为 `1 file failed / 415 passed / 1 skipped; 3082 passed / 3 skipped`，失败是 `profile-sdk-contract.test.ts` 的合并后依赖边界回归。根 `package.json` 没有 `test` script，`bun run test -- --retry=3` 未执行根全量测试，不作为通过证据。S6 以 `green-focused-with-inherited-blockers` 记录，不晋升 clean-green。

## S6 证据

- `evidences/s6-workflow-params-summary.json` 记录 fingerprint/params 合同、实际命令结果、已批准 T02 计划外例外和未验收边界。
- `walkthroughs/010-leader-2026-08-18-workflow-params-side-channel.md` 记录本轮实现、验证、合并后门禁与 T02 处置更新。
- 用户已选择“批准并继续”：允许承认已发生的 `0fdec90bac0456b67045185c99cb8b829e75bd6c` 计划外源仓提交，并仅使用其等价内容作为迁移输入；不允许新的原仓写操作。
- 原仓 T02 immutability gate 不宣称 clean-green，作为用户批准的计划外例外保留；主仓本地迁移提交 `ba694892a21fec57cfc176f43819f84fef3fdbc1` 已完成，随后显式 merge `origin/master` 生成 `da3343919b52a482d562140517f8e4cd6229b9e3`；当前 S6 evidence 状态为 `green-focused-with-inherited-blockers`，不宣称绿色验收。
- `bun run governance:check` 无 failures/warnings；`bun run test:desktop-contract` 实际为 11 files / 37 tests passed。此前的 4 个 ENOENT 是修复前结果，不属于当前 S6 失败项。
- `docs:build` 的 15 个 dead links、`packages/llmlint` 两个稳定失败、主应用 profile SDK 依赖边界失败和 Windows portable clean-checkout 限制均未用修改掩盖。
- 最后一次治理复跑先因主应用测试生成 `packages/neuro-book/.agent` 失败，删除该未跟踪运行态目录后，`bun run governance:check` 返回 `failures=[]`、`warnings=[]`；该治理结果需与本轮 evidence 提交一起复核。
