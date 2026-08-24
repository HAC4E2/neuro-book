# 文生图全链路合同修正施工计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次性修正用户反馈的 1–10 项问题及 chatu-8 审查发现的 4 项差异，使角色档案、LLM 绑定、正文提示词、NovelAI 请求、token 显示和 Markdown 图片渲染遵循同一套可验证合同。

**Architecture:** 以服务端合同为真相源：请求类型绑定决定 LLM，Project 决定唯一角色集合，当前 NovelAI 生成配方决定画风与模型参数；正文角色调用先结构化编译，再统一完成最终提示词去重、token 估算和模型专属 payload 组装。所有 NovelAI 生成动作进入同一条后端 FIFO 队列，上一动作返回成功或错误后按 API 配置冷却；前端只选择/展示当前生效配置，不再重复维护 Provider、角色分组或资产 URL 规则。

**Tech Stack:** Bun、Nuxt/Vue、Nitro API、TypeScript、Zod、Vitest、TipTap、Project 文件系统、NovelAI HTTP API、Transformers.js/T5 tokenizer。

## Global Constraints

- 默认使用简体中文用户文案，API 错误经 `resolveApiErrorMessage(error, fallback)` 展示。
- 角色原始 `.md` 档案是 Project 内容，删除视觉资料不得删除原始档案。
- 一个 Project 对用户只呈现一个角色集合；不再提供角色分组 CRUD。
- LLM Provider 只能是 `openai_compatible`；NovelAI Provider 不能进入任何 LLM 绑定。
- 点击生成图片后不再调用第二次 LLM；后端只做结构化编译和机械组装。
- NovelAI API 配置必须提供“生图间隔”，持久化字段为 `requestIntervalMs`，默认值和最小值均为 `15_000ms`。
- 所有 NovelAI 生成动作共用一条进程级 FIFO 队列；上一动作成功、HTTP 错误（包括 429）或网络异常结束后才开始计算间隔，冷却结束后才能发送下一项。
- HTTP 429 不自动重试；当前任务失败并恢复对应生图按钮，再次点击会创建新的队列项并遵守剩余冷却时间。
- 最终发送给 NovelAI 的正面、负面提示词与保存到资产元数据的提示词必须完全一致。
- 生产代码修改遵循 TDD：先添加失败测试，再实现，再跑聚焦回归。
- 当前工作区存在大量未提交的 Task 142 改动；实施前先形成一个可追溯基线，不得 reset、clean 或覆盖用户改动。

## 问题覆盖矩阵

| 原编号 | 用户可见问题 | 施工任务 |
| --- | --- | --- |
| 1 | 角色调用代码不是合法 JSON | Task 3 |
| 2 | 角色管理重复选择角色设计 LLM | Task 1 |
| 3 | LLM 管理能选择 NovelAI Provider | Task 1 |
| 4 | 画风串与模型参数不能组成多套当前配方 | Task 4 |
| 5 | 删除视觉资料会删除 Project 角色 | Task 2 |
| 6 | 一个 Project 仍有多分组入口；照片链路不明确 | Task 1、Task 2 |
| 7 | NovelAI 请求未清洗重复 tag | Task 5 |
| 8 | 未命中角色的正文段处理不明确 | Task 3 |
| 9 | 示例章节图片未在前端渲染 | Task 7 |
| 10 | 触发名与中文名未形成统一命中合同 | Task 2、Task 3 |
| 差异 A | 最终提示词没有统一去重 | Task 5（与第 7 条合并） |
| 差异 B | token 实际显示字符数 | Task 5 |
| 差异 C | Vibe/角色参考 payload 未按模型适配 | Task 6 |
| 差异 D | 当前源码没有可配置的 NovelAI 全局串行队列；429 行为与最新合同不一致 | Task 6 |

---

### Task 0: 固化可执行基线与回归清单

**Files:**
- Read: `PROJECT-STATUS.md`
- Read: `.agents/tasks/142-text-to-image-chatu8-port/README.md`
- Read: `.agents/tasks/142-text-to-image-chatu8-port/BROWSER-WALKTHROUGH.md`
- Modify: `.agents/tasks/142-text-to-image-chatu8-port/README.md`

**Produces:** 一份与当前源码一致的 Task 142 基线说明，明确历史 429 人工循环记录已被“失败退出并重新点击入队”的最新合同替代。

- [x] 运行 `git status --short --branch`，保存当前 dirty worktree 文件清单，不执行清理。
- [x] 运行当前聚焦基线：

