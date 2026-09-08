# Issue 226 交付记录

## 结果

- 在 `scripts/deploy/product-runtime.mjs` 导入现有 `ProductRuntimeImageBuilder`，`openVerifiedImage()` 继续调用 Builder 的唯一 `openVerified()` 验证入口。
- 补齐同一脚本原先使用但缺失的 `PRODUCT_BUN_RUNTIME_ARGS` 与 `PRODUCT_RUNTIME_COMMAND_BOOTSTRAP` 合同导入，保证 stage 后的既有 `product:start` 路径继续可执行。
- 在 `scripts/build/product-runtime-contract.test.ts` 增加导入合同断言。

## 验证

- `bun run product:stage`，注入 `NBOOK_AGENT_TEMP_ROOT=C:/Users/notnotype/AppData/Local/Temp/neuro-book/issue-226-stage` 与现有 `.output`，成功输出 staged acceptance 实例：`C:/Users/notnotype/AppData/Local/Temp/neuro-book/issue-226-stage/acceptance/product-runtime/acceptance-20260908003732034-2b72e225-f911-450e-b168-450c1ca59fc9`。
- 使用该 acceptance 根运行 `bun run product:start -- --help`：已进入 staged Product command bundle，返回预期的 `Product Runtime command start 不接受额外参数。`，不再出现 `ProductRuntimeImageBuilder is not defined` 或 `PRODUCT_BUN_RUNTIME_ARGS is not defined`。
- `bun x vitest run --config scripts/vitest.config.ts scripts/build/product-runtime-contract.test.ts scripts/deploy/product-runtime-cleanup.test.ts`：2 个文件、7 个测试通过。
- `bun run docs:check`：`failures: []`，`checkedFiles: 5402`。
- `bun --check scripts/deploy/product-runtime.mjs`：通过。
- `git diff --check HEAD~3..HEAD`：通过。

## 差异与未运行项

- 初次 `product:start` 运行暴露同一脚本已有但未导入的两个 Product Runtime 合同常量；该范围属于 Issue #226 所要求的既有 start 生命周期验证，已按现有公开合同补齐，没有改变行为或绕过校验。
- 未运行完整 Product Runtime 重建、完整 `product-start.test.ts`（其构建与启动耗时高），也未运行全量 `bun run test`；Issue 范围内的 stage、start 入口、合同和 cleanup 聚焦证据已完成。
- 未执行远端 Issue/PR 写入、push、合并、发布、部署或浏览器人工验收。

## Revision

- Work 登记：`b7af9a6b`
- 实现提交：`22942a74`、`b4c1138d`、`a7d87c94`
- 当前 HEAD：`a7d87c94`
- Branch：`fix/i226-product-runtime-builder-import`
- Worktree：`.worktree/w00011-issue-226-product-runtime-builder-import`
