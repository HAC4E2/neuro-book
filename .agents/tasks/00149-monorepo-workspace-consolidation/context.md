# 任务上下文

生成时间：2026-08-16T14:59:07Z

## 基线快照

- 当前 root 分支：`master`
- 当前 `HEAD`：`306e563ad7a4d4a58354fa8d582ad9aa9b886e8c`
- 已获取 `origin/master`；执行前以当前引用重新读取。
- 当前工作树存在 994 个暂存路径、543 个未暂存路径和 247 个未跟踪路径计数（Git 状态分层必须保留，不能 reset/stash/checkout 清理）。
- `.agents/tasks/.migration-complete` 记录上一轮治理迁移的来源修订与清单摘要；其列出的 local-only benchmark JSON 不得提交。

## 任务输入

- 权威执行计划：`local://monorepo-main-app-migration-plan.md`。
- 用户明确批准计划后执行；批准不扩大计划范围。
- 根现有用户内容、`.env`、`config.yaml`、`workspace/`、`.local/`、既有停工 worktree 和六个原仓均为不可覆盖输入。

## 目标拓扑摘要

- root private orchestrator：无产品 `version`，显式列 12 个 workspace。
- `packages/neuro-book`：唯一产品身份与 Nuxt/Prisma 应用命令。
- `packages/neuro-book-contracts`：跨宿主纯合同。
- `packages/neuro-book-test-support`：测试临时根、路径、marker 和 Vitest 薄适配器。
- 六个自治项目各自保留 README、Task/docs、状态与项目专属验证；共享治理只引用根规则。
- `desktop/electron`、`packages/llmlint/web`、`packages/llmlint/skill` 保持独立安装岛。

## 数据与恢复

所有 Agent/test/fixture/browser/build scratch 使用系统临时根或明确 owner 目录。任何失败创建 `recovery/monorepo-main-app-migration-<phase>-<timestamp>` 现场并从上一绿色检查点新建修复 worktree；禁止 reset、stash、checkout 清理或 junction。

## S0 待办

1. 记录 root 工作树 status、暂存/未暂存 binary diff hash、未跟踪文件 path/bytes/SHA-256。
2. 运行基线 governance、test、docs build、diff check；失败保留原始结果。
3. 在得到用户批准的范围内提交当前已完成治理迁移作为 baseline，并创建迁移分支/worktree；不把未暂存用户改动带入 baseline。
4. 重新核对六个原 checkout 的 branch/HEAD/upstream/dirty/status，并在系统临时根建立逐文件 import manifest；原仓只读验证。