```powershell
bunx vitest run server/api/text-to-image server/text-to-image shared/text-to-image-markdown.test.ts app/components/novel-ide/text-to-image app/components/markdown-studio/markdown-studio-tool-availability.test.ts app/components/markdown-studio/load-monaco-editor.test.ts
bun run typecheck
```

  预期：记录实际通过数量和失败项；不得沿用旧文档中的 `159/159` 作为新结果。
- [x] 在 Task 142 walkthrough 增加本计划链接，并把“429 循环已进入产品代码”改成“历史人工循环证据，已被最新的失败退出合同替代”；Task 6 完成后补记全局串行队列与可配置间隔的真实验证证据。
- [ ] 将当前 Task 142 代码收口为可追溯基线后，从 `origin/master` 创建 `.worktree/text-to-image-contract-hardening`，分支名使用 `fix/t142-text-to-image-contract-hardening`；若基线尚未进入 `origin/master`，先停下并完成基线集成，不复制未提交文件绕过 Git 历史。

### Task 1: 让请求类型绑定成为 LLM 的唯一选择入口

**Files:**
- Create: `server/text-to-image/llm-runtime.ts`
- Create: `server/text-to-image/llm-runtime.test.ts`
- Modify: `server/text-to-image/provider.service.ts`
- Modify: `server/api/text-to-image/character-visual.generate.post.ts`
- Modify: `server/api/text-to-image/character-photo.generate-prompt.post.ts`
- Modify: `server/api/text-to-image/character-photo.generate.post.ts`
- Modify: `server/api/text-to-image/body-prompts.post.ts`
- Modify: `server/api/text-to-image/body-prompts.post.test.ts`
- Modify: `server/text-to-image/character-photo.service.ts`
- Modify: `app/components/novel-ide/text-to-image/TextToImageCharacterSection.vue`
- Modify: `app/components/novel-ide/text-to-image/TextToImageLlmSettingsSection.vue`
- Modify: `app/components/novel-ide/text-to-image/provider-resolution.ts`
- Modify: `app/pages/index.vue`
- Test: `app/components/novel-ide/text-to-image/provider-resolution.test.ts`

**Interfaces:**
- Produces: `resolveBoundTextToImageLlmRuntime(userId, requestType)`，返回经过 kind 校验的 Provider runtime 与对应 context entries。
- Consumes: `TextToImageGlobalConfig.requestTypeBindings` 和 `TextToImageProviderService.resolveRuntimeProvider()`。

- [ ] 先写失败测试：`char_design`、`char_display` 分别命中已绑定的 `openai_compatible` Provider；未绑定时返回明确错误；绑定到 `novelai` 时拒绝执行。
- [ ] 在 `TextToImageProviderService` 增加带期望 kind 的解析入口，错误文案包含请求类型和实际 Provider kind。
- [x] 实现 `resolveBoundTextToImageLlmRuntime()`，同时解析 Provider 和 context profile，禁止 API 路由自行接收任意 LLM Provider ID。
- [x] 从正文生成、角色视觉生成、照片 prompt、照片生成请求体中移除运行时 `providerId` / `llmProviderId`；分别固定使用 `image_gen`、`char_design` 与 `char_display` 绑定。
- [x] 删除角色管理页面的 LLM Provider 下拉框及其本地状态；按钮可用性改为依据工作台绑定状态，并显示“请先在 LLM 管理绑定角色设计/角色展示模型”。
- [x] 把请求绑定下拉框的数据源改为 `llmProviders`，导入配置若引用 NovelAI Provider，界面显示为未绑定，保存时清除非法 ID。
- [ ] 增加 API 测试，证明点击“生成角色照片”先走 `char_display` LLM，再进入 NovelAI 队列；照片页的自由文本 prompt 只作为用户要求，不绕过展示链路。
- [ ] 运行：

```powershell
bunx vitest run server/text-to-image/llm-runtime.test.ts app/components/novel-ide/text-to-image/provider-resolution.test.ts server/text-to-image/character-photo-llm.test.ts
```

  预期：全部通过，且测试中不存在 NovelAI Provider 被当成 LLM 的路径。

### Task 2: 收口 Project 角色集合并隔离视觉资料删除

