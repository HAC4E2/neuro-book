# Tool/Tail 对齐施工记录

## 实际范围

- 从固定上游 commit `3138b2c7f24b01c65b72389e2ff7502bd4ee9030` 提取唯一 Tool/Tail 默认常量，未执行上游 `index.js`。
- 增加共享 DTO、全局默认、Provider 完整覆盖/继承 resolver，并保留显式 `false`、空数组、原文和顺序。
- 共用非流式 JSON、SSE 分片/CRLF/无末尾换行/`[DONE]`/截断错误解码；Tool 关闭不发送 tools/tool_choice/Tail；动态名称在重试前生成一次。
- 接通正文、角色设计、角色展示、角色修改、角色照片和 Tag 修改五类 LLM 调用；预览返回最终 `messages`、`tools`、`tool_choice`。
- 设置页增加全局和 Provider Tool/Tail 编辑、继承/覆盖、恢复默认、独立导入导出；全局导入导出与持久化包含两项配置。
- 取消逻辑同时覆盖 fetch 抛出的 AbortError、provider-fetch 包装错误和 429/5xx 重试等待定时器。

## 实际改动入口

- `packages/neuro-book/shared/text-to-image-toolcall-defaults.ts`
- `packages/neuro-book/shared/dto/text-to-image.dto.ts`
- `packages/neuro-book/server/text-to-image/llm-toolcall-config.ts`
- `packages/neuro-book/server/text-to-image/llm-toolcall-response.ts`
- `packages/neuro-book/server/text-to-image/llm-chat.ts`
- `packages/neuro-book/server/text-to-image/llm-context.ts`
- `packages/neuro-book/server/text-to-image/{body-image-llm,character-visual-llm,character-photo-llm,tag-modify-llm}.ts`
- `packages/neuro-book/server/api/text-to-image/llm/{preview.post,test.post}.ts`
- `packages/neuro-book/app/components/novel-ide/text-to-image/TextToImageLlmSettingsSection.vue`
- `packages/neuro-book/app/utils/text-to-image-tool-config-import.ts`
- 对应 DTO、normalizer、Tool/Tail 导入及解码测试。

## 验证

- 本地生成 Prisma client 后，临时关闭仓库既有 system assets global setup 的聚焦 Vitest 共 11 个文件、123 项测试通过；同步 HAC4E2 master 后同一范围扩展为 12 个文件、125 项测试通过。
- 现有 UI 合同测试覆盖旧全局配置输入；发现并修复缺失 Tool/Tail 字段时的默认补齐问题，3 个 UI 文件、23 项测试通过。
- `typecheck`、`docs:check`、`bun install --frozen-lockfile --linker hoisted` 和目标文件 `git diff --check` 均通过；实现 worktree 在合并前的 `governance:check` 通过，主工作区最终复跑发现 4 项既有治理问题；完整原始 Vitest 仍被既有 system assets freshness setup 阻塞。

## 约束与偏差

- 没有运行真实 Provider/Model、浏览器人工验收、数据库迁移、`index.js`、PR 或发布；已完成 HAC4E2 `origin/master=106f5e7b` 合并（`4faa1205`）并 push 到 `new-text-to-picture`。
- 实现最初位于 `.worktree/w00007-chatu8-toolcall-alignment`；逐文件核对确认当前分支已通过 `0e71893e` 带入与 `0ac96723` 完全一致的 20 个功能文件，因此没有重复 cherry-pick；Work/Task 计划与证据保留在主工作区。
- 用户提供的两个 JSON 仅作只读兼容样本；未自动绑定、复制或改写其上下文内容。