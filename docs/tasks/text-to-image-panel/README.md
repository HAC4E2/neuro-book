# Text To Image Panel

## User Request

- 在网页前端新增“文生图”分页。
- 支持配置 NovelAI API。
- 支持保存、启用和切换多套画风串。
- 支持角色管理，角色包含中英文名称、性格年龄、外貌与 SFW/NSFW 身体 tag。
- 支持单独配置一个 LLM API 连接和模型。
- LLM 需要配置 Temperature、Top P、Max Tokens，Max Tokens 上限为 30000，支持滑动和手动输入。
- LLM 需要提供连接按钮，连接成功后读取服务返回的可用模型列表，并从该列表中选择模型；连接失败时显示“连接失败”。
- LLM 需要按任务维护提示词，任务包括正文图片生成、角色/服装设计、角色/服装修改，提示词可手动编辑或导入。
- 角色需要按当前小说分组，当前启用角色绑定当前创作小说。
- 新增角色支持手动添加，也支持从任意小说的角色设定导入，并调用 LLM 生成角色/服装 tag 草稿。
- 修复文生图分页没有独立滚动区域，底部内容无法点击的问题。
- 文生图分页中的各个配置区块需要支持折叠。
- 将正文生图的角色 tag 从旧酒馆式角色管理迁移为 Project Workspace 中的 Markdown 文件管理。
- `image-tags.md` 按角色中文别名、英文名、角色特征、正背面五官、SFW/NSFW 身体分区、负面提示词和服装列表维护。
- 正文生图只注入章节相关角色；通过专用子 agent 识别章节内相关角色，并把命中的角色 image-tags 注入 LLM 请求变量。
- 保留并结合现有提示词替换功能，不让旧角色/服装管理成为正文生图的必要入口。
- 在 Project Workspace 角色详情页右上方增加“生成角色 tag”按钮。
- 点击后先保存当前角色详情页，再通过子 agent 提取外貌信息，交给 LLM 生成 tag，并写入角色目录中的 `image-tags.md`。
- 角色目录结构约定为 `lorebook/character/<角色目录>/index.md` + `lorebook/character/<角色目录>/image-tags.md`；现有 `index.md` 目录不自动移动或改名。

## Goal

- 先完成文生图工作台的配置层、本地持久化状态、角色复用入口和 LLM 辅助生成人设 tag 的前端链路，为后续真实 NovelAI 生图请求、任务队列、结果保存留出结构。
- 本轮目标是把正文生图角色 tag 改为 `image-tags.md` 文件真相源，并建立“章节正文 -> 角色识别子 agent -> 只注入命中角色 tag -> 正文生图 LLM 变量”的链路。

## Current State

- IDE 左侧栏已有“文生图”入口。
- 文生图面板已挂入工具面板区域，并拥有独立滚动容器。
- NovelAI API、画风串、LLM 大模型和角色管理区块均支持展开/折叠。
- NovelAI、画风串、LLM、任务提示词和角色配置保存在 Pinia persisted state。
- 角色配置已从全局列表改为按 `projectPath` 分组；当前选中角色跟随当前小说切换。
- LLM 支持连接配置、连接按钮、可用模型列表读取、模型选择、Temperature、Top P、Max Tokens。
- LLM 任务提示词支持三类任务的手动编辑和本地 `.txt` / `.md` 文件导入。
- 从小说导入角色时，会读取来源 Project Workspace 的 `lorebook/character` 内容节点 `index.md`，并在存在 `state.md` 时一并读取，然后调用 OpenAI-compatible `/chat/completions` 接口生成字段化 tag 草稿。
- 正文生图已有 LLM 提示词生成 `<image>` 块、提示词替换和 NovelAI 请求链路；本轮已让正文生图请求变量包含 `characterImageTags`、`characterDetectorReport` 和 `promptRules`。
- 角色 image-tag 文件从 Project Workspace 的 `lorebook/**/image-tags.md` 递归读取；同一角色的中文别名用 `|` 或 `｜` 分隔，任一别名命中都可作为保底触发。
- 新增内置 profile `body-image.character-detector` 和 runtime skill `body-image-character-detection`，用于正文生图前从候选角色中筛选相关角色。
- 新增内置 profile `character-image-tag.extractor` 和 runtime skill `character-image-tag-generation`，用于角色详情页生成 `image-tags.md` 前提取生图相关外貌事实。
- Project Workspace 的角色详情页右上角已增加生成按钮；成功后会打开生成的 `image-tags.md` 文件分页。
- 文生图面板不再展示旧角色/服装管理 UI；旧 Pinia store 和历史辅助函数暂留，避免本轮扩成大规模清理重构。

## Walkthrough