**Files:**
- Modify: `server/text-to-image/character-visual.service.ts`
- Modify: `server/text-to-image/character-visual.service.test.ts`
- Modify: `server/text-to-image/character-visual.codec.ts`
- Modify: `server/api/text-to-image/character-visual.delete.ts`
- Modify: `server/api/text-to-image/character-visual.list.get.ts`
- Modify: `app/components/novel-ide/text-to-image/TextToImageCharacterSection.vue`
- Modify: `app/components/novel-ide/text-to-image/character-list.ts`
- Delete after callers are removed: `server/api/text-to-image/character-groups.get.ts`
- Delete after callers are removed: `server/api/text-to-image/character-groups.post.ts`
- Delete after callers are removed: `server/api/text-to-image/character-groups.put.ts`
- Delete after callers are removed: `server/api/text-to-image/character-groups.delete.ts`
- Delete after callers are removed: `server/api/text-to-image/character-groups.put.test.ts`

**Interfaces:**
- Produces: 用户可见的 Project 唯一角色集合；内部可暂时复用固定 `default` 存储路径，但不再暴露 groupId 或分组 CRUD。
- Produces: `deleteCharacterVisualAssets(projectRoot, characterId)`，只删除 `visual.json` 与由该视觉档案登记的照片资产。

- [ ] 写失败测试：角色目录同时含 `index.md`、`visual.json` 和照片时，删除视觉资料后 `index.md` 仍存在且内容不变。
- [x] 把当前递归删除角色目录改为精确删除 `visual.json`；照片文件只按 `visual.json.photos[]` 中的受控相对路径删除，不递归删除角色目录。
- [x] 删除角色管理中的新建、重命名、删除分组入口和分组筛选；标题直接显示当前 Project 名，角色列表只显示该 Project 的角色。
- [ ] 服务端 API 不再接受来自浏览器的可变 `groupId`；内部固定映射到 Project 角色集合。已有非 `default` 数据不自动删除，首次读取发现多组数据时返回可诊断冲突，不静默覆盖同名角色。
- [x] 统一角色别名函数：有效名称集合为 `triggerWords`、`cnName`、`enName` 的去空、去重并集；保存 LLM 回填结果时保证中文名进入有效别名集合。
- [x] 增加角色列表与删除 API 回归，确认原始 `.md` 档案始终可见，删除视觉资料后角色仍留在 Project 中，只回到“未生成视觉资料”状态。
- [ ] 运行：

```powershell
bunx vitest run server/text-to-image/character-visual.service.test.ts server/api/text-to-image/character-visual.list.get.test.ts app/components/novel-ide/text-to-image/character-workbench.test.ts
```

### Task 3: 修正角色调用合同与无角色段落语义

**Files:**
- Modify: `server/text-to-image/body-prompt-compiler.ts`
- Modify: `server/text-to-image/body-prompt-compiler.test.ts`
- Modify: `server/text-to-image/body-character-scanner.ts`
- Modify: `server/text-to-image/body-character-scanner.test.ts`
- Modify: `server/text-to-image/body-image-prompt.ts`
- Modify: `server/text-to-image/character-visual-llm.ts`
- Modify: `server/text-to-image/character-visual-llm.test.ts`

**Interfaces:**
- Produces: `parseBodyPromptCode(raw)` 支持严格 JSON 对象，以及 LLM 常见的“缺外层大括号但内部键值完整”形式。
- Consumes: Task 2 的统一角色别名集合。

- [ ] 写失败测试覆盖以下输入：完整 JSON；缺少外层 `{}` 的键值片段；`angle: "front"`；`angle: "from front"`；中文名；触发名；损坏或截断 JSON。
- [x] 解析器仅对“缺外层大括号”执行一次受控包裹修复；字符串截断、缺引号、缺值继续失败，错误中给出合法示例，不做任意 JSON 猜测修复。
- [x] 将 `front` / `from front` 规范化为 `front`，`back` / `from back` 规范化为 `back`；字段缺失使用合同默认值，字段存在但非法时明确报错，不再静默变成 `front/sfw`。
- [x] `findCharacterIdByName()` 改为复用统一别名集合，使 `${...}$` 中填写中文名、英文名或任一触发名都命中同一角色。
- [x] 正文扫描未命中角色时，LLM 输入明确写入“本段没有可调用角色；只生成场景、镜头、环境 tag，不输出角色调用代码”；命中角色时才允许 `${...}$`。
- [x] 编译器对不含角色调用代码的 prompt 原样通过；对显式调用不存在角色的 prompt 保持失败，防止悄悄生成错误人物。
- [x] 更新角色设计 LLM 输出说明，要求 `triggerWords` 与 `cnName` 同属有效触发名，并提供完整 JSON 调用示例。
- [ ] 运行：

