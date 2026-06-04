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

## Goal

- 先完成文生图工作台的配置层、本地持久化状态、角色复用入口和 LLM 辅助生成人设 tag 的前端链路，为后续真实 NovelAI 生图请求、任务队列、结果保存留出结构。

## Current State

- IDE 左侧栏已有“文生图”入口。
- 文生图面板已挂入工具面板区域，并拥有独立滚动容器。
- NovelAI API、画风串、LLM 大模型和角色管理区块均支持展开/折叠。
- NovelAI、画风串、LLM、任务提示词和角色配置保存在 Pinia persisted state。
- 角色配置已从全局列表改为按 `projectPath` 分组；当前选中角色跟随当前小说切换。
- LLM 支持连接配置、连接按钮、可用模型列表读取、模型选择、Temperature、Top P、Max Tokens。
- LLM 任务提示词支持三类任务的手动编辑和本地 `.txt` / `.md` 文件导入。
- 从小说导入角色时，会读取来源 Project Workspace 的 `lorebook/character` 内容节点 `index.md`，并在存在 `state.md` 时一并读取，然后调用 OpenAI-compatible `/chat/completions` 接口生成字段化 tag 草稿。
- 当前仍未接入真实 NovelAI 生图请求链路，也没有服务端代理、任务队列或图片结果保存逻辑。

## Walkthrough

- 新增 `useTextToImageStore`，集中维护 NovelAI API、LLM 参数、任务提示词、画风串和按小说分组的角色配置。
- 重写 `NovelTextToImagePanel`，加入 LLM 参数滑条与数字输入、任务提示词选择/导入、角色手动添加和跨小说导入流程。
- 从来源小说导入角色时，前端通过 `/api/workspace-files/tree` 查找 `entryType === "character"` 的内容节点，并通过 `/api/workspace-files/read` 读取正文。
- LLM 角色设计调用目前使用浏览器直连 OpenAI-compatible API；如果目标 API 不允许 CORS，会在界面中提示失败并回退为导入原始文字设定。
- LLM 模型列表读取使用 OpenAI-compatible `/models` 接口；失败时清空旧模型列表并显示“连接失败”。
- `NovelIdeToolPanel` 的内容容器改为 flex 布局，使文生图面板内部滚动区域能获得正确高度。
- 文生图面板各区块标题栏增加折叠按钮，折叠状态为当前页面会话内状态，刷新后默认展开。

## Decisions

- 配置仍先存到 localStorage，避免在真实生图链路确定前扩展数据库或 workspace schema。
- 画风串同一时间只允许一个 active preset；删除 active preset 时自动切换到剩余第一项。
- 角色 active selection 按当前小说独立保存，方便同一角色名在不同小说中拥有不同 tag。
- NovelAI token 与 LLM API key 使用 password 输入框展示，但仍属于浏览器本地明文持久化，不应视为生产级密钥保护。
- LLM 调用先按 OpenAI-compatible chat completions 处理；后续如果需要支持更多 provider 或规避 CORS，应加服务端代理。
- LLM 模型列表先以 OpenAI-compatible `/models` 为默认合同，允许解析 `data` 或 `models` 两种常见返回字段。

## Files Changed

- `app/stores/text-to-image.ts`
- `app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue`
- `app/components/novel-ide/NovelIdeToolPanel.vue`
- `app/components/novel-ide/mock-data.ts`
- `app/components/novel-ide/NovelIdeSidebar.vue`
- `PROJECT-STATUS.md`

## Verification

- 已运行 `bun run typecheck`。
- 本次新增/修改的文生图文件没有类型错误。
- 类型检查仍失败在上游已有的 SillyTavern 角色卡导入与 RP profile 测试类型问题：
  - `assets/workspace/.nbook/agent/skills/SillyTavern角色卡导入/scripts/silly-tavern-card.ts`
  - `server/agent/profiles/rp-profiles.test.ts`
  - `server/agent/skills/silly-tavern-card-cli.test.ts`
- 按项目规则未自动做浏览器交互验收。

## TODO / Follow-ups

- 接入服务端 NovelAI 请求代理，避免浏览器直连暴露 token 和受限于 CORS。
- 增加文生图任务参数、队列状态、图片结果预览和保存。
- 将画风串、角色 tag、正文片段和任务提示词接入后续 prompt 组装流程。
- 为 LLM 角色 tag 设计增加服务端代理或 provider adapter，统一错误处理和密钥存储。
