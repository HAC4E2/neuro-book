# 任务上下文

生成时间：2026-08-16T14:59:07Z

## 基线快照

- 当前 root 工作树提交：`d1772041a8d41fb2d819287e0acca9f01336ed0e`。
- baseline tag：`monorepo-main-app-migration-baseline-d1772041a8d41fb2d819287e0acca9f01336ed0e`。
- 迁移分支：`chore/t149-monorepo-workspace`；worktree：`.worktree/monorepo-main-app-migration`。
- `origin/master`：`5e55c54e13cd67f6e19c5361931fca1fe9ae4241`；baseline 不追赶远端，也不覆盖 root 用户改动。
- baseline 提交只包含已完成治理迁移、任务合同与 S0 摘要证据；root 未暂存用户改动不在其中。

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

## S0 结果

1. root 工作树的 status、暂存/未暂存 diff hash、未跟踪文件 path/bytes/SHA-256已记录在 `evidences/s0-baseline-summary.json` 及其系统临时 full evidence。
2. `bun run governance:check`、`bun run test`、`bun run docs:build`、`git diff --check && git diff --cached --check`均退出 0。
3. baseline commit/tag/worktree已创建，原 root 工作树未 reset、stash、checkout 或清理。
4. 下一步重新核对六个原 checkout 并建立只读 import manifest；任何原仓聚焦验证失败都停止该包收编。