```powershell
bunx vitest run server/text-to-image/body-prompt-compiler.test.ts server/text-to-image/body-character-scanner.test.ts server/text-to-image/character-visual-llm.test.ts server/text-to-image/body-image-llm.test.ts
```

### Task 4: 将画风串与模型参数合并为当前生成配方

**Files:**
- Modify: `shared/dto/text-to-image.dto.ts`
- Modify: `shared/dto/text-to-image.dto.test.ts`
- Create: `server/text-to-image/novelai-settings-normalizer.ts`
- Create: `server/text-to-image/novelai-settings-normalizer.test.ts`
- Modify: `server/text-to-image/provider.service.ts`
- Modify: `server/text-to-image/provider.service.test.ts`
- Modify: `app/components/novel-ide/text-to-image/TextToImageNovelAiSettingsSection.vue`
- Modify: `server/text-to-image/queue.processor.ts`
- Modify: `server/text-to-image/queue.processor.test.ts`

**Interfaces:**
- Produces: `TextToImageNovelAiGenerationRecipeSchema` 与 `activeGenerationRecipeId`。
- Recipe 包含：前置/后置/负面画风串、模型、采样器、噪点表、尺寸、steps、seed、Guidance、Rescale、SMEA、SMEA DYN、Variety、Decrisp、AQT/UCP、福瑞数据集、prompt 替换规则，以及当前 Vibe/角色参考选择。
- Recipe 不包含：Provider 凭据、Base URL、参考图库文件和共享 Vibe/角色组定义。

- [ ] 写 schema 失败测试：至少存在一个 recipe；`activeGenerationRecipeId` 必须引用现有 recipe；删除当前 recipe 后必须选择确定的新当前项。
- [x] 编写旧配置归一化：以现有实时字段生成 `default` 配方；同名 `profiles[name]` 与 `fixedPromptPresets[name]` 合并；只有一侧存在时使用当前另一侧字段补齐；保存后只写新结构。
- [x] NovelAI 页面改为“配方列表 + 当前生效徽标 + 新建/另存为/重命名/删除”；切换配方立即加载整套画风和模型参数，保存后该配方成为当前项。
- [x] 移除原来相互独立的“模型参数档案”和“固定提示词预设”操作，避免用户组合出未保存的隐式状态。
- [x] 队列只读取 `activeGenerationRecipeId` 对应配方；Job 入队时保存配方快照，防止排队期间切换配方改变已经提交的请求。
- [x] 增加迁移、配方切换、删除当前配方和 Job 快照测试。
- [ ] 运行：

```powershell
bunx vitest run shared/dto/text-to-image.dto.test.ts server/text-to-image/novelai-settings-normalizer.test.ts server/text-to-image/provider.service.test.ts server/text-to-image/queue.processor.test.ts
```

### Task 5: 统一最终提示词去重与 chatu-8 口径 token 估算

**Files:**
- Create: `shared/text-to-image-novelai-prompt.ts`
- Create: `shared/text-to-image-novelai-prompt.test.ts`
- Create: `app/utils/novelai-token-counter.ts`
- Create: `app/utils/novelai-token-counter.test.ts`
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `server/text-to-image/queue.processor.ts`
- Modify: `server/text-to-image/queue.processor.test.ts`
- Modify: `app/components/novel-ide/text-to-image/TextToImageNovelAiSettingsSection.vue`

**Interfaces:**
- Produces: `deduplicateNovelAiTags(text): string`。
- Produces: `buildFinalNovelAiPrompts(input): {positive: string; negative: string}`。
- Produces: `estimateNovelAiTokens(text): Promise<number>`，使用 `Xenova/t5-small` tokenizer 并明确标注“估算”。

