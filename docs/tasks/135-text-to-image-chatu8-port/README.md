# 文生图移植计划：对标 chatu8（独立工作台 + LLM 交互层）

> Active task directory format: `NN-kebab-case-name/`。归档时移到 `docs/tasks/archived/`。
> 本计划在**干净上游 master（notnotype/neuro-book，无文生图代码）**之上实现；基础件从参考分支迁移适配，LLM 交互层新写，对标 chatu8 体验。

## Relative documents refs

- `docs/research/st-chatu8-capability-matrix.md`：chatu8 全部能力清单 + LLM 生图链路（移植逐项对照）。
- `.agent/workspace/chatu8-presets/`：用户导出的 4 个 chatu8 上下文预设 JSON（+5 个旧版），即**已调教好的 LLM 输出契约**（正文生图五要素 `<image>`、`${}$` 角色调用、`<人物>/<服装>` 12+4 字段）；解析见能力矩阵第 12 节。
- `docs/tasks/135-text-to-image-chatu8-port/README.md`：本计划。
- 参考源码：`/c/Users/admir/Desktop/Pi/neuro-book/.agent/st-chatu8/`（html/settings/*.html + index.js + tagData）。

## User Request / Topic

- 重构文生图：从 Agent 多轮方案改为 **LLM 方案**——LLM 负责生成内容（角色 tag JSON、正文 `<image>` 块），`illustration.director` 收缩为 **LLM 交互层**。
- 对标 chatu8 体验：**独立会话窗口（工作台）**，左侧「文生图」入口，窗口内配置 LLM 模型 + NovelAI 等，**设置全局生效**。
- **角色管理照搬 chatu8**：角色视觉数据存 JSON 文件（LLM 正文生图时直接读取），支持角色头像生成；放弃 `image-tags.md` tag-id 引用方案。
- 已确认：在当前 `neuro-book-clean`（已同步上游 `ffbfec84`，仓库仍无文生图代码）之上重新开始。

## Goal

在干净上游代码上实现对标 chatu8 的文生图工作台，验证面为每阶段聚焦测试 GREEN + `bun run typecheck` + 浏览器走查清单（不做自动化浏览器验证）。约束：LLM 直调所需的 Provider 安全边界（AES-GCM 凭据、URL 策略、DNS 校验）必须从参考分支迁入并适配，不能当作干净仓库现有能力；角色视觉 JSON 是 Project 真相源；所有工作台配置全局生效（Workspace Root `.nbook/config.json`，不用 Project 的 `workspace/<project>/.nbook/config.json`）；不新增第三方 LLM 网关；不引入 localStorage 双真相。首版范围收敛为 P0–P3 + P4 基础角色头像（其中 NovelAI 配置全量移植），P4.5/P5 列入 Backlog。

## Current State

- 干净仓库无任何文生图代码：`server/text-to-image/`、`server/illustration/`、`app/components/novel-ide/text-to-image/` 都不存在；`NovelTextToImagePanel.vue` 也不存在，左侧入口需要新建。
- `StoredGlobalConfig` 无 `textToImage` 字段；App SQLite（`prisma/schema.sqlite.prisma`）与 Project SQLite（`prisma/project.schema.prisma`）均无文生图模型；现有 Provider 凭据在 `config.json` 中明文保存、读取时遮蔽，没有文生图专用的 AES-GCM、URL 策略、DNS 校验层。
- 参考分支（`/c/Users/admir/Desktop/Pi/neuro-book/`）有 Agent 方案实现（illustration.director profile、9 工具、ShotIntent 管线、image-tags.md、queue/asset 等），**作为迁移参考但不直接复制**（方案不同）。其文生图相关规模约：server 253 文件 / 5 万行，shared 52 文件 / 9.4 千行，app 18 文件 / 5.2 千行。
- 参考分支中可复用基础件：NovelAI 生成、Vibe/角色参考资产、Provider 安全层、队列/资产、占位符解析、TipTap Node、历史图片组件、敏感词替换语义；计划中的新 LLM 链路（`body-image-llm`、`character-visual-llm`、`llm-chat`）在参考分支无直接对应实现，属于新写。
- chatu8 源码与研究材料在 `/c/Users/admir/Desktop/Pi/neuro-book/.agent/` 下，只读参考。

## ADR / Decisions / Discussion

- **D1：LLM 是内容生成者，director 是交互层。** 角色 tag = LLM 产出 JSON → director 写 `.md/.json`；正文 = LLM 产出 `<image>` 块 → director 插入正文 → 队列生成。无多轮工具推理。
- **D2：独立工作台 Dialog（chatu8 settings.html 同构）。** 左侧导航 + 右侧内容区，入口在左侧「文生图」。内含 LLM 配置 / NovelAI 配置 / 角色管理 / 正文生图会话 / 历史图片 / 词库 / 生图日志。
- **D3：工作台配置全局生效，但存储边界明确。** 非敏感配置（上下文预设、请求类型绑定、模型参数、采样参数）存 `StoredGlobalConfig.textToImage`，落 Workspace Root `.nbook/config.json`；Provider 记录与 AES-GCM 密文凭据存 App SQLite。不随 Project 变化，不写 Project 的 `workspace/<project>/.nbook/config.json`。
- **D4：角色管理照搬 chatu8，JSON 真相源。** 角色视觉数据 = Project 内 JSON 文件（12 字段纯文本 tag + 服装 + 照片数组），LLM 正文生图直接读取；支持角色头像生成（LLM 照片 prompt → NovelAI 生图 → 存照片数组）。
- **D5：`<image>` 块契约沿用 chatu8 格式。** `<image>...</image>` 块内：可选 `<imgthink>` 思考 + 插入定位（chatu8 用 regex 行；NeuroBook 用章节锚点/段落 ID）+ 最终 tag 串。
- **D6：请求类型 × (API 档案 + 上下文预设) 为核心模型。** 先收敛 5 类：正文生图、角色 tag 生成、角色照片 prompt、角色/服装修改、Tag 修改。
- **D7：只做 NovelAI 后端。** 不移植 SD/ComfyUI/Banana。
- **D8：首版收敛。** 首版只做 P0–P3 + P4 基础角色头像；P4.5（重绘/编辑 tag/局部重绘）与 P5（Danbooru 词库/生图日志）列入 Backlog。TagIndex 首版用手动标签或轻量词库，不做 Danbooru 全量同步。
- **D9：入口是新建项。** 干净仓库没有 `NovelTextToImagePanel.vue`，P1 必须新建左侧入口或直接接侧栏，不能假设已有面板。
- **D10：NovelAI 配置全量移植，LLM 按扩展清单实现。** NovelAI 分页包含 Vibe Transfer、角色参考、Vibe 文件生成器、Vibe 组等全部能力；LLM 分页包含流式生成、发送图片、模型发现、完整上下文预设条目与运行时占位符。
- **D11：敏感词替换移植，正则模块不移植。** `textReplacement` 用于发送正文前，`aiReplacement` 用于解析 LLM 图片回复前；`regex.html` 的前后正则、文字正则和测试模式不做。
- **D12：云端队列不移植。** 只保留本地队列语义：Job 落 Project SQLite、本机消费；不迁移 Reconciliation / Dispatch / Lane / Throttle / DispatchOutbox / PlanningWorkflow 等云端队列模型与 saga。

## Verification / Test

- 每阶段：聚焦 vitest 套件 GREEN；`bun run typecheck`。
- 全量：文生图相关测试集 + 全仓 typecheck。
- 浏览器走查：用户授权后进行，不做自动化浏览器验证。

## Implementation Plan（分阶段）

### P0：基础设施盘点与迁移基线

**目标**：把“参考分支里已有、干净仓库没有”的基础件、schema、凭据边界和测试差异全部盘点成可执行清单，作为 P1–P4 的前置。

**产出**：
- 可迁移文件清单：`server/text-to-image/provider-credential.ts`、`provider-url-policy.ts`、`provider-fetch.ts`、`novelai-image-generation.ts`、`queue.service.ts`、`asset.service.ts`、`chapter.service.ts`、`shared/text-to-image-markdown.ts`、TipTap `TextToImagePrompt.ts`、`TextToImageHistoryWorkspace.vue` 等，逐项标注「迁入 / 改造 / 新写」。
- NovelAI 全量能力清单：Vibe Transfer、角色参考、Vibe 文件生成器、Vibe 组、配置档案、AI 默认角色位置等，逐项标注「迁入 / 改造 / 新写」。
- LLM 执行链路清单：流式/非流式请求、发送图片、合并 System/User、上下文历史、Tagthink 回显、历史保留 `<image>`、请求类型注册表、运行时占位符与敏感词替换，逐项标注「迁入 / 改造 / 新写」。
- schema diff：App SQLite 只迁移 `TextToImageProvider`；Project SQLite 只迁移 `TextToImageJob` / `TextToImageAsset` / `TextToImageReferenceAsset`。云端队列相关模型（Reconciliation / Dispatch / Lane / Throttle / DispatchOutbox / PlanningWorkflow 等）明确不移植。
- 配置边界：`StoredGlobalConfig.textToImage` 的字段定义；哪些进 JSON、哪些进 App SQLite；AES-GCM 主密钥位置（参考分支为 Workspace Root `secrets/text-to-image.key`）。
- 测试适配清单：参考分支测试依赖其 schema/config/组件，迁入后需要按干净仓库改写；明确每阶段需要新增或删除的测试。

**验收**：清单写入本任务目录（可新增 `P0-INVENTORY.md`）；`bun run generate` 与 `bun run typecheck` GREEN。

---

### P1：类 chatu8 独立窗口 + LLM/NovelAI 配置移植

**目标**：左侧「文生图」→ **弹出独立模态大窗口**（与 NeuroBook 现有「设置」窗口 `NovelIdeSettingsDialog` 同构），完成 LLM 与 NovelAI 配置能力落地，设置全局生效。

**窗口形态（已核对 chatu8 源码 + NeuroBook 现有设置窗口）**：
- chatu8 设置窗口 = `position: fixed` 全屏遮罩（rgba 0.6）+ 居中大窗（**90vw × 85vh**，max-width 1200px），内部 header（标题 + 关闭）→ 左侧导航 → 右侧内容区；点击后覆盖主界面弹出，不是 IDE 内嵌面板。
- **NeuroBook 落地 = 复用现有「设置」窗口模式**：`NovelIdeSettingsDialog` 已是 `Dialog` 组件 `width=1280px / height=86vh / overlay-type=blur`，点击侧栏按钮 `settingsDialogOpen=true` 弹出覆盖主界面；文生图工作台照此实现（独立 Dialog + Teleport 挂主题宿主 + 左侧导航 + 右侧内容区）。
- 左侧「文生图」面板仅作为**弹出入口**（点击 → `textToImageWorkbenchOpen = true`），不在 IDE 侧栏内嵌分页。

**UI**：
- 新增 `app/components/novel-ide/text-to-image/TextToImageWorkbenchDialog.vue`：独立模态窗口（header + 左侧导航 + 右侧内容区，16 分页目录对齐 chatu8）
- 新增 `app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue`（干净仓库不存在）作为左侧「文生图」入口，标题栏加「打开工作台」按钮（`i-lucide-settings-2` 图标），点击 `textToImageWorkbenchOpen = true` 弹出；若侧栏直接接入口更简单，则优先侧栏按钮
- `app/pages/index.vue` 挂载 `<TextToImageWorkbenchDialog v-model="textToImageWorkbenchOpen" />`（与 `NovelIdeSettingsDialog` 并列）
- 窗口分页：LLM 配置 / NovelAI 配置 / 历史图片（占位复用）

**LLM 配置分页**（`TextToImageLlmSettingsSection.vue`）：
- LLM API 档案 CRUD（新增文生图专用 `openai_compatible` Provider kind，服务端存储；干净仓库没有该专用 kind）
- API 连接：Base URL（含 `/v1` 后缀手填）、API Key 显隐、「连接并获取模型」下拉
- 请求选项：流式生成（SSE）、发送图片（多模态）、合并 System/User、错误重试（0–5，间隔 2s）
- 模型参数（temperature / top_p / max_tokens）
- 上下文预设条目管理（role / content / enabled / triggerMode=always|trigger / triggerWords / andTriggerWords / 另存为 / 导入导出全部）→ 存全局配置
- 上下文历史（发送历史层数 0–20）、Tagthink 回显、历史正文保留 `<image>` 标签
- 运行时占位符：`{{正文}}`、`{{上下文}}`、`{{用户需求}}`、`{{世界书触发}}` 等预设占位符，骰子占位符（如 `1d6`），`{@getvar::...@}` / `{@getworldvar::...@}` / `{@setworldvar::...@}` 变量替换
- 请求类型绑定（5 类：正文生图 / 角色 tag 生成 / 角色照片 prompt / 角色/服装修改 / Tag 修改）
- 测试工具（组合提示词预览 + AI 回复）
- 敏感词替换档案（`textReplacement` / `aiReplacement`，Profile CRUD；正则模块不移植）

**NovelAI 配置分页**（`TextToImageNovelAiSettingsSection.vue`）：
- Provider（密钥显隐 / 官网或第三方站点 / 云端队列不移植，只保留本地队列语义）
- 配置档案 CRUD（模型/采样/参数快照：读取、新建、保存、删除）
- 模型（5 款 NAI）/ 采样器（7 种）/ 噪点表 / Prompt Guidance / Guidance Rescale / AI 默认角色位置 / SMEA / SMEA DYN / Variety / Decrisp
- 生成参数（尺寸预设 + 宽高 / steps / seed）
- 固定提示词（前置/后置/负面 + token 统计 + 可视化预设选择 + 翻译 + tag 自动补全）+ 提示词替换规则（支持多触发词与 if 条件）+ 质量预设（AQT/UCP）+ 福瑞数据集
- Vibe Transfer（启用 / 参考图上传预览移除 / InformationExtracted / ReferenceStrength）
- 角色参考图（启用 / 参考图库上传 / 角色组编辑，最多 4 角色）
- Vibe 文件生成器（`.naiv4vibe` 官方兼容文件）
- Vibe 组（最多 4 个 Vibe / 启用组转移 / 随机 Vibe 组 / normalizeRefStrength）

**服务端**：
- `shared/dto/text-to-image.dto.ts`：`TextToImageProviderKind = "novelai" | "openai_compatible"`
- `prisma/schema.sqlite.prisma` + migration：按 P0 清单新增 `TextToImageProvider` 等模型与 migration；`TextToImageProviderKind = "novelai" | "openai_compatible"`
- `server/text-to-image/provider.service.ts`：支持 openai_compatible（baseUrl / model / credential / 参数）
- `server/config/types.ts` + normalizer：`StoredGlobalConfig["textToImage"]`（llm 请求类型绑定 / 上下文预设 / 参数 + novelAi 采样参数）
- `server/text-to-image/llm-chat.ts`：`requestLlmCompletion()`（依赖 P0 从参考分支迁入的 provider-credential / provider-url-policy / provider-fetch，不得当作干净仓库现有能力）
- API：`/api/text-to-image/workbench/config.get.ts` / `.put.ts`（全局配置读写 + CAS）

**验收**：工作台可打开；LLM 5 类请求类型绑定、流式/非流式、发送图片、模型发现、完整上下文预设与占位符、敏感词替换档案 CRUD 生效且全局持久化；NovelAI 全量配置（含配置档案、Vibe Transfer、角色参考、Vibe 文件生成器、Vibe 组）持久化；LLM 测试工具可直调回复；vitest GREEN。

---

### P2：illustration.director 与 LLM 交互层 + 角色 tag 生成

**目标**：`illustration.director` 收缩为 LLM 交互层；角色视觉生成 = 发角色页给 LLM → 收 JSON → 写 `visual.json`。

**服务端**：
- 新增 `server/text-to-image/character-visual-prompt.ts`：固定 system 模板，**契约对齐用户 chatu8 预设（`.agent/workspace/chatu8-presets/` 第 12.3 节）**：`<人物>` 12 字段（中文名/英文名/角色特征/五官正背/上下半身 SFW(正背)/NSFW(正背)/负面）+ `<服装>` 4 字段 + POV 正背互斥规则 + SFW/NSFW 区别 + Tag 语法（`(tag)` 权重 / `(tag:1.5)` 精确 / 逗号分隔 / 空格连接）
- 新增 `server/text-to-image/character-visual-llm.ts`：`generateCharacterVisualDraft()`
  - system（Tag 规范契约 + `<人物>/<服装>` 输出格式）+ user（角色页 markdown + 既有 visual.json 摘要 + fill_empty/replace_visual）→ 单次 LLM 直调
  - 解析 `<人物>/<服装>` 标签或 JSON → `CharacterVisualDirectorOutputSchema.parse` → Zod 错误回传重试 2 次 → blocked + diagnostics
- 新增 `server/text-to-image/character-visual.codec.ts`：`visual.json` 的 Zod schema + parse/render（12 字段存纯文本 tag，供 LLM 直接读取）
- 新增 `server/text-to-image/character-visual.service.ts`：读/写 `visual.json`（tracked write + Workspace History）
- API：`/api/text-to-image/character-visual.generate.post.ts` / `.get.ts`（读角色视觉）
- **不迁入**：干净仓库没有 illustration.director / `useAgentHarness` 文生图调用；参考分支旧 Agent 链路只作能力对照，本阶段不涉及删除旧代码

**UI**：
- 工作台「角色管理」分页（照搬 chatu8 character.html）：角色列表 + 角色详细参数（12 字段表单，编辑 visual.json）+ 服装管理 + 「生成角色视觉」（LLM）按钮

**验收**：角色管理窗口可编辑 12 字段并持久化到 visual.json；「生成角色视觉」调用 LLM 后 JSON 回填可确认写盘；vitest GREEN。

---

### P3：正文生图链路（director 发正文 → LLM 回 `<image>` 块 → 占位符插入 → 队列）

**目标**：LLM 产出 `<image>` 块 → director 解析转结构化占位符插入正文 → 队列生成图片后替换为标准 Markdown 图片。

**三层分离（关键设计）**：
- **L1 LLM 输出契约**（不落盘，仅内存）：你预设的五要素 `<content><images><image><regex><title_styled><Tag_think><size><prompts></image>`（见能力矩阵 12.2 节），director 解析用。
- **L2 正文持久化格式**（写入 Markdown 文件）：结构化占位符 `<text-to-image-prompt id="...">JSON</...>`，服务端可精确定位；**原始 XML 标签（`<content>/<images>/<Tag_think>` 等）绝不进入正文**。
- **L3 前端交互**：TipTap Node 扩展（仿上游 `WorkspaceReference`：NodeView + Markdown 往返序列化）把占位符渲染成「生成图片」卡片按钮，点击触发队列。

**服务端**：
- 新增 `server/text-to-image/body-image-prompt.ts`：system 契约，**对齐用户 chatu8 预设（第 12.2 节）**：L1 输出格式 + `${...}$` 角色/服装调用代码（`{"name":..,"angle":..,"upperBody":"nsfw/sfw/hidden","lowerBody":..}`）+ 角色来源三路线（列表调用/原创 `姓名 (original)`）+ 体位 Tag 库 trigger 条目 + 注入角色 visual.json 摘要 + Recipe 画风
- 新增 `server/text-to-image/body-image-llm.ts`：正文 → LLM → L1 `<image>` 块列表 + 锚点 → Zod 校验 → 重试
- 敏感词替换：发送正文前应用 `textReplacement`；LLM 回复解析 `<image>` 块前应用 `aiReplacement`；规则档案复用 P1 配置；正则模块不移植
- 新增 `server/text-to-image/body-image-insert.service.ts`：**把 L1 块转 L2 占位符**（提取 `<regex>` 定位锚点、`<prompts>` 存 prompt、`<title_styled>/<size>/<Tag_think>` 存元数据）→ 按锚点插入正文（tracked write + 章节哈希防冲突）；占位符 JSON 含 id + anchor + prompt + 元数据，`${...}$` 调用代码在队列编译时展开（解析 visual.json 对应角色/服装）
- 新增 `shared/text-to-image-markdown.ts`：L2 占位符的 render/parse/find（对齐本地开发分支 `text-to-image-markdown.ts` 范式）
- 队列：按 P0 从参考分支迁入或简化 `server/text-to-image/queue.service.ts`，消费 L2 占位符 → 编译 prompt → NovelAI 生成 → 资产 → 替换为标准 Markdown 图片（`![...](assets/...)`）
- API：`/api/text-to-image/body-prompts.post.ts`（正文 → LLM → 转占位符 → 插入 → 入队）+ 占位符状态轮询
- 迁移：chapter 写回、tracked write、queue/job/asset 基建（P0 清单逐项迁入并适配干净仓库 schema；Project SQLite 需新增 `TextToImageJob`/`TextToImageAsset` 等模型与 migration）

**UI**：
- 新增 TipTap Node 扩展（仿 `WorkspaceReference`）：`<text-to-image-prompt>` 占位符 → NodeView 渲染「生成图片」卡片（标题 + 状态 + 生成按钮），点击调 `/api/text-to-image/prompt-placeholders/[id]/generate`
- 工作台「正文生图会话」分页：章节选择 → 发 LLM → L1 块预览（展示五要素）→ 确认 → 转占位符插入正文 → 队列生成 → 历史查看

**验收**：正文生图端到端（选章节 → LLM 出 L1 块 → 转 L2 占位符插入 → TipTap 渲染按钮 → 点击入队 → 资产 → 替换）；敏感词替换在正文发送前与 LLM 回复解析前生效；正则模块不进入正文；原始 XML 标签不残留正文；vitest GREEN。

---

### P4（首版基础版）：角色头像生成

**目标**：首版只做角色头像闭环：LLM 照片 prompt → NovelAI 生图 → 存照片数组；照片上传、照片编辑、服装照片等后置到 Backlog。

**服务端**：
- 新增 `server/text-to-image/character-photo-llm.ts`：`generateCharacterPhotoPrompt()`（buildCharacterText/buildOutfitsText 对齐 chatu8 → LLM_CHAR_DISPLAY 语义）
- 新增 `server/text-to-image/character-photo.service.ts`：照片 prompt 保存、生图入队、照片资产关联 visual.json `photos[]`
- API：`/api/text-to-image/character-photo.generate-prompt.post.ts` / `.generate.post.ts` / `.list.get.ts`

**UI**：
- 角色管理分页「角色照片」区：生成照片 prompt、生成头像、头像列表；上传/编辑后置

**验收**：角色可生成头像并持久化；vitest GREEN。完整照片管理（上传/编辑/服装照片）不在首版验收范围。

---

### P4.5（Backlog，首版不做）：已生成图片的后续操作（重绘 / 编辑 tag / 局部重绘）

> 首版不实现；进入 Backlog 后再启动。以下保留为能力清单。

**目标**：对齐 chatu8 对已生成图片的交互能力（见 `docs/research/st-chatu8-capability-matrix.md` 第 11 节）。

**服务端**：
- `server/text-to-image/queue.service.ts` 新增 job kind：`reroll`（同 tag 重绘）、`inpaint`（局部重绘，带 image + mask + strength 参数，复用现有 job/asset 基建）
- 新增 `server/text-to-image/reroll.service.ts`：原 tag → 新 job，旧 asset 保留（复用 queue 既有 reroll 语义）
- 新增 `server/text-to-image/inpaint.service.ts`：mask 资产存储 + `requestNovelAiImages` 的 inpaint 分支（strength 默认 0.54，negative 默认 `blurry, lowres, bad quality`）
- 新增 `server/text-to-image/tag-edit.service.ts`：编辑 tag → 校验 → 新 job；支持 `$变量$` 占位符高亮所需的解析
- API：`/api/text-to-image/assets/[id]/reroll.post.ts` / `inpaint.post.ts` / `edit-tag.post.ts`

**UI**：
- 历史图片 / 正文图片卡片加操作：**重绘**（按钮或双击）、**编辑 tag**（Dialog + 词库补全 + 翻译 + Tag 操作菜单）、**局部重绘**（画布涂抹 mask）
- 编辑对话框复用工作台词库自动补全；长按发送可弹尺寸选择（可选）

**验收**：图片卡片可重绘 / 编辑 tag 重生成 / 局部重绘；vitest GREEN。

---

### P5（Backlog，首版不做）：词库 + 历史图片 + 生图日志（对齐 chatu8 剩余模块）

> 首版只做手动标签或轻量词库；Danbooru 全量同步、完整日志页和图片后续操作后置。

**词库分页**：
- 服务端 TagIndex（Danbooru 官方 post_count≥3000 四层，Backlog 实施；首版只做手动标签或轻量词库）
- UI：标签浏览器（树形）+ 搜索（开头匹配/排序/上限）+ 手动标签管理

**历史图片分页**：
- 复用/对齐 `TextToImageHistoryWorkspace`：网格 + 多选下载/删除 + 分页 + 筛选

**生图日志分页**：
- 生图生涯统计（日/周/月/年柱状图 + 按后端进度条，数据投影自 Job/Asset）
- 任务管理（队列状态列表 + 取消/清空）
- 调试日志 / 错误收集器（App JSONL 投递）

**验收**：三模块 UI 可用；vitest GREEN。

---

### P6：全局配置收口 + 清理 + 全量回归

- 全局配置（`StoredGlobalConfig.textToImage`）读写完整化：导入/导出、CAS 冲突
- 移除 P0–P4 首版遗留死代码；不引入 `useAgentHarness` 文生图调用；P4.5/P5 代码不进入首版
- 全量文生图测试集回归 + `bun run typecheck` + `bun run generate`
- 浏览器走查清单（用户授权后）
- 更新 `PROJECT-STATUS.md`、`RELEASE.md` 文案（面向用户语言）

## TODO / Follow-ups

- [x] P0 盘点与迁移基线
- [x] P1 实现（LLM/NovelAI 配置、模型发现、上下文预设、敏感词替换、NovelAI 翻译/Tag/Vibe/配置档案）
- [x] P2 实现（角色视觉生成与 visual.json 管理）
- [x] P3 实现（正文生图 L1→L2、本地队列、TipTap 一键生成并替换正文）
- [x] P4 基础角色头像实现
- [ ] P6 首版收尾
- [ ] Backlog：P4.5 已生成图片后续操作
- [ ] Backlog：P5 词库 / 历史图片 / 生图日志
- [ ] 浏览器走查（清单见 `BROWSER-WALKTHROUGH.md`，待用户授权执行）
