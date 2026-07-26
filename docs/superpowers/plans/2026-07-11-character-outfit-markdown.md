# Character Outfit Markdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每个角色建立独立服装 Markdown 文件、LLM 多服装解析和正文生图按镜头注入服装 Tag 的完整链路。

**Architecture:** `image-tags.md` 只解析服装链接索引，独立的服装 Markdown 工具负责四部位数据，服务端角色包加载器跟随索引读取服装文件。角色生成服务解析 JSON 或 `<服装>` 块并写入文件，Prompt 编译器只消费已加载的结构化服装数据。

**Tech Stack:** TypeScript、Nuxt/Nitro、Zod、Vitest、Project Workspace 文件 API。

## Global Constraints

- 服装名称格式固定为 `服装中文名称/服装英文名称`。
- 每个角色的服装文件放在角色目录的 `outfits/` 下。
- 每件服装包含上半身、上半身背面、下半身、下半身背面四组 Tag。
- `image-tags.md` 的服装列表只做显式 Markdown 链接索引。
- 保留现有提示词替换链路，不恢复旧服装管理面板。
- 使用现有依赖，不新增包。

---

### Task 1: 服装 Markdown 数据契约

**Files:**
- Create: `app/utils/text-to-image-outfit-tags.ts`
- Create: `app/utils/text-to-image-outfit-tags.test.ts`
- Modify: `app/utils/text-to-image-character-tags.ts`
- Modify: `app/utils/text-to-image-character-tags.test.ts`

**Interfaces:**
- Produces: `TextToImageOutfitTag`、`parseTextToImageOutfitTags()`、`renderTextToImageOutfitTagsMarkdown()`。
- Produces: 角色服装索引项 `{nameCn, nameEn, sourcePath}`。

- [x] **Step 1: 写失败测试**

覆盖独立服装文件四分区往返解析，以及 `image-tags.md` 中 `中文/英文` Markdown 链接的解析和渲染。

- [x] **Step 2: 运行测试确认失败**

Run: `bunx vitest run app/utils/text-to-image-outfit-tags.test.ts app/utils/text-to-image-character-tags.test.ts`

Expected: 新模块缺失或新断言失败。

- [x] **Step 3: 实现最小 Markdown 解析与渲染**

新增强类型服装结构，解析四个标题分区；角色解析器只保留服装名称和明确的相对文件路径。

- [x] **Step 4: 运行测试确认通过**

Run: `bunx vitest run app/utils/text-to-image-outfit-tags.test.ts app/utils/text-to-image-character-tags.test.ts`

Expected: 两个测试文件全部通过。

### Task 2: LLM 回复解析与服装文件写入

**Files:**
- Create: `app/utils/text-to-image-outfit-design.ts`
- Create: `app/utils/text-to-image-outfit-design.test.ts`
- Modify: `server/text-to-image/character-image-tags.ts`
- Modify: `server/text-to-image/character-image-tags.test.ts`

**Interfaces:**
- Consumes: `TextToImageOutfitTag` 和服装 Markdown 渲染器。
- Produces: `parseTextToImageOutfitDrafts(content)`，支持 JSON `outfits[]` 与多个 `<服装>` 块。
- Produces: 生成结果中的 `outfitPaths` 和无效归属警告。

- [x] **Step 1: 写失败测试**

覆盖样例 `<服装>` 块、结构化 JSON、多服装解析、角色索引合并和服装 Markdown 输出。

- [x] **Step 2: 运行测试确认失败**

Run: `bunx vitest run app/utils/text-to-image-outfit-design.test.ts server/text-to-image/character-image-tags.test.ts`

Expected: 新解析器缺失，角色生成结果尚不含服装。

- [x] **Step 3: 实现解析与写入服务**

扩展默认 LLM 输出契约；解析回复中的服装；读取已有 `image-tags.md` 保留未返回索引；写入 `outfits/<安全中文名>.md`；把链接写回角色文件。

- [x] **Step 4: 运行测试确认通过**

Run: `bunx vitest run app/utils/text-to-image-outfit-design.test.ts server/text-to-image/character-image-tags.test.ts`

Expected: 两个测试文件全部通过。

### Task 3: 角色包加载与 Prompt 编译

**Files:**
- Modify: `server/text-to-image/body-image-character-tags.ts`
- Modify: `server/text-to-image/body-image-character-tags.test.ts`
- Modify: `server/text-to-image/prompt-compiler.ts`
- Modify: `server/text-to-image/prompt-compiler.test.ts`

**Interfaces:**
- Consumes: 角色服装索引和 `parseTextToImageOutfitTags()`。
- Produces: 已加载四部位 Tag 的角色 `outfits`。
- Produces: 按 `view` 与 `framing` 选择服装部位的最终 Prompt。

- [x] **Step 1: 写失败测试**

覆盖服装链接文件加载，以及正面、背面、上半身、下半身、全身五种编译选择。

- [x] **Step 2: 运行测试确认失败**

Run: `bunx vitest run server/text-to-image/body-image-character-tags.test.ts server/text-to-image/prompt-compiler.test.ts`

Expected: 服装文件尚未加载，编译结果仍只有英文服装名。

- [x] **Step 3: 实现服装加载与确定性选择**

在 Project Workspace 内安全解析相对路径并读取服装 Markdown；编译器根据镜头选择四分区 Tag，不再把英文名称当作服装细节。

- [x] **Step 4: 运行测试确认通过**

Run: `bunx vitest run server/text-to-image/body-image-character-tags.test.ts server/text-to-image/prompt-compiler.test.ts`

Expected: 两个测试文件全部通过。

### Task 4: Skill、文档与回归验证

**Files:**
- Modify: `assets/workspace/.nbook/agent/skills/character-image-tag-generation/SKILL.md`
- Modify: `docs/tasks/text-to-image-panel/README.md`
- Modify: `PROJECT-STATUS.md`

**Interfaces:**
- Consumes: 前三项的最终 Markdown 与运行时契约。
- Produces: 用户资产中的稳定操作说明和仓库状态记录。

- [x] **Step 1: 更新 Skill 与任务文档**

记录角色服装目录、索引格式、LLM 多服装解析、保留未返回服装和编译选择规则。

- [x] **Step 2: 运行聚焦测试**

Run: `bunx vitest run app/utils/text-to-image-outfit-tags.test.ts app/utils/text-to-image-outfit-design.test.ts app/utils/text-to-image-character-tags.test.ts server/text-to-image/character-image-tags.test.ts server/text-to-image/body-image-character-tags.test.ts server/text-to-image/prompt-compiler.test.ts`

Expected: 全部通过。

- [x] **Step 3: 运行类型检查**

Run: `bun run typecheck`

Expected: 退出码为 0；若出现与本轮无关的既有错误，单独报告而不改动无关模块。