- [ ] 写去重失败测试：大小写重复、`{tag}`/`[tag]`/`1.2::tag::`/`tag:1.2`、空 tag、正负面分别去重、加权项替换无权重项、角色调用占位符不被逗号拆坏。
- [x] 实现权重感知去重：按规范化 base tag 建 Map；首个加权项优先于无权重项；保持首次出现顺序；正面和负面绝不跨集合去重。
- [x] 将 prompt replacement、角色展开、固定前置、正文、固定后置、AQT/UCP 全部完成后，再调用 `buildFinalNovelAiPrompts()`；`useFinalPrompt` 的重绘/编辑 tag 路径同样经过最终去重。
- [x] 资产元数据保存去重后的最终 positive/negative，保证历史重绘复用的就是实际发送值。
- [x] 增加 `@huggingface/transformers` 并使用动态导入；tokenizer 首次加载显示“加载分词器”，失败显示“token 估算不可用”，不得把失败伪装成 `0 token`。
- [x] 对齐 chatu-8 预处理：移除数字 `::` 权重前缀与剩余 `::`，换行变空格，移除 `{}`/`[]`，统计 `input_ids.data.length`。
- [ ] 设置页面分别显示：当前输入估算、合并当前配方 AQT/UCP 并去重后的总估算、`/512` 参考线；文案不使用“真实 token”。
- [ ] 运行：

```powershell
bunx vitest run shared/text-to-image-novelai-prompt.test.ts app/utils/novelai-token-counter.test.ts server/text-to-image/queue.processor.test.ts
```

### Task 6: 按模型适配 NovelAI payload，并建立全局串行队列与生图间隔

**Files:**
- Create: `server/text-to-image/novelai-payload.ts`
- Create: `server/text-to-image/novelai-payload.test.ts`
- Create: `server/text-to-image/novelai-request-scheduler.ts`
- Create: `server/text-to-image/novelai-request-scheduler.test.ts`
- Modify: `server/text-to-image/novelai-image-generation.ts`
- Modify: `server/text-to-image/novelai-image-generation.test.ts`
- Modify: `server/text-to-image/queue.processor.ts`
- Modify: `server/text-to-image/queue.processor.test.ts`
- Modify: `server/text-to-image/provider.service.test.ts`
- Modify: `shared/dto/text-to-image.dto.ts`
- Modify: `shared/dto/text-to-image.dto.test.ts`
- Modify: `app/components/novel-ide/text-to-image/TextToImageNovelAiSettingsSection.vue`
- Create: `app/components/novel-ide/text-to-image/TextToImageNovelAiSettingsSection.test.ts`
- Modify: `app/components/markdown-studio/tiptap/TextToImagePrompt.ts`
- Modify: `app/components/markdown-studio/tiptap/TextToImagePrompt.test.ts`
- Modify: `app/pages/index.vue`

**Interfaces:**
- Produces: `resolveNovelAiModelFamily(model): "nai3" | "nai4" | "nai45"`。
- Produces: `buildNovelAiPayload(input, references)` 和 `validateNovelAiPayload(payload, family)`。
- Produces: `TextToImageNovelAiSettings.requestIntervalMs: number`，默认和最小值都是 `15_000`。
- Produces: `NovelAiRequestScheduler.schedule<T>({requestIntervalMs, signal, run}): Promise<T>`；应用内所有 Project、Provider 和生图入口共享同一个实例。
- Produces: `requestNovelAiImages()` 只执行一次完整 NovelAI 生成动作；Vibe 编码、角色参考解析和 `/ai/generate-image` 属于同一个不可交错的队列项。

