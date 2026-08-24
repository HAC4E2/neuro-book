# 文生图移植计划：对标 chatu8（独立工作台 + LLM 交互层）

> Active task directory format: `NN-kebab-case-name/`。归档时移到 `docs/tasks/archived/`。
> 本计划在**干净上游 master（notnotype/neuro-book，无文生图代码）**之上实现；基础件从参考分支迁移适配，LLM 交互层新写，对标 chatu8 体验。

## Relative documents refs

- [`图片资产交互、当前画风串重 roll、NovelAI V5 与 LLM 预设导入施工合同`](image-asset-actions-reroll-v5-contract.md)：2026-08-22 后处理大图、图片复制/下载、历史大图、当前已保存画风串重 roll、chatu-8 V5 参数适配及 LLM 预设条目名称保留的实施级合同；已实施，见下方 2026-08-22 实施记录。
- [`施工计划.md`](施工计划.md)：2026-08-15 角色分组、视觉 JSON 版本、LLM 修改确认和 NovelAI 画风串重构的后续施工合同。
- [`文生图角色别名、图片块状态与工作台交互修复施工计划`](../../drafts/文生图角色别名队列状态与工作台交互修复施工计划.md)：2026-08-19 英文别名、跨页面 Job 状态恢复、角色服装交互、画风串管理和视觉 JSON 删除的施工设计；尚未实施。
- `docs/research/st-chatu8-capability-matrix.md`：chatu8 全部能力清单 + LLM 生图链路（移植逐项对照）。
- `.agent/workspace/chatu8-presets/`：用户导出的 4 个 chatu8 上下文预设 JSON（+5 个旧版），即**已调教好的 LLM 输出契约**（正文生图五要素 `<image>`、`${}$` 角色调用、`<人物>/<服装>` 12+4 字段）；解析见能力矩阵第 12 节。
- `docs/tasks/142-text-to-image-chatu8-port/README.md`：本计划。
- 参考源码：`/c/Users/admir/Desktop/Pi/neuro-book/.agent/st-chatu8/`（html/settings/*.html + index.js + tagData）。

## User Request / Topic

- 重构文生图：从 Agent 多轮方案改为 **LLM 方案**——LLM 负责生成内容（角色 tag JSON、正文 `<image>` 块），`illustration.director` 收缩为 **LLM 交互层**。
- 对标 chatu8 体验：**独立会话窗口（工作台）**，左侧「文生图」入口，窗口内配置 LLM 模型 + NovelAI 等，**设置全局生效**。
- **角色管理照搬 chatu8**：角色视觉数据存 JSON 文件（LLM 正文生图时直接读取），支持角色头像生成；放弃 `image-tags.md` tag-id 引用方案。
- 已确认：在当前 `neuro-book-clean`（已同步上游 `ffbfec84`，仓库仍无文生图代码）之上重新开始。

## Goal

在干净上游代码上实现对标 chatu8 的文生图工作台，验证面为每阶段聚焦测试 GREEN + `bun run typecheck` + 浏览器走查清单（不做自动化浏览器验证）。约束：LLM 直调所需的 Provider 安全边界（AES-GCM 凭据、URL 策略、DNS 校验）必须从参考分支迁入并适配，不能当作干净仓库现有能力；角色视觉 JSON 是 Project 真相源；所有工作台配置全局生效（Workspace Root `.nbook/config.json`，不用 Project 的 `workspace/<project>/.nbook/config.json`）；不新增第三方 LLM 网关；不引入 localStorage 双真相。首版范围收敛为 P0–P3 + P4 基础角色头像 + P4.5 已生成图片后处理（其中 NovelAI 配置全量移植），P5 列入 Backlog。

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
- **D4：角色管理照搬 chatu8，JSON 真相源。** 角色视觉数据 = Project 内 JSON 文件（12 字段纯文本 tag + 服装 + 照片数组），LLM 正文生图直接读取；角色按项目绑定的分组管理，新建项目自动拥有空白 `default` 分组；角色详情、服装详情和当前启用角色分开呈现；支持角色头像生成（LLM 照片 prompt → NovelAI 生图 → 存照片数组）。
- **D5：`<image>` 块契约沿用 chatu8 格式。** `<image>...</image>` 块内：可选 `<imgthink>` 思考 + 插入定位（chatu8 用 regex 行；NeuroBook 用章节锚点/段落 ID）+ 最终 tag 串。
- **D6：请求类型 × (API 档案 + 上下文预设) 为核心模型。** 先收敛 5 类：正文生图、角色 tag 生成、角色照片 prompt、角色/服装修改、Tag 修改。
- **D7：只做 NovelAI 后端。** 不移植 SD/ComfyUI/Banana。
- **D8：首版收敛。** 首版完成 P0–P3 + P4 基础角色头像 + P4.5（重绘/编辑 tag/局部重绘）；P5（Danbooru 词库/生图日志）列入 Backlog。TagIndex 首版用手动标签或轻量词库，不做 Danbooru 全量同步。
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
- 工作台「角色管理」分页（照搬 chatu8 character.html）：项目分组切换 + 角色详情 + 服装详情 + 当前启用角色；角色详情页编辑 visual.json 的 12 个字段并提供「生成角色 Tag」入口，服装详情独立编辑，不再从角色列表提供生成入口

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
- 新增正文角色扫描与会话编译服务：正文只发送当前章节；角色触发、角色分组、角色/服装片段展开和提示词组装由工作台后端机械完成，不经过 Agent/LLM；显式 `${...}$` 调用支持指定 `groupId`
- 新增 `server/text-to-image/body-image-llm.ts`：正文 → LLM → L1 `<image>` 块列表 + 锚点 → Zod 校验 → 重试
- 敏感词替换：发送正文前应用 `textReplacement`；LLM 回复解析 `<image>` 块前应用 `aiReplacement`；规则档案复用 P1 配置；正则模块不移植
- 新增 `server/text-to-image/body-image-insert.service.ts`：**把 L1 块转 L2 占位符**（提取 `<regex>` 定位锚点、`<prompts>` 存 prompt、`<title_styled>/<size>/<Tag_think>` 存元数据）→ 按锚点插入正文（tracked write + 章节哈希防冲突）；占位符 JSON 含 id + anchor + prompt + 元数据，`${...}$` 调用代码在队列编译时展开（解析 visual.json 对应角色/服装）
- 新增 `shared/text-to-image-markdown.ts`：L2 占位符的 render/parse/find（对齐本地开发分支 `text-to-image-markdown.ts` 范式）
- 队列：按 P0 从参考分支迁入或简化 `server/text-to-image/queue.service.ts`，消费 L2 占位符 → 编译 prompt → NovelAI 生成 → 资产 → 替换为标准 Markdown 图片（`![...](assets/...)`）
- API：`/api/text-to-image/body-prompts.post.ts`（正文 → LLM → 转占位符 → 插入 → 入队）+ 占位符状态轮询
- 迁移：chapter 写回、tracked write、queue/job/asset 基建（P0 清单逐项迁入并适配干净仓库 schema；Project SQLite 需新增 `TextToImageJob`/`TextToImageAsset` 等模型与 migration）

**UI**：
- 新增 TipTap Node 扩展（仿 `WorkspaceReference`）：`<text-to-image-prompt>` 占位符 → NodeView 渲染「生成图片」卡片（标题 + 状态 + 生成按钮），点击调 `/api/text-to-image/prompt-placeholders/[id]/generate`
- 主工作区 Markdown 工具栏提供正文生图入口；本章已经存在图片标记时再次触发会先确认整体 reroll，确认后只清理前端正文中的占位符/图片标记，历史图片与后端资产保留
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

### P4.5（已实现）：已生成图片的后续操作（重绘 / 编辑 tag / 局部重绘）

> 首版范围内已实现；历史图片页长按图片可重绘 / 编辑 tag / 局部重绘。

**目标**：对齐 chatu8 对已生成图片的交互能力（见 `docs/research/st-chatu8-capability-matrix.md` 第 11 节）。

**服务端**：
- 新增 `server/text-to-image/asset-postprocess.service.ts`：`reroll`（原 tag 重绘）、`edit-tag`（替换 prompt 后重绘）、`inpaint`（局部重绘，带 image + mask + strength）
- 新增 `server/text-to-image/mask.service.ts`：mask 数据处理与资产写入
- API：`/api/text-to-image/assets/[id]/reroll.post.ts` / `inpaint.post.ts` / `edit-tag.post.ts`

**UI**：
- 历史图片和正文内已生成图片长按弹出操作菜单：**重绘**、**编辑 tag**、**局部重绘**（画布涂抹 mask）
- 局部重绘支持 strength（默认 0.54）与可选 prompt 覆盖
- 点击「生成图片」时由工作台后端将占位符内容、当前画风串和 NovelAI 参数机械组合后入队；该步骤不再经过 Agent/LLM

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
- 移除 P0–P4 首版遗留死代码；不引入 `useAgentHarness` 文生图调用；P4.5 已进入首版，P5 不进入首版
- 全量文生图测试集回归 + `bun run typecheck` + `bun run generate`
- 浏览器走查清单（用户授权后）
- 更新 `PROJECT-STATUS.md`、`RELEASE.md` 文案（面向用户语言）

## TODO / Follow-ups

- [x] P0 盘点与迁移基线
- [x] P1 实现（LLM/NovelAI 配置、模型发现、上下文预设、敏感词替换、NovelAI 翻译/Tag/Vibe/配置档案）
- [x] P2 实现（角色视觉生成与 visual.json 管理）
- [x] P3 实现（正文生图 L1→L2、本地队列、TipTap 一键生成并替换正文）
- [x] P4 基础角色头像实现
- [x] P6 代码侧收尾（全局配置导入导出/CAS、清理审计、typecheck/generate/全量回归、文档更新）
- [x] P4.5 已生成图片后续操作（重绘 / 编辑 tag / 局部重绘）
- [ ] Backlog：P5 词库 / 历史图片 / 生图日志
- [ ] 浏览器走查（入口与布局已对齐；真实 Provider/完整出图仍待完成，见 `BROWSER-WALKTHROUGH.md`）

## 实施记录（2026-08-03）

### 已完成实现

- Provider 安全层：AES-GCM 凭据密封、URL 策略、DNS 校验出站 fetch 均从参考分支迁移并适配。
- LLM 链路：非流式/SSE、发送图片、合并 System/User、模型发现、上下文预设注入、请求类型绑定、运行时占位符、敏感词替换、测试工具（请求类型 + 组合提示词预览）。
- NovelAI 链路：Provider/配置档案/模型采样参数/固定提示词/翻译/Tag 补全/提示词替换规则/AQT-UCP/Vibe 参考图预览/全局参考图库/Vibe 组条目编辑（最多 4 个）/`.naiv4vibe` 下载。
- 正文生图：L1 `<image>` 块 → L2 占位符 → 本地队列 → NovelAI 出图 → 替换为 Markdown 图片；TipTap 卡片一键生成；占位符状态查询接口。
- 角色视觉：`visual.json` 真相源、12 字段管理、LLM 生成/回填、头像生成并写入 `photos[]`。
- 全局配置：导入/导出、CAS 冲突检测；云端队列明确不移植。

### 关键提交

- `17f8d53f`：端到端生成链路与配置收口
- `f5a31692`：NovelAI 参考图库与测试工具补全
- `c4ffde7b`：补齐计划点名服务文件
- `36b7baa5`：占位符状态查询接口

### 验证记录

- `bun run typecheck`：通过。
- 聚焦 vitest：`236/236` 通过。
- `bun run generate`：通过（Prisma 两个客户端）。
- 全量 `bun run test`：`3339/3358` 通过；剩余为本机/既有基线（Windows symlink EPERM、`.gitattributes` CRLF、release-assets、novel-data 文案）与一次 harness 全量顺序抖动，单跑通过。
- 浏览器走查：清单已建，待用户授权执行。

## 实施记录（2026-08-07）

### 浏览器走查后对齐

- LLM 模型获取改为点击按钮后展开候选列表，不再自动选中第一个模型。
- 流式生成、发送图片改为带「已开启/已关闭」文字的胶囊开关，状态一眼可辨。
- 上下文预设条目固定高度滚动，导入大量条目后不再拉长页面。
- NovelAI 连接信息与画风参数分两次保存；`settings` 缺省时不再覆盖已有配置；NovelAI 无 id 时复用首个同类型 Provider。
- 敏感词替换改为内置规则只读展示，保留 `textReplacement` / `aiReplacement` 语义。

### 验证记录

- `bun run typecheck`：通过。
- `bunx vitest run server/text-to-image/provider.service.test.ts`：6/6 通过。

### 2026-08-07 第二轮体验对齐

- LLM「获取模型」改为普通块级列表，不再依赖绝对定位；未填 Base URL、列表为空、请求失败时错误就近显示在模型输入框下方。
- 上下文预设条目容器固定为最高 400px 的窗口，内部小滚动条，导入大量条目后不再拉长页面。
- 文生图工作台窗口放大到 `min(86vw, 1440px) × min(82vh, 1080px)`，五个分页的标签字号、输入控件字号与控件高度整体放大。
- NovelAI 的 AI 默认角色位置、Variety、SMEA 等开关开启时，所在行增加强调底色与边框；布尔开关开启态增加光环，状态更醒目。
- 无鉴权本地模式的兜底用户改为 `upsert`，降低并发创建同名用户导致的外键/唯一约束风险。

### 验证记录

- `bun run typecheck`：通过。
- `bunx vitest run server/text-to-image/provider.service.test.ts app/utils/text-to-image-context-import.test.ts`：9/9 通过。

### 2026-08-07 第三轮：chatu8 默认状态对齐 + 预设导入自动选中

- LLM 新建档案默认值对齐 chatu8：`temperature: 1`、`max_tokens: 30000`，前端表单、DTO schema 与服务端兜底三处同步；`historyDepth` 统一为 2。
- NovelAI 的 `informationExtracted` 默认值由 0.7 改为 chatu8 的 0.3。
- 上下文预设导入成功后自动选中第一个新导入的档案并刷新右侧编辑区，避免导入后看起来像没有反应。
- 用 `.agent/workspace/chatu8-presets/` 下的真实 chatu8 导出文件验证解析：全部 JSON 均可导入（最大 512 条 entry），无畸形 entry。

### 验证记录

- `bunx vitest run shared/dto/text-to-image.dto.test.ts app/utils/text-to-image-context-import.test.ts`：10/10 通过。
- 临时真实文件导入验证测试：1/1 通过，已删除临时测试文件。
- `bun run typecheck`：通过。

## 实施记录（2026-08-08）

### 浏览器实测收尾

- 上下文预设导入用文件选择器实测：导入 `预设名 -> {entries}` 格式的临时 JSON 后自动选中、计数 1→2，右侧编辑区保持折叠；删除测试预设后恢复 1 个，未残留数据。
- 流式生成、发送图片开关实测：点击后「已关闭 ↔ 已开启」，状态一眼可辨。
- 「获取模型」按钮实测可点击：点击进入「获取中」，受限网络请求结束后恢复可点击；真实模型列表仍需有效凭据与网络，未做端到端断言。

### 验证记录

- 聚焦 vitest：7 个文生图相关测试文件 40/40 通过。
- `bun run typecheck`：通过。

### 正文与角色链路收口

- 主工作区 Markdown 工具栏新增正文生图按钮；正文请求由工作台后端读取当前编辑器内容，限制为单章正文，并完成角色触发扫描、分组角色解析、角色/服装片段展开和正文提示词组装。
- 正文 `<image>` 回复继续转换为正文占位符和「生成图片」按钮；占位符生成时由后端直接组合画风串、NovelAI 模型参数和角色片段后入本地队列，不经过 Agent 或第二次 LLM。
- 本章已存在生图标记时再次点击正文生图会确认整体 reroll；确认只清理前端正文标记，历史图片和后端资产仍保留。
- 正文和历史图片均支持长按操作菜单，提供 tag 重生成、图片 reroll 和局部重绘；局部重绘使用后端保存的 mask 资产和强度参数。
- 角色管理增加项目绑定分组，新建项目自动复制空白 `default` 分组；角色详情、服装详情、当前启用角色分开管理，角色 Tag 生成入口移动到角色详情页；后端角色扫描携带 `groupId`，避免不同分组的同 ID 角色互相覆盖。

### 验证记录

- `bunx vitest run server/text-to-image/body-character-scanner.test.ts server/text-to-image/body-prompt-compiler.test.ts server/text-to-image/body-session.service.test.ts`：16/16 通过。
- `bunx vitest run server/text-to-image/queue.processor.test.ts`：3/3 通过。
- `bunx vitest run server/text-to-image/novelai-image-generation.test.ts server/text-to-image/queue.processor.test.ts`：5/5 通过。
- `bunx vitest run server/api/text-to-image/body-prompts.post.test.ts`：2/2 通过。
- `bunx vitest run server/api/text-to-image server/text-to-image shared/text-to-image-markdown.test.ts`：33 个测试文件，146/146 通过。
- `bun run typecheck`：退出码 0。
- `bun run generate` 首次在沙箱内返回 `Operation not permitted`；按权限流程提升权限重跑成功，Prisma Client `7.8.0` 两个 schema 均生成。

## 实施记录（2026-08-08 角色工作台收口）

- 角色管理界面按 chatu-8 交互拆成“角色详情 / 服装详情 / 当前启用角色”，左侧增加项目分组导航；支持分组新建、重命名、删除，以及角色新建、选择、保存和删除。
- 角色 Tag 生成入口移至角色详情页；当前启用角色只展示带触发词的项目角色，并支持按角色名、触发词筛选。
- 新增分组 PUT 路由合同测试，确认分组元数据更新不会移动分组内的角色 `visual.json`。
- 修正角色视觉字段标签，区分 `lowerNsfw` 的正面与 `lowerBackNsfw` 的背面。

### 验证记录

- `bunx vitest run server/api/text-to-image server/text-to-image shared/text-to-image-markdown.test.ts app/components/novel-ide/text-to-image app/components/markdown-studio/markdown-studio-tool-availability.test.ts app/components/markdown-studio/load-monaco-editor.test.ts`：39 个测试文件，159/159 通过；缺参 API 测试保留预期的校验警告日志。
- `bun run typecheck`：退出码 0。
- `git diff --check`：通过，仅有仓库既有的 LF/CRLF 提示。
- 本轮未执行新的浏览器人工验收，也未执行真实 LLM/NovelAI provider 端到端出图。

## 实施记录（2026-08-09 真实 Provider 复核）

- 真实 ds-flash LLM 已完成正文 L1 → L2，占位符写回 Project `ce-shi` 当前章节；全局 `image_gen` 绑定解析新增回归测试，避免多 Provider 时按列表首项误用。
- Node 服务新增环境代理适配：在 `HTTPS_PROXY`/`HTTP_PROXY` 存在时使用 `ProxyAgent`，保留 Provider URL 与重定向校验；`provider-fetch.test.ts` 为 `5/5` 通过。
- 代理修复后产品队列已实际访问 NovelAI，但 `2026-08-09T15:27:28.972Z` 和 `2026-08-09T15:29:06.504Z` 两次生成均返回 `NovelAI 生成失败：HTTP 429`；当前资产列表为空，Markdown 替换尚未完成。
- 因此本记录不把 API/独立 Node 探测当作浏览器人工验收，BROWSER-WALKTHROUGH 第 4 节继续保持未勾选；待 NovelAI 限流窗口结束后，再重试一次产品队列即可完成最后两步核验。

## 实施记录（2026-08-09 429 循环重试完成）

- 产品队列按 `HTTP 429` 每 `15s` 间隔循环重试；本次循环第 `1` 次即成功，Job `d541d2b3-a4ba-4169-b316-8deea06e9d3d` 状态为 `succeeded`。
- 资产 `assets/tti/fd408d31-866a-4f2c-96f1-e1f1f1e35c8f.png` 已保存，尺寸 `1216x832`、大小 `2,235,299` 字节；当前章节已通过 CAS 写入完成占位符到 Markdown 图片的替换。
- 这证明真实 NovelAI → 本地资产 → 章节 Markdown 的 HTTP/文件链路已通过；BROWSER-WALKTHROUGH 的浏览器人工复核仍保持未勾选。

## 实施记录（2026-08-10 合同修正施工计划收口）

本轮施工计划记录在 [`docs/superpowers/plans/2026-08-10-text-to-image-contract-hardening-plan.md`](../../superpowers/plans/2026-08-10-text-to-image-contract-hardening-plan.md)。已完成的产品合同包括：

- 角色设计、角色展示和正文 LLM 请求统一从全局请求类型绑定解析，只接受 `openai_compatible` Provider；NovelAI 只保留给生图。
- 角色原始 Markdown 与 `visual.json`、受控照片资产隔离；删除视觉资料不递归删除角色档案。角色界面只展示当前 Project 角色集合，不再提供项目角色分组 CRUD。
- 角色调用支持缺外层大括号的受控修复、中文名/英文名/触发名统一命中，并明确无角色段落只生成场景与环境 tag。
- 画风串、模型参数、质量预设、替换规则、furry/Vibe/角色参考合并为 NovelAI 当前生图配方；旧档案和固定提示词预设会在运行时迁移为配方。
- 最终正负提示词统一去重并写入资产元数据；token 估算使用 chatu-8 预处理后的 `Xenova/t5-small` tokenizer，界面显示加载中/不可用状态。
- NovelAI NAI3/NAI4/NAI4.5 参考图字段按模型适配；所有 NovelAI 生成入口共用进程级 FIFO 队列，间隔从上一请求返回成功或错误时开始计算，429 不自动重试并保留真实错误状态。
- Project 相对图片通过受控资产 API 在 TipTap 中渲染，保存 Markdown 时保留原始相对路径。

自动化验证：相关测试 `49` 个文件、`220/220` 个断言通过；`bun run typecheck` 通过；提升权限后 `bun run generate` 成功生成两个 Prisma Client；`git diff --check` 通过。T5 tokenizer 运行时示例提示词返回 `9` 个 token。

本轮没有执行新的浏览器人工验收，也没有把已有 API/文件复核证据冒充浏览器操作；真实 Provider、连续点击间隔和刷新后 TipTap 显示仍需按 `BROWSER-WALKTHROUGH.md` 人工确认。此前“429 循环重试”的记录是历史人工复核证据，已被当前产品合同替换为“429 失败退出、再次点击重新入队”。
## 2026-08-10 设计规格施工续批

- 已落地 Project 级“发送数据”选择与服务端请求快照：Lorebook 条目、角色视觉资料和服装选择按 Project 保存，发起请求时重新读取并冻结；前端不提交正文内容或任意绝对路径。
- 已补齐 chatu-8 兼容解析：中文内联角色/服装 DNA 字段、双大括号 `setvar/getvar`、XML/`image###...###` 图片输出块、思考外壳清理、分角色 Prompt 结构和同一位置历史资产筛选。
- 后处理弹窗已加入同一 `sourceAnchorId` 的历史图片左右切换；切换只改变弹窗预览，只有 Tag、重 roll 或局部重绘成功后才向正文 CAS 写回当前引用。
- 本续批验证：发送数据路由 2/2、内联角色与正文编译 16/16、LLM 输出与正文/角色解析 29/29、LLM 变量 6/6、资产服务 8/8；`bun run typecheck` 通过。浏览器人工验收和真实 Provider 验收仍未在本续批执行。
## 2026-08-10 NovelAI 专用代理自动发现

- NovelAI 的 `/ai/generate-image` 与 `/ai/encode-vibe` 使用独立代理解析器，依次检查环境变量、Windows 用户/WinHTTP 配置和受限的本机代理端口；发现成功后复用 dispatcher。
- 通用 Provider 与 LLM 链路保持直连安全 dispatcher，不消费 NovelAI 代理；连接失败保留目标主机和底层错误码并让下次请求重新发现，HTTP `429`、`401` 等响应不触发失效。
- 验证结果：代理发现/缓存 `6` 项、Provider 隔离与错误传播 `7` 项、NovelAI 请求链路 `6` 项，共 `19/19` 通过；文生图回归为 `46` 个测试文件、`219` 个测试通过，`bun run typecheck` 通过（`74.9` 秒）。浏览器人工验收和真实 NovelAI 出图未执行。

## 实施记录（2026-08-15 角色视觉资料分组重构）

- 已按 [`施工计划.md`](施工计划.md) 落地 Project 级多角色分组、分组启用与优先级；未手动分组的旧资料会迁移到 `default`，旧分组默认保持启用以避免已有正文结果改变。
- 视觉资料改为 `manifest.json` 索引 + `visual.json` 当前文件 + `visual-时间戳-UUID.json` 版本文件；所有读取、重命名、复制、激活、删除和迁移都由同一服务端库校验 `groupId`、Unicode `characterId`、`visualId` 与并发版本号。
- 角色工作台侧栏现在只展示已有视觉资料，并按“分组 → 角色 → JSON 文件”折叠；点击文件切换资料，支持重命名、设为当前、复制到其他分组和分组启用。角色视觉 LLM 修改先返回草稿，用户可选择覆盖、新建版本或取消，未确认不会写本地 JSON。
- 正文扫描、Prompt 编译、发送数据快照和角色照片链路均携带 `groupId`/`visualId`，启用分组按优先级去重；NovelAI 顶部“生图方案组”已合并为“画风串和模型参数配置”，保留分组和自命名画风串，并兼容旧配置迁移。
- 兼容保留旧 `character-visual.*` API，新增库式 API 供工作台使用；视觉 JSON 继续接受并输出既有 `nbook.character-visual/v1` 字段合同，`visualId` 作为版本索引字段，不破坏已有调用方。

自动化验证：Node 官方运行时下角色视觉/照片/分组 API、LLM、NovelAI、DTO、工作台等 `11` 个文件 `44/44` 通过；正文扫描/编译/发送数据 `31/31` 通过；正文 API、队列和图片链路 `25/25` 通过；旧视觉服务回归 `17/17` 通过。直接 `tsc --noEmit --pretty false` 与 `vue-tsc --noEmit --pretty false` 通过。

全量 Vitest 已按官方配置运行至 `300` 秒，仓库仍有既有的 workspace-files、world-engine、agent harness/profile 等失败及两个黑盒超时，未发现本轮角色视觉聚焦测试失败；因此不能把全量结果表述为全绿。浏览器人工操作、真实 LLM/NovelAI 端到端和开发服务器偶发 `worker entry not found` 场景仍未在本轮自动化中验证。

## 实施记录（2026-08-15 合并上游 master）

- 将 `origin/master` 的 `306e563ad7a4d4a58354fa8d582ad9aa9b886e8c` 合入 `new-text-to-picture`，保留 Task 142 的角色分组、视觉版本、LLM 修改确认和 NovelAI 画风串功能。
- 冲突限于 `PROJECT-STATUS.md` 和中英文 Activity Bar 文案：状态文档同时保留上游 `0.9.6-canary` 发布证据与 Task 142 验证记录；Activity Bar 同时保留文生图入口和上游 Project 未打开提示。
- 上游 Nuxt 类型生成暴露角色工作台的 API 路径与服务端文件路由不一致；客户端已改用生成合同中的 `character-library.activation`、`groups.reorder` 和 `visual.*` 路径，并补充合同测试，操作语义不变。
- 自动化验证：文生图、角色管理、Activity Bar 和共享合同 `61` 个测试文件、`291/291` 项通过；`bun run typecheck` 通过，包含上游新增的 `desktop/electron` typecheck；`git diff --check` 通过。未执行浏览器人工验收或真实 Provider 请求。

## 实施记录（2026-08-15 角色管理交互与分组修复施工）

本轮依据 [`docs/drafts/角色管理交互与分组修复施工计划.md`](../../drafts/角色管理交互与分组修复施工计划.md) 独立施工，未扩写本 Task 总计划。范围：按钮事件真实调用与交互状态、分组显示/创建/删除（含迁移事务）、Provider Fake-IP/受控 loopback 代理；未触碰正文生图、角色预设解析、NovelAI 画风串和 `worker entry not found`。

### 已落地

- **六个无效按钮修复**：`TextToImageCharacterSection.vue` 与 `TextToImageLlmSettingsSection.vue` 中 `@click="void <函数名>"`（只取函数引用、不调用）全部改为真实调用；全部写操作收敛到 `beginAction`/`endAction`（同一面板同时只允许一个写操作，`finally` 清理，双击只产生一次请求）。
- **分组显示与创建**：侧栏遍历完整 `groups`（空分组显示 `0` 与“暂无视觉资料”），角色层仍只显示已有视觉 JSON 的角色；创建表单只保留“分组名称”，服务端生成 `group-<uuid>` ID（碰撞重试），规范化显示名唯一（创建/重命名同名 409），重命名不改 ID；创建成功后自动展开新分组。
- **分组删除迁移**：两步 API——`GET character-library/groups.delete-preview`（只读摘要 + revision）与 `DELETE character-library/groups`（`expectedRevision` CAS，过期 409）。`default` 永不删除；非空组先把全部视觉资料无损迁移到 `default`（整目录 rename 或 manifest 合并），大小写文件名冲突生成 `<主体>-moved-<8位>.json`，`visualId` 冲突生成确定性新 UUID 并同步改写内容，损坏 JSON 按原始字节迁移，目标已有生效视觉保持不变、否则继承来源生效视觉；照片引用、角色 Markdown、历史 Job 不动；`.nbook/text-to-image-send-data.json` 中固定 `groupId/visualId` 引用按 ref 映射更新；已启用来源组删除后只从启用集合移除，`default` 不被隐式启用。事务走 Project 级写锁 + `.nbook/text-to-image/.txn/` 事务目录（备份 rename → 逐层提交 → 校验 → 删来源 → 清理），任一步失败按日志回滚，`ensure()` 会恢复未完成事务。
- **Provider 出站**：URL 策略补齐 `198.18.0.0/15`、TEST-NET、`192.0.0.0/24` 与 `.local`/`.localhost` 拒绝；新增统一出站策略 `resolveTextToImageOutboundPolicy()`（模型发现与正式 LLM 请求共用），只自动信任可达的 loopback 环境代理（`127.0.0.1`/`[::1]`/`localhost`），代理模式用 `ProxyAgent` 委托 DNS、仍拒绝私网字面量与跨源凭据重定向，不可达退回直连且不放松任何校验；代理连接失败映射为可区分错误，不泄漏凭据。
- **门禁**：静态契约测试禁止 `@\w+="void <函数名>"` 表达式并断言六个按钮的真实绑定；新增 jsdom + plugin-vue 的 `workbench-click.contract.test.ts` 挂载真实 SFC 点击六个按钮断言各只发送一次请求；服务/API 测试覆盖名称建组、409、迁移合并、冲突、revision 与全部故障注入点。

### 验证记录

- 聚焦测试：`server/text-to-image` + `server/api/text-to-image` + `app/components/novel-ide/text-to-image` 共 `59` 个文件 `314/314` 通过；其中 DOM 点击契约 `9/9`、分组迁移（含 7 个故障注入、重启恢复与 ID 碰撞重试）`28/28`、分组端点 `6/6`、Provider 侧 `47/47`。
- 沙箱内 `bun run vitest` 会因 vite 的 `spawn EPERM` 失败，实际命令为 `node --require .agent/tmp/spawn-shim-probe/spawn-shim.cjs node_modules/vitest/vitest.mjs run --configLoader=native --pool=threads <files>`（shim 只中和 vite 的 pipe 探测与 `.vite-temp` 写入，不影响断言）。
- 类型检查：`bunx nuxt prepare --dotenv .env.typecheck`（2s）+ `bunx vue-tsc --noEmit`（30s）退出码 0——本轮改动以及顺手修复的 3 个同域既有类型错误（`llm/preview.post.ts` 的 `.default({})`、`llm/response-events.get.ts` 的 `() => undefined` 契约、`TextToImageLlmSettingsSection.vue` 的 `newContextProfile` 缺 `promptMode`）全部通过。`bun run typecheck` 脚本包装在本会话沙箱内会反复重印脚本行并长时间不返回，故用等价底层命令验证；`desktop/electron` 部分因该工作副本未安装 `desktop/electron/node_modules`（缺 `electron` 类型）无法验证，与本轮改动无关。
- 真实网络验证（子代理执行）：经 `127.0.0.1:7897` 请求 `https://opencode.ai/zen/go/v1/models` 返回 26 个模型。
- 未执行：浏览器人工走查、真实 Project 上的删除迁移、真实 LLM 端到端出图。

### 偏差与风险

- 当前目录无 `.git`（非仓库检出副本），无法按仓库约定创建 worktree/分支/PR；改动直接在源码目录完成，由后续具备 git 的会话提交。
- 迁移计划的冲突解（重命名后缀、新 `visualId`）由状态内容确定性推导，保证预检与提交两次计划完全一致；提交前 revision 仍以完整状态哈希 CAS 兜底。
- 删除分组后照片资产内的 `sourceAnchorId`（含旧 `groupId`）保持历史值不重写，历史图片后处理按旧锚点仍可定位；新增照片会使用新锚点。

## 实施记录（2026-08-15 发送数据状态、角色分组移动与触发词修复施工）

本轮依据 [`docs/drafts/发送数据分组移动与角色触发词修复施工计划.md`](../../drafts/发送数据分组移动与角色触发词修复施工计划.md) 独立施工，未扩写本 Task 总计划。范围：发送数据选中/保存双层状态、角色分组启用标识、视觉资料跨组移动、触发词严格 `|` 合同与一次性迁移、角色身份跨版本一致性、正文扫描歧义；未触碰 LLM Provider、模型发现、NovelAI 参数、画风串、15 个角色 Tag 字段含义与 `worker entry not found`。

### 已落地

- **触发词 `|` 严格合同（Phase 1）**：新增 `server/text-to-image/character-trigger-words.ts` 领域模块——`parsePipeCharacterTriggers` 只允许 `.split("|")`，逗号/连续空项/首尾空项抛 `TriggerWordFormatError`；NFKC + 大小写折叠匹配；`buildEffectiveCharacterTriggers` 只在显式列表为空时回退中英文名，`buildCharacterReferenceTerms` 供 `${角色:名}` 显式引用（名称永远参与查找）。旧逗号解析只存在于 `trigger-words-migration.ts` 的私有函数中，一次性迁移按 `[,，|]` 拆分后输出 ` | `，不追加名称，写入前备份、复读校验后才提交 `triggerWordsFormat: "pipe-v1"` 标记，失败全量回滚，`ensure()` 会恢复未完成迁移；源码门禁测试禁止运行时模块出现逗号拆分并断言迁移器只导出两个入口。新库与旧 `character-visual.service.ts` 写入口均执行严格校验，移除中英文名自动追加。
- **正文扫描修复（Phase 1）**：英文匹配 NFKC + 不区分大小写；不同 `characterId` 被同一规范化触发词命中时抛 `CharacterTriggerAmbiguityError`（列出显示名与触发词），`body-prompts.post.ts` 映射为 409，不进入 LLM；同一角色多触发词只注入一次，`matchedTrigger` 按正文最早出现、等位置取更长、再按配置顺序稳定选择；`matchedCharacters` 响应新增 `source`（`trigger` / `project-send-data`）用于 trace 区分来源。
- **角色身份一致性（Phase 2）**：新增 `character-identity.service.ts`（身份 revision + Project 写锁事务）与 `character-library/identity.get|put` API；身份保存按 `characterId` 枚举全部分组/版本的 JSON，先校验 revision 与选中视觉 `updatedAt`，同一事务更新身份并可一并提交当前视觉的非身份修改，损坏 JSON 整体失败并列出安全标识，失败回滚；`CharacterVisualLibraryService.write()` 增加身份守卫，普通视觉保存改写中文名/英文名/触发词时抛 `CharacterIdentityFieldConflictError`（API 409），杜绝单 JSON 身份分叉。
- **视觉资料跨组移动（Phase 3）**：新增 `character-visual-move.service.ts` 与 `visual.move-preview.get|move.post` API，删除 `visual.copy` API 与 `createCopy()`。预检返回影响摘要与 revision；提交冻结来源 `groupId+characterId+visualId+updatedAt` 与目标分组，目标等价内容（指纹忽略 `visualId`/文件名/时间戳/来源）直接合并到已有 ref，多份等价返回 409 冲突；文件名/`visualId` 冲突确定性改名/换新 ID；`.nbook/text-to-image-send-data.json` 的固定 `groupId/visualId` 引用同步映射，仅 `characterId` 的跟随引用不动；移动不复制/不删除照片，照片路径做 containment 校验；来源最后一份移动后整个角色目录移除，否则按 `updatedAt`/`visualId` 确定 fallback 生效项；事务走写锁 + `.txn/` 日志，`crash` 故障注入模拟进程中断后由恢复逻辑回滚。
- **发送数据双层状态（Phase 4）**：`TextToImageSendDataSection.vue` 保存快照与编辑副本分离，稳定选择键计算 `dirty`；未保存显示 warning“有未保存更改，尚不会发送给 LLM”，保存按钮仅在有修改时可用；三栏条目改为整行可点击、`role="checkbox"` + `aria-checked` + 图标 + “固定发送/未固定发送”徽标，标题带“已选 N / M”，角色区改名“角色固定发送列表”，服装徽标“固定发送服装”；保存失败保留编辑状态；Project 切换用令牌丢弃旧响应。
- **启用分组 UI（Phase 4）**：标题显示“已启用 N / M 个分组”；卡片用 accent 边框/背景 + check 图标 + “已启用/未启用”徽标（非纯颜色），点击整卡切换；零启用显示“正文不会自动注入角色，只生成场景内容”警示；“仅启用此组”在唯一启用时显示“当前唯一启用”并禁用；更新期间只有目标卡片显示 spinner + “正在更新…”，成功后只以 API 返回的启用状态合并，失败保持服务端原状态并通知；侧栏分组节点新增可读“启用”徽标。
- **统一离开保护（Phase 4）**：新增 `app/components/novel-ide/text-to-image/leave-guard.ts`（保存/放弃/取消），发送数据与角色工作台通过 `defineExpose` 暴露 `guard()`，工作台 Dialog 的 `request-close`、左侧分页切换和 Project 切换均先过保护；角色工作台身份修改与视觉修改分开追踪，保存身份先读取同步范围摘要，确认 Dialog 展示“将同步 N 个分组、M 份 JSON”；触发词输入实时拒绝 `,`、`，`、连续空项与首尾竖线并展示规范化预览，标签改为“触发词（使用 | 分隔）”；LLM 修改预览继续锁定身份字段（`character-visual-llm.ts` 的 `finalizeDraft` 对触发词执行严格规范化，逗号输出触发重试）。

### 验证记录

#### 最终门禁

- 聚焦测试（完整文生图范围，含服务/API/组件/DTO）：`bun run test -- server/text-to-image server/api/text-to-image app/components/novel-ide/text-to-image shared/text-to-image-novelai-prompt.test.ts shared/dto/text-to-image.dto.test.ts`，`72` 个测试文件、`415/415` 通过。NovelAI 提示词替换/凭据三态/最终 Tag 链路施工后的新增关键套件包括：统一事务恢复调度 `4/4`、严格凭据三态 `9/9`、结构化替换规则 `7/7`、最终 Prompt Bundle `4/4`、V4.5 payload `10/10`、发送数据 Project 切换取消 `6/6`、API Key 三态 UI `3/3`、离开保护续接 `3/3`；根 `nuxt typecheck` 退出码 0，浏览器人工验收、真实 NovelAI 请求对照与真实 Project 迁移未执行。
- 类型检查：`bunx nuxt typecheck --dotenv .env.typecheck --logLevel silent` 退出码 `0`（覆盖 app/server/shared 与全部测试文件）。`bun run typecheck` 组合脚本中 `desktop/electron` 部分仍因该工作副本未安装 `desktop/electron/node_modules`（缺 `electron` 类型）失败，错误全部位于 `desktop/electron/src/*`，与本轮改动无关，沿用上轮口径。
- 触发词迁移统计口径：迁移器统计扫描/转换/未修改/损坏文件数并写入 `pipe-v1` 标记；本轮无真实用户 Project 数据，上述数字均来自测试夹具（转换 `4` 个夹具文件、损坏 `1` 个、回滚注入 `1` 次），未对用户 Project 执行真实迁移。
- 源码搜索证明：运行时路径不再存在逗号触发词拆分（`trigger-word-source-gate.test.ts` 逐一读取 10 个运行时模块断言无 `.split(",")`/`.split("，")`/宽松分隔正则；唯一例外是 `trigger-words-migration.ts` 的私有旧格式解析，模块导出仅 `migrateProjectTriggerWords` 与 `recoverUnfinishedTriggerWordMigrations`）。
- `git diff --check`：本工作目录无 `.git`，未执行；上轮记录同口径。
- 未执行：浏览器人工验收、真实 LLM/NovelAI 请求、真实用户 Project 的逗号迁移、真实 Project 上的跨组移动与身份同步——均明确为“未执行”，不能用聚焦测试替代。

### 偏差与风险

- 本工作目录无 `.git`，沿用上轮口径：无法创建 worktree/分支/PR，改动直接落地源码目录。
- 迁移器除按计划识别 `,`/`，` 外，也一并拆分已手写的 `|`（新合同里竖线是分隔符，不能残留在值内部），保证输出能通过严格解析器往返；该函数私有且不导出。
- 等价合并/移动的事务日志按 `kind` 字段与分组删除、触发词迁移、身份事务区分，恢复各自只处理自己的日志。
- 发送数据“未保存即离开”的保存路径与后端无冲突 CAS：保存失败时离开保护不解除，用户只能重试或放弃。

## 实施记录（2026-08-17 正文角色调用格式与侧面视角合同施工）

本轮依据 [`正文生图导演格式修复与侧面视角合同施工计划.md`](../../drafts/正文生图导演格式修复与侧面视角合同施工计划.md) 落地，范围限定为 LLM 回复格式门禁、`from side` 角度语义和写入前校验；未执行浏览器、真实 LLM 或 NovelAI 验收。

### 已落地

- 新增 `body-prompt-call.codec.ts`，用平衡扫描替代角色调用正则与 `lastIndexOf()` 未闭合判断；共享 JSON/旧式调用解析、身体状态校验和 front/back 视觉方向推导。
- 新增 `illustration-director.ts`，在 L1 进入 L2 前检查基础 Prompt、分角色正向 Prompt 和负向 Prompt；仅对完整且边界安全的缺尾 `$` 做幂等修复，不可安全修复时交给现有重试。
- `from side`、`side view`、`three-quarter view` 等非背面角度选择正面视觉资料并保留原始 Tag；`from behind`、`from back`、`back`、`behind` 选择背面资料。
- 正文占位符写入前增加严格门禁，生成编译器不再隐式修复，API 将连续规划格式失败映射为可理解的 `422` 错误。

### 验证记录

- 聚焦实现回归（共享 codec、director、正文编译、L1 解析、占位符写入、会话）：`6` 个测试文件、`49/49` 通过；临时测试配置仅为规避本机 Vite/Zod ESM 加载问题，不修改仓库测试配置。
- 文生图相关回归：`63` 个测试文件、`374/379` 通过；剩余 `5` 项为既有 `character-visual.service` 路径断言、代理 dispatcher close 和 provider-fetch 网络 mock 失败，与本轮改动无关。
- `bun --bun node_modules/typescript/bin/tsc --noEmit --pretty false` 通过。
- 未执行：标准 `bun run test`（Bun 可执行映射仍报损坏）、浏览器人工验收、真实 LLM/NovelAI 请求和当前失败章节整体 reroll。

## 实施记录（2026-08-17 独立服装调用解析修复）

本轮依据 [`docs/drafts/正文生图独立服装调用解析修复施工计划.md`](../../drafts/正文生图独立服装调用解析修复施工计划.md) 落地。根因是 codec 将无 `angle` 的 `name` 无条件写入角色字段，导致 `office lady smart casual outfit` 在编译时被当成角色查找；实际服装数据存在于当前角色 visual 中。

### 已落地

- `body-prompt-call.codec.ts` 保留可选 `kind: "character" | "outfit"`，无项目上下文时只产生未决调用；显式 outfit 默认使用 `visible`，旧 inline outfit 的既有字段继续兼容。
- `body-prompt-compiler.ts` 按调用顺序进行语义解析：显式 `kind` 优先；无 `kind` 时在有效 visual 内精确匹配角色/服装，角色与服装同名返回歧义；无角度独立服装优先继承前序角色的 front/back 方向，缺少前序角色时使用 front 并返回 warning。
- `illustration.director` 与正文生图 system prompt 增加显式 `kind` 示例，同时保留旧的无 `kind` 输入和角色内 `outfit` 字段。
- 生图 API 将 `call_invalid` 映射为 `422`、引用缺失/歧义映射为 `409`，并在编译失败时阻止创建队列任务；编译结果增加残留调用硬门禁。
- 新增独立服装、前序 `from side` / `from behind` 继承、名称歧义、无前序 warning、codec kind 和 API 入队边界回归测试。

### 验证记录

- Node 驱动 Vitest 聚焦：新增合同相关 `8` 个测试文件、`62/62` 通过；文生图相关全范围 `75` 个测试文件、`435/435` 通过，覆盖 codec、compiler、director、正文 LLM、占位符插入、正文 API、生成端点、工作台与 DTO。
- Node 驱动 Nuxt typecheck：退出码 `0`。
- `bun run test` 未运行成功：Bun 报 `node_modules` 可执行映射损坏；`bun install --force` 又因 `bun is unable to write files to tempdir: AccessDenied` 失败。未将该环境故障记为业务测试失败。
- 文档构建未通过：VitePress 报告已有规格页 JavaScript 表达式解析错误及中英文教程图片路径缺失；本轮新增文档未出现在错误列表中，未扩大范围修复。
- 纯编译 fixture 已验证现有合同：`from side` 角色 + `office lady smart casual outfit` 独立服装会展开为正面角色/服装 Tag，不再查询名为该服装的角色；真实用户章节未执行供应商出图。
- 未执行：浏览器人工验收、真实 LLM/NovelAI 请求和当前 Project 的实际队列生成。

### 偏差与风险

- 当前工作目录无 `.git`，无法按仓库约定创建 worktree、分支或 PR；改动直接落在源码目录，需后续在具备 Git 元数据的工作区审查提交。
- 本轮保留了旧 inline outfit 使用 `sfw/nsfw` 身体状态的兼容路径；名称引用的独立服装严格使用 `visible/hidden`，新导演输出统一推荐显式 `kind`。

## 实施记录（2026-08-17 正文图片写回可靠性与正文宽度修复）

本轮落地第 20 节施工计划，范围限定为正文图片生成后的持久化、并发覆盖、插入状态和正文图片宽度；未修改 NovelAI Tag 编译、角色视觉资料和 Project SQLite schema。

### 已落地

- 新增 `server/text-to-image/body-image-writeback.service.ts`：服务端从最新章节读取正文，按占位符 ID 局部替换图片；写入经过 Project mutation/history，文件版本变化时有界重试，不再依赖浏览器整篇旧正文。
- `prompt-placeholders/:id/generate` 生成前只读取最新磁盘正文，生成后按本次 Job 查找资产并由服务端写回；占位符已被同来源图片替换时返回 `already_inserted`，占位符确实消失时返回 `missing`，不依据旧浏览器快照重复生图。
- 前端生成前先刷新并保存当前章节，生成期间锁定当前章节编辑器和正文生图按钮，服务端写入后只同步权威正文，不再二次保存整篇旧内容；保存失败不显示成功通知。
- `TextToImageQueueService` 增加 `sourceInsertStatus` 的 `inserted` / `missing` 推进；新增 `prompt-placeholders/:id/recover` 免生图恢复端点，使用已有成功资产写回正文。
- 正文图片改为 `width: 100%`、`height: auto`、取消固定 `560px/360px` 上限，保持正文栏宽度和原始比例。

### 当前 Project dry run

只读检查 `workspace/zai-jie-fan-xiao-dao-shang-de-hou-gong-sheng-huo/manuscript/001-volume/001-chapter/index.md`：

- 当前正文 `4` 个图片引用、`4` 个占位符；
- Project 有 `13` 个成功资产，`9` 个未被当前正文引用；
- `4` 个剩余占位符均有成功资产候选；
- 默认恢复候选为每个来源最近一次成功资产：`tti-dc8a…`、`tti-1e4e…`、`tti-874d…`、`tti-531f…`；
- 已通过一次性 Project Session 维护测试调用正式写回服务完成恢复：正文图片引用 `4→8`、占位符 `4→0`、成功资产保持 `13`，对应 `4` 个 Job 的 `sourceInsertStatus` 已改为 `inserted`；没有新增 NovelAI 请求。

### 验证记录

- 文生图与 Markdown 聚焦回归：`60` 个测试文件、`400/400` 个断言通过。
- 新增正文写回服务测试：覆盖文件版本变化重试、已插入幂等和占位符消失保留资产。
- Node 驱动 Nuxt typecheck：退出码 `0`。
- `bun run typecheck` 未运行成功：本机 Bun 报 `node_modules` 可执行映射损坏；使用等价 Node Nuxt typecheck 验证 app/server/shared 与测试文件。
- 未执行：浏览器人工验收、真实 LLM/NovelAI 出图；当前 Project 的实际恢复写回已完成，并通过 Workspace history 记录。

### 偏差与风险

- 当前工作目录无 `.git`，无法创建 worktree、分支或 PR；改动直接落在源码目录，需后续在具备 Git 元数据的工作区审查提交。
- 当前章节其余历史失败/未引用 Job 仍可能有 `sourceInsertStatus=pending`；本轮只更新了实际写入的 `4` 个 Job，未绕过 Workspace history 批量改写其余历史记录。
- 第一版生成期间锁定当前章节编辑器，以保证未保存 TipTap 内容不会覆盖服务端写回；若未来允许边生成边编辑，需要另行实现增量合并合同。

## 实施记录（2026-08-18 图片块队列恢复与自动保存冲突修复）

本轮针对“一个图片块排队时其它图片块不可用”“偶发提示当前章节尚未成功保存”以及服务端写回后反复出现真实文件冲突，落地队列消费者与前端保存协作修复；未修改 NovelAI 最终 Tag 组合合同和数据库 schema。

### 已落地

- **Project 级单消费者 FIFO**：新增 `queue-runtime.ts` 作为所有入口的唯一消费者；队列处理器按 `createdAt` 升序、ID 作为稳定 tie-breaker，避免 Prisma 最新优先查询造成 LIFO。正文生成接口只创建 Job 并返回 `202`，NovelAI、资产保存和正文写回全部在消费者完成；通用 Job 入队、角色头像和历史图片后处理也复用同一消费者。
- **图片块独立入队**：新增 Job 状态查询端点。前端每个图片卡片只维护自己的“排队或生成中”状态并轮询自己的 Job；编辑器整体仍保持正文写回保护，但其它图片卡片在编辑器只读期间仍可点击入队，不再被全局 `editor.isEditable` 拦截。
- **写回版本接纳**：Job 终态返回服务端实际写回的章节内容和文件节点，前端原子更新正文、buffer、tab 与同步 mtime，清理本地冲突状态；服务端自己写入的 mtime 不再被下一次保存误判为外部冲突。
- **保存竞态收口**：所有保存请求串行化；图片卡片失焦触发的自动保存在正文未 dirty 时直接跳过，不再重复提交相同 `expectedMtime`。已有自动保存会先被等待，已同步正文不会为每个图片块再次写文件。
- **终态保护与故障收口**：取消后的 Job 不会被迟到的成功/失败结果覆盖；消费者级数据库/依赖故障会尽力把尚未领取的 queued Job 标记为 failed，避免前端永久轮询。

### 验证记录

- 队列、正文生成端点、Markdown NodeView、Store 聚焦回归：`5` 个文件、`36/36` 通过（另补充正文 Job 写回、状态投影故障和只读卡片独立入队断言）。
- 文生图、正文 API 与 Markdown TipTap 全部聚焦回归：`68` 个文件、`415/415` 通过。
- Node `tsc --noEmit --pretty false -p tsconfig.json`：通过。
- Node Nuxt typecheck（`.env.typecheck`）：退出码 `0`。
- 未执行：浏览器人工走查、真实 LLM/NovelAI 请求和当前用户 Project 的长时间队列运行；这些不能用聚焦测试替代。

### 偏差与风险

- 当前工作目录无 `.git`，无法创建 worktree、分支或 PR；改动直接落在源码目录，需后续在具备 Git 元数据的工作区审查提交。
- 生成期间正文编辑仍保持只读，以保证服务端按占位符局部写回不覆盖未保存文本；本轮只放开其它图片卡片的入队按钮，允许正文边生成边编辑仍需另行设计增量合并合同。

## 实施记录（2026-08-18 重复正文锚点按回复顺序插入，初版）

本轮适配新的正文 LLM 模型与生图预设。根因是插入服务把多个 `<image>` 块共用同一唯一正文锚点误判为 `anchor_conflict`；解析器和插入列表本身已经保留 LLM 回复顺序，因此只放宽重复锚点合同，不改数据库、NovelAI Tag 编译或队列。

### 已落地

- `body-image-insert.service.ts` 删除重复锚点阻断，并缓存每个锚点对应的唯一正文行；相同锚点的多个占位符通过同一行的插入列表按 LLM 回复顺序依次写入，每个占位符仍生成独立 ID。
- 本阶段先保留 `anchor_missing` 和 `anchor_ambiguous` 作为显式失败；零命中/多命中的最终降级规则已在下一节实施记录中调整。
- 正文生图 system prompt 明确允许多个 `<image>` 共享挂载点，并说明后端按回复顺序插入。
- 新增插入服务和正文会话回归，覆盖重复锚点、同一正文行的不同锚点顺序、独立 ID 以及多行歧义保护。

### 验证记录

- 聚焦回归：新增合同相关 `6` 个测试文件、`43/43` 通过；文生图相关全范围 `76` 个测试文件、`451/451` 通过。
- Node 驱动 Nuxt typecheck（`.env.typecheck`）：退出码 `0`。
- 未执行：浏览器人工验收、真实新 LLM/NovelAI 请求和真实用户章节重跑。

## 实施记录（2026-08-18 正文生图逐块容错与锚点降级）

本轮继续适配新正文 LLM / 生图预设，重点是弱模型输出不完整时的可恢复性。合同从“整批定位失败即阻塞”调整为“逐块诊断、能插入的先插入”，但保留整次无可用块时的无副作用阻塞。

### 已落地

- L1 `<image>` 回复改为宽容逐块解析：完整块进入 `illustration.director`，缺少必要字段、坐标非法、角色调用无法安全修复或尾部截断的块只生成诊断并跳过；其它完整块继续处理，不再为整次回复做应用层重试。
- anchor 零命中时将对应占位符追加到正文末尾并返回 `anchor_appended`；多命中时使用第一条正文行并返回 `anchor_first_match`；相同 anchor 仍按 LLM 回复顺序插入。
- 当整次回复没有任何可用块时抛出稳定的 `no_usable_blocks` 堵塞错误，正文不修改、不保存、不创建后续图片任务；API 返回 422，前端不会显示成功或部分成功提示。
- 有效块成功写回后，前端根据服务端诊断显示跳过块、末尾追加和首行选取的数量；诊断不包含完整正文或原始 Prompt。

### 验证记录

- 聚焦正文生图、API、会话、插入和工作台合同回归：`4` 个核心文件、`32/32` 通过；新增宽容解析、部分成功、零可用不重试、零命中和多命中降级断言。
- 文生图相关全范围：`76` 个测试文件、`457/457` 通过。
- Node 驱动 Nuxt typecheck（`.env.typecheck`）：退出码 `0`。
- 未执行：浏览器人工走查、真实新 LLM/NovelAI 请求和真实用户章节重跑；这些仍需单独验收。

## 研究记录（2026-08-18 文生图插件化与压缩包分发）

本轮启动“官方 master 源码工作区解压即安装、删除目录即卸载”的文生图扩展化阶段，只完成基线审计和施工合同，尚未修改运行时代码。详细计划见 [`文生图插件化与压缩包分发施工计划.md`](文生图插件化与压缩包分发施工计划.md)。

### 已确认

- 审计基线为官方 `master` 提交 `5e55c54e13cd67f6e19c5361931fca1fe9ae4241`（2026-08-16）。该基线没有通用扩展清单、Nuxt 扩展扫描器或 Novel IDE / Markdown Studio 扩展插槽。
- 当前工作区有 `224` 个路径名直接包含 `text-to-image` / `TextToImage` 的文件；除专属目录外，还修改了 `21` 个非生成的既有核心文件，并修改两套 Prisma schema 和相应生成代码。
- 因此把当前分支直接压成覆盖官方源码的 ZIP 只能得到补丁包，无法通过删除单一目录卸载。最终合同要求先把通用扩展宿主合入官方 master，文生图发布包之后只新增 `extensions/text-to-image/`。
- 扩展使用 Nuxt Kit 现有 `addServerScanDir`、`addComponentsDir`、`addPlugin` 和 `addServerPlugin` 接入；前端通过通用贡献注册表接入 Activity Bar、Novel Workspace、Markdown 扩展和图片动作，不允许 DOM 注入或 Vue monkey patch。
- 文生图表将改为扩展命名空间表和 typed raw-SQL repository，不再修改 Prisma schema / generated client。默认卸载保留正文、图片、角色视觉资料、Provider 密文和历史元数据；数据清理是独立显式动作。
- 发布包不得修改根 `package.json` / `bun.lock`；当前新增的 `@huggingface/transformers` 必须在扩展构建时自包含或由保持 T5 估算合同的扩展内实现替代。

### 验证边界

- 已只读克隆并检查官方 master；临时基线位于 `.agent/tmp/`，不属于发布包。
- 未运行测试、typecheck、构建或浏览器验收，因为本轮没有修改业务代码。
- 未读取或改写 Project Workspace、小说正文、API Key、数据库、生成图片或其它用户私有数据。

## 实施记录（2026-08-18 覆盖式安装包 v1）

在通用扩展宿主落地前，先为官方 `master` 提交 `5e55c54e13cd67f6e19c5361931fca1fe9ae4241` 生成过渡覆盖包。该产物不是最终插件，不支持删除单一目录卸载；详细白名单、验证证据和限制见 [`文生图插件化与压缩包分发施工计划.md`](文生图插件化与压缩包分发施工计划.md#12-过渡实施记录覆盖式安装包-v12026-08-18)。

- 产物 `neuro-book-text-to-image-overlay-v1-master-5e55c54e.zip`：`901657` bytes，SHA-256 `aa51e74085cb1789f37f8d320cf23846b505a4e32de8cf41576c74e85d2ac2b5`。
- ZIP 含 `195` 个白名单源码文件和 `2` 个元数据文件；逐文件哈希全部一致，凭据/本机路径、禁止路径或扩展名、测试文件扫描均为 `0` 命中。
- 干净 master 解压后：`bun install --frozen-lockfile` 成功，Prisma `7.8.0` 两套 Client 生成成功，Nuxt typecheck 通过，聚焦回归 `45/45` 通过。
- 隔离浏览器实测：Provider、上下文预设、请求绑定、参考图、画风串、历史图片、角色和固定发送选择均为空；只保留 `default` 敏感词替换档案、空的 `default` 角色分组和内置 NovelAI 参数。

## 施工设计记录（2026-08-19 角色别名、图片块状态与工作台交互）

本轮只完成施工设计，没有修改业务代码或用户 Project。完整计划见 [`文生图角色别名队列状态与工作台交互修复施工计划.md`](../../drafts/文生图角色别名队列状态与工作台交互修复施工计划.md)。

### 已确认的问题

- 角色英文名称中的 `|` 没有按别名拆分，导致 LLM 使用其中一个英文名时无法通过显式角色调用定位视觉资料；该结论已用当前编译入口复现，公开计划未记录用户 Project 名称、角色名称或正文。
- 图片块状态由 TipTap NodeView 的局部 `generating` 布尔值维护，页面或编辑器重建后必然复位；Project Job 已持久化，后续应从服务端批量恢复状态。
- 角色树的角色行目前只展开或折叠，具体 JSON 行才会切换右侧资料；服装 LLM 修改又用选中索引隐式决定覆盖目标，缺少“新增服装”意图。
- 画风串选择、应用、保存、重命名和底部保存共用 `saveStyle()`，草稿与已保存配置没有分离；新建入口只藏在下拉选项中。
- 前端和服务端共同禁止删除当前生效版本与最后一份视觉 JSON，用户无法从分组中移除该角色的视觉资料。

### 设计结论

- 不新增数据库字段，不修改视觉 JSON schema；英文名称现有 `|` 数据直接兼容。
- 图片块状态以 Project Job 为真相，按章节批量投影到卡片，支持页面切换和整页刷新恢复。
- 保留原有角色服装修改入口与 API；回复只有服装时进入候选确认，让用户逐项选择覆盖当前服装、增加或不应用。
- 画风串使用独立草稿和单一主保存入口；新建入口常驻可见，低频管理收进菜单或对话框。
- 删除视觉 JSON 先预检影响；删除生效版本时原子回退，删除最后一份时从当前分组移除角色，但保留角色档案、照片、历史任务和正文图片。

### 实际多服装回复补充

- 一次真实“生成角色的服装”回复包含标签外自然语言和连续 `3` 个完整 `<服装>` 块；当前解析器能完整识别三套服装，格式本身不是问题。
- 当前合并器在服装索引 `0` 被默认选中时，会用第一个返回块覆盖原服装，再把后两个块追加；若原来只有一套，数量看起来仍为三套，但原服装已丢失。索引为 `null` 时三套才会全部追加。
- 服务端会为后续未命名匹配项产生“将创建新服装”警告，但当前前端待确认草稿没有接收或展示 `warnings/changedFields`，用户无法知道实际合并决定。
- 不新增服装入口、请求类型或端点。现有修改预览检测到“没有人物字段、至少一套完整服装”时返回 `outfit_only` 候选；用户逐项选择覆盖当前服装、增加或不应用，同一批最多一套覆盖当前服装。
- 候选初始为未选择，决定完成后才机械组成最终视觉草稿并继续调用现有修改提交接口；最终动作不能再由选中索引或回复顺序隐式决定。
- 某个服装块不完整时只跳过该候选；其它完整候选仍可确认。整次没有任何可用候选或人物补丁时才无副作用阻塞。

### 验证边界

- 本轮未运行测试、typecheck、浏览器验收或真实 LLM/NovelAI 请求，因为没有业务实现变更。
- 本轮未改写 Project Workspace、小说正文、角色视觉资料、API Key、数据库或生成图片。

## 实施记录（2026-08-19 施工落地）

本轮按上述设计完成源码施工，未触碰用户 Project、小说正文、API Key、数据库或生成图片。

### 已落地

- 角色英文名称按 `|` 拆分为主名与别名；正文扫描、显式角色调用、角色摘要均使用同一别名合同。
- 纯服装 LLM 回复沿用 `character-visual.modify-preview`，返回 `outfit_only` 候选；前端逐套选择覆盖、增加或不应用，最多覆盖一套，未完整候选不会阻塞其它完整候选。
- 图片块状态使用跨 NodeView 生命周期的状态总线，排队、运行、失败、取消和正文写回待恢复状态不会因编辑器/工作台页面重建而丢失；单块任务不再把整篇正文设为只读。保存协作改为按请求对应 buffer 判断，避免切页期间误报“章节尚未成功保存”。
- 角色树角色行直接选择当前视觉资料，服装页移除中间“应用服装修改”按钮并就地提供现有修改链路；角色、服装和照片要求文本分离。
- 画风串新增常驻入口，选择仅加载草稿，名称/分组/模型参数统一由唯一主保存按钮提交，移除重复应用、重命名和页面底部保存入口。
- 视觉 JSON 删除加入预检、manifest revision 校验、生效版本回退、最后版本空目录处理和固定发送引用回退/移除；照片、历史任务、角色原始档案和正文图片不主动删除。

### 验证记录

- Node 驱动 `vue-tsc --noEmit --pretty false -p tsconfig.json`：通过。
- 角色别名、纯服装、视觉删除服务：`3` 个文件、`34/34` 通过。
- Markdown 图片 NodeView、工作台点击契约、正文编译与占位符 API：`6` 个文件、`54/54` 通过。
- 未执行：浏览器人工走查、真实 LLM/NovelAI 请求和当前用户 Project 长时间队列验收；这些仍需单独授权。

## 实施记录（2026-08-19 跨角色服装草稿污染修复）

本轮修复角色切换时服装表单沿用上一角色第 0 套服装、误报未保存并可能跨角色覆盖的问题。只修改工作台源码和测试，未读取或改写用户 Project、视觉 JSON、小说正文、API Key 或生成图片。

### 已落地

- 服装草稿绑定 `groupId + characterId + visualId + outfitIndex`；归属不一致时保存硬阻止，避免任何跨角色写回。
- 视觉资料加载完成后显式同步服装草稿，不再依赖索引是否发生变化；请求期间清空旧角色的可编辑字段。
- 视觉加载增加请求序号和当前选择校验，迟到的旧角色响应直接丢弃。
- 资料库刷新不再重复应用 `initialCharacter`；保存后保持当前角色和视觉版本。
- 保存改为无副作用构造请求，成功后接纳已保存草稿再刷新，避免保存后再次弹出虚假的未保存确认。
- 新增双角色同索引切换、迟到响应、当前角色服装保存和初始角色刷新回归测试。

### 验证记录

- 工作台、角色视觉和离开保护聚焦回归：`7` 个文件、`54/54` 通过。
- Vue TypeScript 检查：通过。
- TypeScript 检查：通过。
- 未执行：浏览器人工验收、真实 LLM/NovelAI 请求和当前用户 Project 数据恢复；数据恢复必须基于用户明确提供的备份或可信旧版本单独处理。

## 实施记录（2026-08-21 NovelAI Diffusion V5）

本轮依据 NovelAI V5 官方发布说明和官方 Web 客户端出站合同，将 `nai-diffusion-5-full`、`nai-diffusion-5-curated` 纳入文生图模型支持；既有配置默认模型保持 V4.5 Full，不做静默升级。

### 已落地

- Provider 根设置、参数档案和画风串均可持久化 V5 Full/Curated，不再被旧配置规范化逻辑降级到 V4.5。
- V5 请求沿用 `/ai/generate-image` 与 `v4_prompt` / `v4_negative_prompt`，改用 `params_version: 4`、Karras，并使用 Guidance `7`、Euler Ancestral、`23` steps 的首发默认值；V5 不再发送 V4.5 的 Variety+、CFG delay 和 Decrisp 字段。
- V5 Full 局部重绘使用 `nai-diffusion-5-full-inpainting`；V5 Curated 首发按官方客户端回退到 `nai-diffusion-4-5-curated-inpainting`，action 使用 `infill`。
- 补齐 V5 的正负质量预设和 `ucPreset` 映射。设置页增加 V5 Full/Curated 选项；选中 V5 时显示 Qwen 分词器上限，避免继续展示 V4.5 的 T5/512 估算。
- V5 首发不支持 Vibe Transfer 和角色参考图：已保存配置不会被删除，但启用这些参考图时会在任何编码或生图网络请求之前给出明确错误。

### 验证记录

- DTO、配置规范化、请求 payload、质量预设、图片请求和设置页合同：`6` 个文件、`46/46` 通过。
- Bun 的测试 shim 因当前 `node_modules` 可执行映射损坏无法启动；上述测试使用 Codex 随附 Node 直接运行现有 Vitest 本体完成。
- 未执行：浏览器人工验收和真实 NovelAI V5 出图；NovelAI 官方首发能力变化仍需在后续版本重新核对 Vibe/角色参考与 Curated 独立重绘支持。

## 施工设计记录（2026-08-22 图片资产交互、当前画风串重 roll、V5 参数与 LLM 预设导入）

本轮只完成只读调查和施工合同，没有修改业务代码、配置、数据库或用户数据。详细合同见 [`image-asset-actions-reroll-v5-contract.md`](image-asset-actions-reroll-v5-contract.md)。

### 已确认

- 正文图片后处理弹窗当前只有约 `720px` 宽，原图和 inpaint 区域分别固定为 `360px`、`320px` 高，菜单覆盖图片中央；历史图片点击后只有生成信息，没有大图。
- 后处理和历史详情都缺少复制图片能力；已有 content API、原图预览和 Blob 下载工具可复用，不需要新增公开图片接口。
- 当前无修改“发送”没有调用 `/reroll`；服务端会复用历史最终 Prompt、NovelAI 参数和 Provider 快照，真实语义是随机 Seed 重放历史请求。
- 工作台选择画风串只更新本地表单，服务端只有在保存后才能看到活动 ID；后续必须把“当前已保存画风串”设为重 roll 的唯一配置真相源。
- chatu-8 最新主干已出现 V5 的 `native`、DDIM、专属 UCP 和 Variety 处理；`straight_alpha`、`tag_hint_qt`、`tag_hint_uc_preset` 目前只在 SillyTavern 代理转发处出现且缺少稳定赋值来源，不能直接复制进 NovelAI 官方直连请求。
- 本地 V5 资产的最终 Prompt Bundle 仍被写成 `modelFamily: "nai4"`，应通过新 Bundle 版本修正，不批量改写历史数据库。
- 用户提供的三份真实 chatu-8 导出分别包含 `30` 条、`185` 条以及 `14` 个预设/`2635` 条；共 `2850` 个条目全部具有非空 `entries[].name`。本地导入器和 DTO 已读取该字段，实际缺陷是条目界面固定显示“条目 N”、没有名称输入框，且测试未断言名称。

### 设计结论

- 后处理改为接近全屏的左右工作台；动作移出图片覆盖层，inpaint Canvas 对齐图片真实 contain 矩形。
- 后处理和历史大图共用 Blob 获取、PNG 剪贴板和下载能力；复制的是实际图片，不是 URL。
- 历史大图继续只读，不增加重 roll、Tag 修改、局部重绘、正文替换或删除。
- 无修改重 roll 使用 `/reroll`；重 roll 和 Tag 修改后发送只继承源 Job 的基础 Prompt、负面 Prompt、角色槽和正文血缘，模型、画风串、参数、Provider 和凭据修订号全部取点击时当前已保存配置。
- 活动画风串切换使用窄作用域持久化，只更新活动 ID，不自动保存其它草稿；未保存模型参数不会偷偷进入重 roll。
- inpaint 继续保持历史模型/参数语义，不随本轮重 roll 合同变化。
- V5 使用集中式模型能力表和请求金样；缺少权威证据的代理字段保持禁用并显式报告，不猜默认值。
- LLM 预设条目卡标题显示真实 `entry.name`，编辑区提供“条目名称”输入框；名称必须经过导入、保存、刷新和再次导出完整往返，空名称只使用不落盘的“条目 N”显示回退。
- 条目名称只用于管理界面，不拼入 Prompt；不为已验证的 `name` 字段臆造别名，也不把用户真实预设或 Prompt 内容提交为测试夹具。

### 验证边界

- 本轮未运行测试、typecheck、浏览器验收或真实 NovelAI 请求，因为没有业务实现变更；三份用户预设只做 JSON 字段与数量核对。
- 当前目录不是 Git 仓库；正式施工前必须在具备 Git 元数据的真实仓库中按 worktree/分支流程执行。

## 施工记录（2026-08-22 开工前偏差与决策）

本次施工在 `F:\\neuro-book-new-text-to-picture-clean` 净化副本直接进行。已确认该副本没有 `node_modules` 和 Git 元数据；不初始化 Git、不访问 `D:\\neuro-book-new-text-to-picture`，也不读取用户 Project、小说正文、workspace、API Key、`.env`、会话、数据库或生成图片。依赖如需安装，只安装到当前 F 盘项目。

### 合同与现状偏差

- 后处理资产弹窗仍使用约 `720px` 的 `lg` 布局，原图和局部重绘区域固定为 `360px`、`320px` 高，动作菜单覆盖图片；历史资产只有信息弹窗。
- 图片 Blob 复制、下载能力尚未形成后处理与历史详情共用的动作层；现有下载工具也没有异常路径下的 URL 清理保障。
- 资产无修改发送没有走重 roll 路由，服务端会从历史最终 Prompt、历史 NovelAI 参数和历史 Provider 快照组装新任务，未满足“点击时当前已保存配置”合同。
- 活动画风串当前主要停留在本地表单，服务端没有只更新 `activeGenerationRecipeId` 的窄接口；若直接复用整 Provider 保存，会把未保存草稿带入重 roll。
- V5 代码已有模型、质量预设和基本请求分支，但请求仍固定 `karras`，能力校验和 V5 Variety/Bundle v2 没有统一合同；因此本轮保留现有可验证字段，不臆造缺少稳定来源的代理字段。
- 上下文导入器已经读取 `entries[].name`，但界面固定显示“条目 N”、没有名称编辑框，现有测试没有断言名称保存、刷新和再次导出。

### 实施决策

- 先补充能复现上述旧行为的 Vitest 合同测试，再按阶段 A 到 H 实现；测试夹具只使用合成内容。
- 重 roll/Tag 发送从源 Job `requestJson` 读取基础 Prompt、负面 Prompt 和角色槽；点击时通过当前认证用户的 NovelAI Provider 与已保存画风串入队。inpaint 继续保留历史快照语义。
- 新生成任务写 Prompt Bundle v2，旧 Bundle v1 继续只读解析，不批量改写历史资产或数据库结构。
- 活动画风串切换只持久化 `activeGenerationRecipeId`，并用请求序号/取消和当前值校验处理迟到响应；切换失败恢复上一个已保存值。

## 实施记录（2026-08-22 图片资产交互、当前画风串重 roll、NovelAI V5 与 LLM 预设导入）

本轮已按上方合同阶段 A–H 在 `F:\neuro-book-new-text-to-picture-clean` 净化副本落地。没有读取、复制或修改 `D:\neuro-book-new-text-to-picture`，没有导入本地小说、Workspace、用户 API Key、`.env`、会话、数据库或生成图片；没有新增 Prisma 列、迁移或远程 Git 操作。

### 已落地

- 后处理工作台改为大尺寸左右布局，原图可读，局部重绘 Canvas 使用真实 contain 矩形、源图坐标和不超过 `2` 的 DPR；历史图片改为可读大图的只读详情。复制通过实际图片 Blob 和 PNG `ClipboardItem`，下载统一处理空文件、MIME 扩展名、文件名清理和 URL 回收。
- `/reroll` 与 Tag 修改后的发送共用当前配方请求组装：只继承源 Job 的基础 Prompt、负面 Prompt、角色槽和正文血缘，点击时解析当前认证用户的 NovelAI Provider、已保存活动画风串以及不含 Key 的模型/参数快照；不再重放历史最终 Prompt、历史模型/参数或历史 Provider。inpaint 仍保留历史快照语义。
- 活动画风串增加窄作用域接口，只更新 `activeGenerationRecipeId`；前端区分已保存值与未保存草稿，使用请求序号和失败回退防止迟到响应覆盖当前选择。队列携带入队时安全 Provider 设置快照，消费者优先使用该快照，避免排队期间修改 Provider 导致模型/参数漂移。
- NovelAI 能力集中在 `shared/text-to-image-novelai-capabilities.ts`：V5 使用 `params_version: 4`，`native`/DDIM 等已验证组合，V5 Variety 使用 v4 sigma 族；V4.5/V5 的引用图校验、inpaint 模型、质量参数归属和请求字段分别处理。未知来源的 `straight_alpha`、`tag_hint_qt`、`tag_hint_uc_preset` 未加入官方直连请求。
- 最终 Prompt Bundle 新写 v2 并记录 `modelFamily` 与实际模型，历史 v1 继续只读解析；Tag 发送和重 roll 不再依赖最终 Bundle。LLM 预设导入、编辑、保存、刷新和导出保留 `entries[].name`；空名称只显示不落盘的“条目 N”，名称不进入 LLM Prompt。507 条 synthetic entries 的首、中、尾往返已覆盖，未复制真实预设内容。

### 实际改动文件

- 前端与公共工具：`app/components/novel-ide/text-to-image/TextToImageAssetActionDialog.vue`、`TextToImageHistorySection.vue`、`TextToImageLlmSettingsSection.vue`、`TextToImageNovelAiSettingsSection.vue`、`app/utils/browser-download.ts`、`app/utils/text-to-image-image-actions.ts`。
- Shared：`shared/text-to-image-novelai-capabilities.ts`、`shared/text-to-image-novelai-prompt.ts`。
- Server：`server/api/text-to-image/assets/[id]/reroll.post.ts`、`server/api/text-to-image/assets/[id]/send.post.ts`、`server/api/text-to-image/providers/[id]/active-generation-recipe.put.ts`、`server/text-to-image/asset-postprocess.service.ts`、`final-novelai-prompt.ts`、`novelai-image-generation.ts`、`novelai-payload.ts`、`novelai-quality.ts`、`novelai-settings-normalizer.ts`、`provider.service.ts`、`queue.processor.ts`、`queue.service.ts`。
- 回归测试：`app/components/novel-ide/text-to-image/context-entry-name.contract.test.ts`、`image-interaction.contract.test.ts`、`app/utils/text-to-image-context-import.test.ts`、`text-to-image-image-actions.test.ts`、`shared/text-to-image-novelai-capabilities.test.ts`，以及对应的 `server/text-to-image/asset-postprocess.service.test.ts`、`final-novelai-prompt.test.ts`、`llm-context.test.ts`、`novelai-image-generation.test.ts`、`novelai-payload.test.ts`、`novelai-quality.test.ts`、`novelai-settings-normalizer.test.ts`、`provider.service.test.ts`、`queue.processor.test.ts`。

### 验证记录

- 合同聚焦 Vitest：`15` 个文件、`90/90` 通过。
- 快照脱敏收口后的 Provider/队列回归：`2` 个文件、`24/24` 通过。
- 文生图相关 Vitest 广泛套件：`81` 个文件，`503` 通过、`5` 个测试失败（Vitest 失败区块 `7` 条，涉及 `3` 个文件）；失败均为既有/环境相关：网络 dispatcher mock/清理接口不匹配（`provider-fetch.test.ts`、`novelai-proxy.test.ts`），以及字符视觉测试的 `null`/`undefined` 清理断言（`character-visual.service.test.ts`）。未把这些环境故障改成业务绕过。
- 变更实现 TypeScript 根文件自检：`17` 个通过；4 个相关 Vue SFC 的 compiler parse/compile 检查通过。
- 项目原命令 `bun run typecheck` 未通过：`Bun failed to remap this bin to its proper location within node_modules.`，并提示 `This is an indication of a corrupted node_modules directory.`；当前副本依赖安装在 Windows 临时目录阶段受限/中断，因此用 bundled Node 的 TypeScript API 完成了变更根文件检查。没有将项目级 typecheck 结果误报为通过。

### 偏差与未验证项

- 当前产品代码没有持久化“当前 Provider”选择器；为保持现有单 NovelAI Provider 工作台合同，服务端使用当前用户 NovelAI Provider 列表中最低 id 的记录。若未来支持多个同类 Provider，需要新增明确的持久化选择器，而不是继续依赖排序推断。
- 合同只确认 V5 Variety 属于 v4 sigma 族，没有提供与现有 V4.5 数值公式不同的权威数值；能力表因此记录族别并保留现有公式。这是有意标注的证据缺口，不宣称已完成 NovelAI 官方数值复核。
- 未执行浏览器人工验收、真实 NovelAI 出图、真实 LLM 请求或用户数据恢复；本轮不读取 D 盘数据，不能把这些项目宣称为通过。

## 实施记录（2026-08-23 V5 Prompt Guidance 持久化修复）

本轮修复 V5 的 `Prompt Guidance` 和 `Steps` 在保存、重新载入或切换画风串时被首发默认值覆盖的问题。根因是模型默认值函数同时承担了模型能力兼容化，并在上述三个非模型切换入口无条件写入 Guidance `7` 和 `23` steps。

### 已落地

- 模型能力兼容化与模型切换默认值已经拆分：载入 Provider 和切换画风串只修正不受当前模型支持的采样器、噪声表，不再改写合法的调优参数。
- Guidance `7` 和 `23` steps 只在用户主动切换到 V5，或旧 V5 Provider 确实缺少对应字段时补入；保存前不再应用默认值。
- 新增设置页 DOM 回归，覆盖旧配置缺字段、V5 参数载入与保存、画风串切换，以及主动切换模型四条路径；同时断言 Provider 根设置和活动画风串快照都保留用户输入值。

### 验证记录

- V5 设置、DTO、能力表、Provider 持久化、配置规范化、队列映射、payload 与图片请求聚焦回归：`8` 个文件、`74/74` 通过。
- Nuxt 类型检查运行完成但未通过；错误仅来自既有 `app/utils/text-to-image-image-actions.test.ts` 的三处 Fetch mock，因缺少新版 `typeof fetch` 所需的 `preconnect` 属性。本轮组件和回归测试没有新增类型错误。
- 未执行浏览器人工验收和真实 NovelAI V5 出图。

## 实施记录（2026-08-23 新版预设方位词解析兼容）

本轮修复新版 chatu-8 上下文预设使用自然语言方位词和 `sāfe&` 认证前缀时，完整 `<image>` 块被正文生图解析器逐块淘汰的问题。改动只涉及 LLM 回复解析合同与聚焦测试，没有读取或改写 Project、小说正文、视觉资料、API Key、数据库或生成图片。

### 已落地

- 保留旧版 `A1`–`E5` 网格和 `0`–`1` 二维数值坐标；新增 `left` / `center` / `right`、`background` / `middleground` / `foreground` 以及 `top` / `bottom` 方位词，兼容常见英文变体和中文方位词。
- 方位词确定性映射到五格坐标的 B/C/D 行列：左/上/背景为 `0.3`，中为 `0.5`，右/下/前景为 `0.7`；只给出一个维度时，另一个维度使用 `0.5`。
- `sāfe&`、`safe&` 只在 `<prompts>` 绘图提示字段进入结构解析前移除，不修改 `<regex>` 正文锚点、标题或正文；清理后的 Scene、角色 Prompt、UC 和 centers 不再把认证前缀发送给 NovelAI。
- 完全未知的位置值仍按无效块报告；单个坏块继续只产生诊断，不会阻塞同次回复中的其它完整块。

### 验证记录

- 正文 LLM 解析聚焦回归：`1` 个文件、`23/23` 通过，覆盖旧数值、旧网格、新方位词、中英文变体、上下位置、认证前缀清理和未知值拒绝。
- 正文解析、占位符插入、最终 Prompt Bundle 与 NovelAI 请求组装回归：`4` 个文件、`50/50` 通过。
- 使用用户本次提供的原生 LLM 回复做本地临时回归：解析与完整 director 处理链均为 `20/20` 个图片块可用、`0` 个诊断；原生回复没有写入源码或测试夹具。
- Nuxt 类型检查已运行但未通过；仍是既有 `app/utils/text-to-image-image-actions.test.ts` 三处 Fetch mock 缺少 `preconnect` 的类型错误，本轮没有新增该文件或相关改动。
- 未执行浏览器人工验收、真实 NovelAI 出图或真实 Project 正文插入。

## 实施记录（2026-08-23 后处理随机 Seed 与错误透传修复）

本轮修复重 roll、Tag 修改后发送和局部重绘把内部随机 Seed 标记 `-1` 直接发送给 NovelAI，以及 Job 失败后被误报为“任务已完成但未找到新图片”的问题。诊断只读取指定 Job 的状态、错误字段和资产关联，没有读取 Prompt、API Key、小说正文或图片内容；施工没有改写既有 Job、资产或用户配置。

### 已落地

- `-1` 继续作为队列内部的随机 Seed 标记；队列消费者在出站前将其解析一次为 `0`–`4294967295` 的随机整数，NovelAI 请求和资产记录共用该实际 Seed。
- NovelAI 直调边界也拒绝负数出站；即使调用方绕过队列传入 `-1`，HTTP payload 仍只包含合法 `uint32`。
- 后处理等待队列结束后先读取新 Job 的终态：`failed` 直接返回队列保存的真实错误，`canceled` 和异常非终态分别报告，不再统一覆盖成资产查找失败；只有 `succeeded` 后仍无资产才保留“未找到新图片”作为数据一致性错误。
- 重 roll、Tag 修改后发送和局部重绘共用同一队列/NovelAI 边界，因此三条路径同时获得随机 Seed 修复和真实错误透传。

### 验证记录

- NovelAI 请求、队列消费者和后处理服务聚焦回归：`3` 个文件、`34/34` 通过。
- 当前画风串、最终 Prompt、Provider、图片交互与上述链路联合回归：`7` 个文件、`60/60` 通过。
- Nuxt 类型检查已运行但未通过；仍只有既有 `app/utils/text-to-image-image-actions.test.ts` 三处 Fetch mock 缺少 `preconnect` 的类型错误，本轮文件没有新增类型错误。
- 未执行真实 NovelAI 扣费请求、浏览器人工验收或既有失败 Job 自动重试；修复后由用户重新点击即可创建新 Job，旧失败记录保持可追溯。