- 新增 `useTextToImageStore`，集中维护 NovelAI API、LLM 参数、任务提示词、画风串和按小说分组的角色配置。
- 重写 `NovelTextToImagePanel`，加入 LLM 参数滑条与数字输入、任务提示词选择/导入、角色手动添加和跨小说导入流程。
- 从来源小说导入角色时，前端通过 `/api/workspace-files/tree` 查找 `entryType === "character"` 的内容节点，并通过 `/api/workspace-files/read` 读取正文。
- LLM 角色设计调用目前使用浏览器直连 OpenAI-compatible API；如果目标 API 不允许 CORS，会在界面中提示失败并回退为导入原始文字设定。
- LLM 模型列表读取使用 OpenAI-compatible `/models` 接口；失败时清空旧模型列表并显示“连接失败”。
- `NovelIdeToolPanel` 的内容容器改为 flex 布局，使文生图面板内部滚动区域能获得正确高度。
- 文生图面板各区块标题栏增加折叠按钮，折叠状态为当前页面会话内状态，刷新后默认展开。
- 新增 `parseTextToImageCharacterImageTags` 解析 Markdown 分区，把 `image-tags.md` 转成正文生图可注入的结构化 tag。
- 新增 `/api/text-to-image/body-character-tags`，服务端读取当前 Project 的 `image-tags.md` 候选并调用 `body-image.character-detector` 子 agent；子 agent 失败时退回本地中文别名包含匹配。
- 正文生图构建 LLM 变量时并行收集本地 tag 词库和角色 image-tag 上下文，把命中角色渲染为 Markdown 注入 `characterImageTags`，同时保留 `characters` 兼容旧提示词变量。
- NovelAI 请求继续使用现有 `promptRules` 做提示词替换，但不再把旧 store 中的角色/服装数组传入正文生图路径。
- 任务默认 `bodyImage` 提示词已更新为读取 `currentChapter`、`characterImageTags`、`characterDetectorReport` 和 `tagData`，并要求直接展开命中角色英文 tags。
- 已编译 `body-image.character-detector` profile 到 `.compiled/artifacts`，catalog 可加载该内置 profile。
- 新增 `/api/text-to-image/character-image-tags`，接收当前角色详情页 Markdown、角色路径和文生图 LLM 配置；服务端调用 `character-image-tag.extractor` 提取外貌事实，再请求 OpenAI-compatible LLM 生成结构化角色 tag，最后渲染并写入 `image-tags.md`。
- 新增 `renderTextToImageCharacterImageTagsMarkdown`，保证生成的 `image-tags.md` 能被正文生图解析器回读。
- 角色详情页按钮会复用“角色/服装设计”的 LLM API 配置和任务提示词；如果配置缺失，会在前端提示用户先配置。
- 已编译 `character-image-tag.extractor` profile 到 `.compiled/artifacts`，catalog 可加载该内置 profile。

- 新增 `body-image.prompt-placer` profile 与 `body-image-prompt-placement` skill：正文生图 LLM 仍按现有世界书返回 `<image>...</image>`，应用把解析出的图片 prompt 和章节段落交给插图定位子 agent，子 agent 只返回 `{promptId, afterParagraphId}`，不改写正文、不生成 tag。
- 新增 `/api/text-to-image/body-prompt-placements`：服务端复用/创建 `body-image.prompt-placer` session，规范化 placement，过滤未知 prompt、未知段落和重复结果；子 agent 调用失败时只使用明确 nearbyText 命中的段落兜底，避免无锚点图片被追加或均分到正文。
- `generateBodyImagesForCurrentChapter` 已改为“LLM 产 prompt -> placer agent 定位 -> 应用按段落 id 插入 `<text-to-image-prompt>`”链路，不再调用旧的无锚点分布插入路径。
- 旧 `insertTextToImagePromptPlaceholdersIntoMarkdown` 也已改为只插入能回贴正文上下文的 `<image>`，完全无锚点的 prompt 会跳过，避免未来误用时重新出现末尾追加/均分问题。
## Decisions

- 配置仍先存到 localStorage，避免在真实生图链路确定前扩展数据库或 workspace schema。
- 画风串同一时间只允许一个 active preset；删除 active preset 时自动切换到剩余第一项。
- 角色 active selection 按当前小说独立保存，方便同一角色名在不同小说中拥有不同 tag。
- NovelAI token 与 LLM API key 使用 password 输入框展示，但仍属于浏览器本地明文持久化，不应视为生产级密钥保护。
- LLM 调用先按 OpenAI-compatible chat completions 处理；后续如果需要支持更多 provider 或规避 CORS，应加服务端代理。
- LLM 模型列表先以 OpenAI-compatible `/models` 为默认合同，允许解析 `data` 或 `models` 两种常见返回字段。
- `image-tags.md` 作为角色生图 tag 的文件真相源，优先放在角色 lorebook 目录下；服务端递归读取 `lorebook/**/image-tags.md`，避免把旧面板状态作为正文生图合同。
- 角色识别子 agent 只能从候选 `image-tags.md` 中选择，不能自造角色；无模型、调用失败或无结构化结果时使用中文别名命中作为保底。
- `promptRules` 继续按现有提示词替换规则结构传递，包含 `id/name/enabled/target/matchMode/mode/trigger/replacement`，避免正文生图链路旁路已有替换系统。
- 角色详情页生成 tag 时不移动或重命名现有角色目录；如果来源已经是 `index.md` 内容节点，就在同目录生成 `image-tags.md`。
- `character-image-tag.extractor` 只提取外貌事实，不生成 NovelAI tags；tag 生成仍交给文生图 LLM，避免子 agent 同时承担分析和 prompt 工程两种职责。
- 正文插图定位交给 `body-image.prompt-placer` 子 agent，但最终写入正文只由应用按 paragraph id 执行；无锚点结果宁可跳过，不再回退到章节末尾追加或按段落均分。