- [ ] 写模型矩阵失败测试：NAI3 只发送 direct Vibe 数组；NAI4/4.5 发送 `reference_image_multiple_cached`；NAI4.5 角色参考发送完整 `director_reference_*` 五组数组；不支持的模型启用角色参考时明确失败。
- [ ] 将当前统一的 `reference_image_multiple` / `character_reference_*` 组装移入模型适配器，删除与模型不兼容字段。
- [ ] 校验 width、height、scale、sampler、steps、seed，以及所有参考图并行数组长度；在发 HTTP 请求前失败，错误中报告字段名和实际长度，不包含图片 Base64。
- [ ] 在 `TextToImageNovelAiSettingsSchema` 增加 `requestIntervalMs: z.number().int().min(15_000).default(15_000)`；测试空配置迁移为 `15_000`，`14_999` 被拒绝，原有合法值往返不丢失。
- [ ] 在 NovelAI API 配置的连接区域增加“生图间隔（秒）”数字输入框，UI 最小值为 `15`、步长为 `1`，保存时换算成 `requestIntervalMs`；小于 15 秒时阻止保存并显示“生图间隔不能低于 15 秒”。
- [x] 写全局 FIFO 失败测试：A、B、C 依次调用 `schedule()` 后只有 A 立即执行；A 完成后等待 A 入队时快照的间隔才执行 B，B 完成后同理执行 C；不同 Project、不同入口仍使用同一顺序。
- [x] 写错误冷却测试：A 分别以 `200`、`429`、`401`、`500` 和网络异常结束时，B 都只能在 A 结束后的 `requestIntervalMs` 到期后执行；每个队列项的 `run` 只调用一次，429 绝不自动重新入队或重试。
- [x] 写取消测试：尚未开始的队列项被 AbortSignal 取消后直接移出且不产生冷却；已经向 NovelAI 发出的队列项被取消或异常结束后仍从结束时刻开始冷却，避免下一项立即撞限流。
- [x] 将计时器与时钟作为测试依赖注入，生产实现使用单例调度器；`requestIntervalMs` 在任务入队时形成快照，配置在排队期间变化不改写已有任务。
- [x] 把 `requestNovelAiImages()` 的完整动作包进全局调度器，所有正文生图、角色照片、重绘、局部重绘和历史图片操作继续只通过该入口请求 NovelAI；不得在 API route 或 service 中绕过调度器直接发请求。
- [x] 修正队列消费竞争：只有 `markRunning()` 成功的 Job 才能调用 NovelAI，防止多个 HTTP handler 重复消费同一 Job；单个 Job 失败后继续释放全局队列给下一项。
- [x] 为 NovelAI HTTP 错误保留真实状态码；429 将当前 Job 标记为 `failed`，API 返回 429，不创建重试 Job，也不把它重新改回 `queued`。
- [x] 将 `TextToImagePromptOptions.onGenerate` 改为可返回 Promise；点击后当前卡片立即禁用并显示“排队或生成中”，无论 429 或其他错误都在 Promise settle 后恢复“待生成／生成图片”，成功时仍由正文图片替换该节点。
- [ ] 日志只记录队列序号、Job ID、入队/开始/结束时间、结果状态和间隔毫秒数，不记录凭据、完整 prompt 或参考图数据。
- [ ] 运行：

```powershell
bunx vitest run shared/dto/text-to-image.dto.test.ts server/text-to-image/novelai-payload.test.ts server/text-to-image/novelai-request-scheduler.test.ts server/text-to-image/novelai-image-generation.test.ts server/text-to-image/queue.processor.test.ts server/text-to-image/provider.service.test.ts app/components/novel-ide/text-to-image/TextToImageNovelAiSettingsSection.test.ts app/components/markdown-studio/tiptap/TextToImagePrompt.test.ts
```

### Task 7: 让 Project 相对图片在 TipTap 中可见且往返不改 Markdown

**Files:**
- Create: `app/components/markdown-studio/tiptap/WorkspaceMarkdownImage.ts`
- Create: `app/components/markdown-studio/tiptap/WorkspaceMarkdownImage.test.ts`
- Modify: `app/components/markdown-studio/tiptap/markdown-editor-extensions.ts`
- Modify: `app/components/markdown-studio/tiptap/markdown-editor-extensions.test.ts`
- Modify: `app/components/markdown-studio/TipTapMarkdownEditor.vue`
- Modify: `server/api/text-to-image/assets/by-path/content.get.ts`
- Create: `server/api/text-to-image/assets/by-path/content.get.test.ts`

**Interfaces:**
- Produces: 自定义 Image 扩展在文档模型中保留 `assets/tti/...`，渲染 DOM 时把 `src` 转成 `/api/text-to-image/assets/by-path/content?projectRoot=...&relativePath=...`。
- Produces: DOM 的 `data-workspace-src` 始终保存原始相对路径，长按图片操作继续使用该值。

- [ ] 写失败测试：加载 `![NovelAI 生成图片](assets/tti/example.png)` 时 DOM 使用 API URL；序列化回 Markdown 后仍是原始相对路径。
- [x] 用自定义 `WorkspaceMarkdownImage` 替换通用 `Image.configure()`；只解析受支持的 Project 相对路径，普通 HTTPS 图片保持原 URL。
- [x] `TipTapMarkdownEditor` 长按逻辑从 `data-workspace-src` 读取资产路径，禁止把 API URL提交给重绘接口。
- [ ] 为 by-path API 增加鉴权、Project 根约束、资产记录存在性和 MIME 响应测试；路径穿越必须失败。
- [ ] 用示例章节回归图片首次加载、刷新后加载、编辑保存后仍可加载。
- [ ] 运行：

