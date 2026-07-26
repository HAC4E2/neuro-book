# Provider Model API Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让模型配置“一键修复”能用用户明确选择的 Provider 默认 Pi API 补齐已有模型的空白 API，并重新打包 Windows Desktop。

**Architecture:** 在 `model-settings-draft.ts` 增加纯草稿修复函数，返回精确 repair evidence；draft session 在 Model Library 补全前应用它。UI 文案增加模型 API 修复数量，不改变保存接口或配置合同。

**Tech Stack:** Vue 3、Nuxt 4、TypeScript、Vitest、Bun、Tauri。

## Global Constraints

- 只补空白模型 API，不覆盖非空值。
- 只消费 `SUPPORTED_PI_APIS` 中的 Provider 默认值。
- 重复 Provider/model ID 跳过。
- 不直接修改用户 `config.json`；用户仍需手动保存草稿。
- Bun 命令在沙盒外执行；最终产物输出到 `dist/neuro-book-desktop-x64`。
- 不执行 Git 提交。

---

### Task 1: 草稿层确定性模型 API 修复

**Files:**
- Modify: `app/components/novel-ide/settings/model-settings-draft.ts`
- Modify: `app/components/novel-ide/settings/model-settings-draft.test.ts`

**Interfaces:**
- Produces: `repairMissingModelApis(draft): ModelApiRepair[]`，原地只补空白 API并返回 Provider/model/API 证据。

- [ ] 写四类红灯测试：补空值、不覆盖非空值、无效默认值跳过、重复 ID 跳过。
- [ ] 运行 `bunx vitest run app/components/novel-ide/settings/model-settings-draft.test.ts`，确认因缺少行为失败。
- [ ] 实现最小修复函数并重跑测试转绿。

### Task 2: 接入一键修复与反馈

**Files:**
- Modify: `app/components/novel-ide/settings/useModelSettingsDraftSession.ts`
- Modify: `app/components/novel-ide/settings/useModelSettingsDraftSession.test.ts`
- Modify: `app/i18n/locales/zh-CN.ts`
- Modify: `app/i18n/locales/en-US.ts`

**Interfaces:**
- Consumes: `repairMissingModelApis(draft)`。
- Produces: repair 流程先补模型 API，再做 Model Library 能力补全；结果通知包含 `modelApiRepaired`。

- [ ] 写组合红灯，证明一次 repair 能先补 API、再补 Library 能力。
- [ ] 实现 session 调用顺序与中英文计数文案。
- [ ] 运行 draft/session 聚焦测试转绿。

### Task 3: 验证、文档与重新打包

**Files:**
- Modify: `docs/tasks/104-pi-models-runtime-upgrade/README.md`
- Modify: `RELEASE.md`

- [ ] 运行模型设置聚焦测试与 `bun run typecheck`。
- [ ] 运行 `bun run nuxt:build`，确认客户端边界守卫通过。
- [ ] 更新 walkthrough 与 release notes，记录实际结果和计划偏差。
- [ ] 运行 `bun run product:stage`、`bun run desktop:tauri`、`bun run desktop:assemble`。
- [ ] 核对最终 EXE、用户数据保留、namespace 迁移与 HTTP smoke；不自动执行浏览器交互验收。

### Task 4: 旧配置 API 显式物化迁移

**Files:**
- Modify: `server/config/normalizer.ts`
- Modify: `server/config/normalizer.test.ts`
- Modify as needed: `server/config/config-service.test.ts`

- [ ] 写红灯测试：Provider/模型 API 全空时显式变为 `openai-completions`。
- [ ] 写保护测试：明确的 Provider/模型 API 保留；无效非空 Provider API 不被静默覆盖。
- [ ] 实现 stored config 归一化边界的最小迁移。
- [ ] 验证编辑快照/保存链路输出显式 API。
- [ ] 重跑类型检查、完整 Product build 和 Windows Portable 打包验证。