## Files Changed

- `app/stores/text-to-image.ts`
- `app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue`
- `app/components/novel-ide/NovelIdeToolPanel.vue`
- `app/components/novel-ide/workspace/WorkspaceCharacterDetailPanel.vue`
- `app/components/novel-ide/mock-data.ts`
- `app/components/novel-ide/NovelIdeSidebar.vue`
- `app/pages/index.vue`
- `app/utils/text-to-image-character-tags.ts`
- `app/utils/text-to-image-character-tags.test.ts`
- `server/text-to-image/body-image-character-tags.ts`
- `server/text-to-image/body-image-character-tags.test.ts`
- `server/text-to-image/body-image-prompt-placement.ts`
- `server/text-to-image/body-image-prompt-placement.test.ts`
- `server/text-to-image/character-image-tags.ts`
- `server/text-to-image/character-image-tags.test.ts`
- `server/api/text-to-image/body-character-tags.post.ts`
- `server/api/text-to-image/body-prompt-placements.post.ts`
- `server/api/text-to-image/character-image-tags.post.ts`
- `server/agent/profiles/builtin-contracts.ts`
- `server/agent/profiles/body-image-character-detector-profile.test.ts`
- `server/agent/profiles/body-image-prompt-placer-profile.test.ts`
- `server/agent/profiles/character-image-tag-extractor-profile.test.ts`
- `assets/workspace/.nbook/agent/profiles/builtin/body-image.character-detector.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/body-image.prompt-placer.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/character-image-tag.extractor.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/.compiled/manifest.json`
- `assets/workspace/.nbook/agent/profiles/.compiled/artifacts/*`
- `assets/workspace/.nbook/agent/skills/body-image-character-detection/SKILL.md`
- `assets/workspace/.nbook/agent/skills/body-image-prompt-placement/SKILL.md`
- `assets/workspace/.nbook/agent/skills/character-image-tag-generation/SKILL.md`
- `PROJECT-STATUS.md`

## Verification

- 已运行 `bunx vitest run app/utils/text-to-image-character-tags.test.ts server/text-to-image/body-image-character-tags.test.ts server/agent/profiles/body-image-character-detector-profile.test.ts app/utils/text-to-image-llm.test.ts app/utils/text-to-image-prompt-engine.test.ts`，结果 5 files / 16 tests passed。
- 已运行 `bunx vitest run app/utils/text-to-image-character-tags.test.ts server/text-to-image/character-image-tags.test.ts server/agent/profiles/character-image-tag-extractor-profile.test.ts server/text-to-image/body-image-character-tags.test.ts server/agent/profiles/body-image-character-detector-profile.test.ts`，结果 5 files / 12 tests passed。
- 已运行 `bun scripts/build/profile.ts compile builtin/body-image.character-detector.profile.tsx --system`，生成内置 profile compiled artifact。
- 已运行 `bun scripts/build/profile.ts compile builtin/character-image-tag.extractor.profile.tsx --system`，生成内置 profile compiled artifact。
- 已运行 `bunx vitest run app/utils/text-to-image-llm.test.ts server/text-to-image/body-image-prompt-placement.test.ts server/agent/profiles/body-image-prompt-placer-profile.test.ts`，结果 3 files / 13 tests passed。
- 已运行 `bun scripts/build/profile.ts compile builtin/body-image.prompt-placer.profile.tsx --system`，生成内置 profile compiled artifact。
- 已再次运行 `bun run typecheck`；正文生图相关类型错误已清理，当前仍失败在既有 Plot 面板 `chapterPath/chapterId` 类型不一致：
  - `app/components/novel-ide/plot/NovelPlotPanel.vue`
- 按项目规则未自动做浏览器交互验收。

## TODO / Follow-ups

- 增加文生图任务参数、队列状态、图片结果预览和保存。
- 为 LLM 角色 tag 设计增加服务端代理或 provider adapter，统一错误处理和密钥存储。
- 角色详情页已提供生成 `image-tags.md` 的轻量入口；后续仍可补手动创建模板和字段说明。
- 后续可以单独清理旧角色/服装 Pinia 状态和隐藏辅助函数；本轮只移除正文生图依赖和可见管理入口。
- 单独修复 `NovelPlotPanel.vue` 的 `chapterPath/chapterId` 类型不一致后，再把全仓 `bun run typecheck` 纳入文生图回归门禁。
