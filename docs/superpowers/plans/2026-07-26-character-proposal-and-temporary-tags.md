# Character Proposal 保存与临时角色 Tag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让角色视觉 Proposal 以正确 Project 身份持久化，并使无已登记角色的正文镜头通过 resolver 的临时 Tag 正常生成。

**Architecture:** 角色迁移 service 在所有写入边界保持 `projectPath` 和 Project Workspace root 的配对，生产 store 只将这对身份转换为 `WorkspaceFileTarget`。正文生图不增加新的持久化模型：空角色镜头把经 resolver 终结的临时视觉 Tag 写进已有 `tagDelta`，由现有 compiler 生成全局 prompt。

**Tech Stack:** TypeScript、Vitest、Zod、Nuxt/Tauri、既有 Workspace History 与 Tag Resolver。

## Global Constraints

- 所有角色迁移写入都必须使用 `{kind: "project-workspace", projectPath, root}`，不得由绝对路径反推 Project 身份，也不得使用 `any`。
- 临时角色 Tag 仅能以当前 run 的 terminal resolution ID 出现在 `Shot.tagDelta`，不能创建角色档案或直接提交自由 Tag 字符串。
- 已登记角色继续走 `characterIds` 和固定角色视觉通道；无已登记角色时 `characterIds`、`action` 为空。
- Bun 测试、构建和 Portable 打包命令在沙盒外执行。

---

### Task 1: 修复角色 Proposal 的 Project 写入边界

**Files:**
- Modify: `server/text-to-image/character-visual-migration.service.ts`
- Test: `server/text-to-image/character-visual-migration-ui-contract.test.ts`
- Test: `server/text-to-image/character-visual-migration.service.test.ts`

**Interfaces:**
- Consumes: `WorkspaceFileTarget`、`writeWorkspaceTextFileTracked()`。
- Produces: `CharacterVisualMigrationFileStore.write()` 接受 `{projectPath, root, filePath, content, knownBefore}`，且 `project()` 返回同一 Project 身份。

- [ ] **Step 1: 写入失败的回归断言**

在 `character-visual-migration-ui-contract.test.ts` 增加 source contract：生产 store 必须出现 `target: {kind: "project-workspace", projectPath: input.projectPath, root: input.root}`，且不得包含嵌套 `writeWorkspaceTextFileTracked(writeWorkspaceTextFileTracked` 或 `as any`。在 migration service test 的 MemoryStore 写入记录中断言 Director proposal 仍带入 `projectPath: "workspace/demo"`。

- [ ] **Step 2: 运行红灯测试**

Run: `bunx vitest run server/text-to-image/character-visual-migration-ui-contract.test.ts server/text-to-image/character-visual-migration.service.test.ts`

Expected: 新增 target 合同断言失败，现有 Proposal 生命周期测试保持可运行。

- [ ] **Step 3: 实现最小的身份传递修复**

将 store `write()` 和 `invalidate()` 的参数改为携带 `projectPath`；`project()` 返回 `{projectPath, root}`。全部 service 写入点传递这两项。生产 store 单次调用：

```ts
await writeWorkspaceTextFileTracked({
    target: {kind: "project-workspace", projectPath: input.projectPath, root: input.root as AbsoluteFsPath},
    filePath: input.filePath,
    content: input.content,
    knownBefore: input.knownBefore,
    actor: USER_LOCAL_ACTOR,
});
```

索引失效接收同一个 target。删除嵌套函数调用与 `any` 转换。

- [ ] **Step 4: 运行绿灯测试**

Run: `bunx vitest run server/text-to-image/character-visual-migration-ui-contract.test.ts server/text-to-image/character-visual-migration.service.test.ts`

Expected: 0 failed；Director proposal 的持久化、预览、迁移决策回归通过。

### Task 2: 允许无角色镜头使用临时 Tag

**Files:**
- Modify: `assets/workspace/.nbook/agent/profiles/builtin/illustration.director.profile.tsx`
- Modify: `assets/workspace/.nbook/agent/skills/chapter-illustration-direction/SKILL.md`
- Modify: `server/agent/profiles/illustration-director-assets.test.ts`
- Modify: `server/text-to-image/illustration-compiler.test.ts`

**Interfaces:**
- Consumes: `ShotIntentCore.characterIds`、`ShotIntentCore.action`、`tagDelta` 和 terminal `SemanticTagResolution`。
- Produces: 无角色镜头的 prompt 只使用全局 resolved Tag，`characterPrompts` 为空。

- [ ] **Step 1: 写入失败的临时 Tag 合同测试**

在 Director asset test 读取 Profile 与 Skill 的源码，断言两者包含“无已登记角色”“`characterIds`/`action` 为空”和“terminal resolution”的规则。在 compiler test 构造 `characterIds: []`、`action: {}`、空 outfit、空 registry、含 `transientFigure` resolution 的 Shot，并断言执行结果的 `characterPrompts` 为空、prompt 包含该 resolution 的 wire text。

- [ ] **Step 2: 运行红灯测试**

Run: `bunx vitest run server/agent/profiles/illustration-director-assets.test.ts server/text-to-image/illustration-compiler.test.ts`

Expected: Profile/Skill 的新行为合同断言失败；compiler 的无角色实例确认现有结构不阻塞。

- [ ] **Step 3: 仅补充 Director 行为合同**

在 Profile 的 plan-chapter / plan-selection 说明和 Skill 的操作规则中同时加入：未匹配已登记角色时，不阻塞；保持空角色 ID 和 action；调用 resolver 取得临时外貌/服装 Tag 的 terminal resolution，再引用到当前 Shot `tagDelta`；不得提交自由字符串或写角色档案。不得改动 schema、compiler、角色 registry 或 resolver 策略。

- [ ] **Step 4: 运行绿灯测试**

Run: `bunx vitest run server/agent/profiles/illustration-director-assets.test.ts server/text-to-image/illustration-compiler.test.ts`

Expected: 0 failed；已登记角色编译回归和无角色临时 Tag 编译均通过。

### Task 3: 更新任务记录、整体验证与重新打包

**Files:**
- Modify: `docs/tasks/text-to-image-panel/README.md`
- Modify: `PROJECT-STATUS.md`

- [ ] **Step 1: 记录根因与行为边界**

在原文本生图任务 walkthrough 中记录 Proposal 的 `target.kind` 根因、显式 Project target 修复、临时 Tag 的生命周期及不写角色档案边界；在 `PROJECT-STATUS.md` 同步模块状态。

- [ ] **Step 2: 运行受影响测试与类型检查**

Run: `bunx vitest run server/text-to-image/character-visual-migration-ui-contract.test.ts server/text-to-image/character-visual-migration.service.test.ts server/agent/profiles/illustration-director-assets.test.ts server/text-to-image/illustration-compiler.test.ts && bun run typecheck`

Expected: 全部测试 0 failed，typecheck exit 0。

- [ ] **Step 3: 重新构建 Portable EXE**

Run: `bun run nuxt:build`, `bun run product:stage`, `bun run desktop:tauri`, `bun run desktop:assemble`

Expected: 四条命令均 exit 0；产物为 `dist/neuro-book-desktop-x64/NeuroBook.exe`。

- [ ] **Step 4: 核验产物内容**

Run: 在 `dist/neuro-book-desktop-x64/product/.output` 中精确检索 Project target 写入与临时 Tag 合同文本。

Expected: server payload 与 client payload 都来自本轮源代码；不自动启动 EXE 或浏览器。