```powershell
bunx vitest run app/components/markdown-studio/tiptap/WorkspaceMarkdownImage.test.ts app/components/markdown-studio/tiptap/markdown-editor-extensions.test.ts server/api/text-to-image/assets/by-path/content.get.test.ts shared/text-to-image-markdown.test.ts
```

### Task 8: 全链路回归、浏览器验收与文档收口

**Files:**
- Modify: `.agents/tasks/142-text-to-image-chatu8-port/BROWSER-WALKTHROUGH.md`
- Modify: `.agents/tasks/142-text-to-image-chatu8-port/README.md`
- Modify: `PROJECT-STATUS.md`

**Produces:** 从原始角色 `.md` 开始，到角色视觉生成、正文角色命中、占位符、NovelAI 图片、资产保存和 Markdown 渲染的完整验收证据。

- [ ] 建立两个带详细外貌和服装的原始 `.md` 角色档案及一章约 2000 字正文；测试数据只放用户指定测试 Project，不进入模板或仓库提交。
- [ ] 从角色管理读取原始 `.md`，分别生成视觉字段；确认角色设计和照片展示自动使用 LLM 管理中的 `char_design` / `char_display` 绑定。
- [ ] 验证中文名、英文名、触发名各自命中同一角色；另设一个无角色段落，确认只生成场景 tag。
- [ ] 验证缺外层大括号的可修复角色调用能成功，截断 JSON 显示明确错误且不入 NovelAI 队列。
- [ ] 选择两套生成配方来回切换，确认当前徽标、参数、画风串、token 估算和实际 Job 快照一致。
- [ ] 人工构造重复 tag，确认队列保存的最终 prompt 和 NovelAI 请求均已去重；保留加权版本。
- [ ] 在 NovelAI API 配置中把生图间隔设为 `15s`，连续点击至少三个正文“生成图片”，确认按点击顺序串行发送；每次 NovelAI 动作结束后至少等待 15 秒才开始下一项，生成耗时本身不抵扣间隔。
- [ ] 用 NAI4.5 分别验证正文、角色照片、重绘、局部重绘、Vibe 和角色参考入口，确认它们共用同一条队列且不会并发请求 NovelAI。
- [ ] 人工触发一次 429，确认该请求只发送一次、当前 Job 进入 `failed`、按钮恢复“生成图片”；立即再次点击后产生新的队列项，并在 429 返回时刻起满 15 秒后才发送。
- [ ] 确认生成资产写入 Project、占位符替换成标准 Markdown、图片立即在 TipTap 渲染，刷新和重新打开章节后仍显示。
- [ ] 删除一个角色的视觉资料，确认原始 `.md` 角色档案仍在且可重新生成视觉资料。
- [x] 运行最终自动化验证：

```powershell
bunx vitest run server/api/text-to-image server/text-to-image shared/text-to-image-markdown.test.ts shared/text-to-image-novelai-prompt.test.ts app/components/novel-ide/text-to-image app/components/markdown-studio/tiptap app/components/markdown-studio/markdown-studio-tool-availability.test.ts
bun run typecheck
bun run generate
git diff --check
```

- [ ] 只勾选实际在浏览器完成的 walkthrough 项；记录真实模型、HTTP 状态、Job 状态、资产相对路径、尺寸和字节数，不记录凭据或完整私人正文。
- [x] 更新 Task 142 与 `PROJECT-STATUS.md`，明确自动化、真实 Provider、浏览器验收三个边界。

## 提交与评审边界

建议按 Task 1–7 各形成一个独立提交，Task 8 单独形成验证/文档提交；每个提交都能由对应聚焦测试独立接受或拒绝。完成后 push `fix/t142-text-to-image-contract-hardening` 并创建 PR，正文使用 `Refs Task 142`；不自行合并、关闭任务或发布。

## 计划自检

- 1–10 与四项新增差异全部映射到具体任务，其中重复 tag 明确合并为一个共享合同。
- 数据删除、Provider kind、最终 prompt、payload 和资产 URL 均由服务端或共享纯函数统一，不依赖前端约定。
- 配置迁移有确定规则，不丢弃当前实时参数；角色历史分组不静默删除或覆盖。
- NovelAI 生图间隔位于 API 配置、最小值为 15 秒；全局队列在成功和错误后都冷却，429 不自动重试。
- token 明确标注估算；chatu-8 的不足没有被复制为“最终真实值”。
- 每个工作包都包含失败测试、聚焦命令和用户可感知验收结果。
