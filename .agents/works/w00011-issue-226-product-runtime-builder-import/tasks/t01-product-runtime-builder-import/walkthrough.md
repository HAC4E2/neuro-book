# Issue 226 交付记录

## 结果

- 在 `scripts/deploy/product-runtime.mjs` 导入现有 `ProductRuntimeImageBuilder`，`openVerifiedImage()` 继续调用 Builder 的唯一 `openVerified()` 验证入口。
- 补齐同一脚本原先使用但缺失的 `PRODUCT_BUN_RUNTIME_ARGS` 与 `PRODUCT_RUNTIME_COMMAND_BOOTSTRAP` 合同导入，保证 stage 后的既有 `product:start` 路径继续可执行。
- 在 `scripts/build/product-runtime-contract.test.ts` 增加导入合同断言。

## 验证

- `bun run product:stage`，注入 `NEURO_BOOK_OUTPUT_DIR=C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/.output` 与 `NBOOK_AGENT_TEMP_ROOT=C:/Users/notnotype/AppData/Local/Temp/neuro-book/issue-226-final-stage`，成功输出 staged acceptance 实例：`C:/Users/notnotype/AppData/Local/Temp/neuro-book/issue-226-final-stage/acceptance/product-runtime/acceptance-20260908004817990-2a823b7f-2731-476e-a6c9-630d302f467c`。
- 使用该 acceptance 根运行 `bun run product:start -- --help`：已进入 staged Product command bundle，返回预期的 `Product Runtime command start 不接受额外参数。`，不再出现 `ProductRuntimeImageBuilder is not defined` 或 `PRODUCT_BUN_RUNTIME_ARGS is not defined`。
- 尝试真实 HTTP Product start：进程进入既有 migration/application-state 启动门禁后按合同失败，因为受控 State Root 尚未迁移；日志明确要求 `bun run migrate:application-state -- --apply`。未绕过该门禁。
- `bun x vitest run --config scripts/vitest.config.ts scripts/build/product-runtime-contract.test.ts scripts/deploy/product-runtime-cleanup.test.ts`：2 个文件、7 个测试通过。
- `bun run docs:check`：`failures: []`，最终 `checkedFiles: 5403`。
- `bun --check scripts/deploy/product-runtime.mjs`：通过。
- `git diff --check HEAD~4..HEAD`：通过。

## 差异与未运行项

- 初次 `product:start` 运行暴露同一脚本已有但未导入的两个 Product Runtime 合同常量；该范围属于 Issue #226 所要求的既有 start 生命周期验证，已按现有公开合同补齐，没有改变行为或绕过校验。
- 完整 HTTP start 未进入监听：既有 state migration/application-state gate 按预期 fail closed；未执行迁移，因为数据库迁移属于独立受限动作且 Issue #226 不要求改变该门禁。
- 未运行完整 Product Runtime 重建、完整 `product-start.test.ts`（其构建与启动耗时高），也未运行全量 `bun run test`；Issue 范围内的 stage、start 入口、合同和 cleanup 聚焦证据已完成。
- 未执行远端 Issue/PR 写入、push、合并、发布、部署或浏览器人工验收。

## Review

- 变更只触及现有部署脚本导入和对应合同测试；未改变 Builder 验证、acceptance lease、owner、pointer、containment 或清理实现。
- 无新增依赖、无用户输入放宽、无路径旁路、无生成物改动。

## Revision

- Work 登记：`b7af9a6b`
- 实现提交：`22942a74`、`b4c1138d`、`a7d87c94`
- 交付记录提交：`7ebdebcd`
- 当前 HEAD：`7ebdebcd`
- Branch：`fix/i226-product-runtime-builder-import`
- Worktree：`.worktree/w00011-issue-226-product-runtime-builder-import`
