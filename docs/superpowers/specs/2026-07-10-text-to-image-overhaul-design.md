# NeuroBook 文生图系统完善设计

日期：2026-07-10  
状态：书面规格已获用户确认，进入实施计划

## 1. 背景

当前文生图已经具备 NovelAI 请求、正文 `<image>` 解析、角色 `image-tags.md`、角色识别子 Agent、插图定位子 Agent、浏览器队列和正文结果节点，但多个阶段仍由前端临时状态、绝对路径和 LLM 自由输出连接。功能能够演示，尚不具备稳定批量使用所需的数据安全、可移植性和确定性。

本设计统一修复上一轮审阅的 1-9 项问题，并把生成图片历史从文生图配置面板迁移到当前 Project 的独立中间工作区分页。

## 2. 目标

1. 所有正文异步操作绑定明确的 Project、章节路径和内容版本，不覆盖其他章节或更新后的正文。
2. 外部 Provider、凭据、图片读取和图片写入由服务端受控，不再接受任意绝对路径或每次请求携带明文密钥。
3. `image-tags.md` 中命中角色的正面/背面、SFW/NSFW、身体范围和负面词通过确定性编译进入 NovelAI 请求。
4. 角色 tag 生成保留用户已有内容，使用固定输出合同并接入 ProjectSession 与 Workspace History。
5. 生图队列由服务端持有，支持持久状态、超时、取消、有限重试和进程重启恢复语义。
6. 正文最终只保存标准 Markdown 图片和 Project-relative 路径，不保存绝对路径或整段重绘历史 JSON。
7. 清理旧角色/服装管理代码和持久化状态，收缩大型组件职责。
8. 文生图配置面板只负责配置、发起任务和展示队列摘要；历史图片在独立分页管理。
9. 建立覆盖核心合同的测试与类型检查门禁。

## 3. 非目标

- 不修改正文生图世界书的 `<image>...</image>` 输出合同。
- 不建立独立服装 tag 管理系统；`image-tags.md` 服装列表仍只保存中英文名称。
- 不建立跨 Project 的全局图片图库。
- 不自动进行浏览器验收；实现完成后由用户决定是否授权浏览器验证。
- 不兼容旧的角色/服装 Pinia 数据结构，旧状态直接移除。

## 4. 总体架构

采用“Project SQLite 元数据索引 + Project-relative 图片文件”作为唯一真相源。

```text
正文保存快照
  -> 章节角色初筛
  -> 正文 LLM 继续返回 <image>
  -> Prompt Resolver 逐图解析位置和角色/镜头属性
  -> Prompt Compiler 确定性展开 image-tags.md 与负面词
  -> 原子写入正文 prompt 占位符
  -> 服务端队列调用 NovelAI
  -> Project-relative 图片资产 + Project SQLite 元数据
  -> 原子替换正文占位符为标准 Markdown 图片
  -> 历史图片分页读取 Project 资产索引
```

### 4.1 领域组件

- `TextToImageProviderService`：管理服务端 Provider 配置、凭据和 URL 策略。
- `TextToImageAssetService`：保存、读取、查询和删除 Project 图片资产。
- `TextToImageQueueService`：管理服务端任务状态和单 Provider 调度。
- `TextToImagePromptResolver`：返回逐图片语义解析结果。
- `TextToImagePromptCompiler`：唯一负责角色正负 tag 和替换规则的确定性组合。
- `TextToImageChapterService`：负责带内容版本校验的正文占位符插入与结果替换。
- `TextToImageHistoryWorkspace.vue`：当前 Project 的历史图片工作区分页。

## 5. 数据模型

### 5.1 App SQLite：Provider 配置

新增 `TextToImageProvider`：

- `id`
- `ownerUserId`
- `kind`: `novelai | openai_compatible`
- `name`
- `baseUrl`
- `model`
- `encryptedCredential`
- `credentialIv`
- `credentialTag`
- `settingsJson`
- `createdAt`
- `updatedAt`

前端只获得 Provider ID、名称、模型、非敏感参数和 `hasCredential`。任何读取接口都不得返回密钥或密文。

服务端首次需要保存凭据时，在 Workspace Root `.nbook/secrets/` 下创建应用主密钥，使用 Node `crypto` AES-256-GCM 加密 Provider 凭据。文件权限在支持的平台上设为仅当前用户可读写；该目录不得进入日志包、Project 导出、Workspace History 或前端文件树。

### 5.2 Project SQLite：生成任务

新增 `TextToImageJob`：

- `id`
- `providerId`
- `kind`: `manual | body | character | reroll`
- `status`: `queued | running | succeeded | failed | canceled | interrupted`
- `sourcePath`：来源章节或角色路径，可空
- `sourceAnchorId`：正文 prompt 占位符或来源记录 ID，可空
- `sourceInsertStatus`: `not_applicable | pending | inserted | missing`
- `requestJson`：已经清理密钥和 data URL 的任务参数
- `resultAssetIdsJson`
- `errorMessage`
- `attemptCount`
- `createdAt`
- `startedAt`
- `finishedAt`

队列启动时：

- `queued` 任务可继续执行，因为凭据通过 Provider ID 在服务端解析。
- 上次进程中的 `running` 任务改为 `interrupted`，避免不确定是否已经计费时自动重复请求。

### 5.3 Project SQLite：图片资产

新增 `TextToImageAsset`：

- `id`
- `jobId`
- `relativePath`
- `fileName`
- `mimeType`
- `byteLength`
- `width`
- `height`
- `model`
- `seed`
- `prompt`
- `negativePrompt`
- `sourceKind`
- `sourcePath`，可空
- `sourceAnchorId`，可空
- `createdAt`

图片固定保存到：

```text
assets/text-to-image/YYYY/MM/<asset-id>.<ext>
```

数据库不保存图片 base64 或服务器绝对路径。

## 6. Provider 与安全边界

### 6.1 NovelAI

- 前端不再发送 token 或 `imageBaseUrl`。
- NovelAI 图片 API 使用内置官方地址；开发环境覆盖只能来自服务端配置，不来自普通请求体。
- 生成请求只携带 `providerId`。

### 6.2 OpenAI-compatible LLM

- LLM Provider 先通过设置接口保存到服务端，再由任务引用 `providerId`。
- URL 只允许 `http:` 与 `https:`，禁止 URL 用户名/密码、fragment 和非标准协议。
- URL 校验集中在一个策略模块；私有网络地址只允许管理员显式配置的 Provider。
- completion 和 models 路由不再接受任意 `apiBaseUrl/apiKey`。

### 6.3 图片文件

- 删除接受任意绝对路径的图片读取接口和输出目录选择接口。
- 图片读取通过 `projectPath + assetId` 查询 Project SQLite，再验证解析后的绝对路径仍位于当前 Project Workspace 的 `assets/text-to-image/` 内。
- 所有 Project 数据面路由使用 `withProjectNotOpenHttpError` 或等价 ProjectSession 守卫。

## 7. 正文 Prompt 链路

### 7.1 章节快照

用户发起正文生图时：

1. 先保存当前章节。
2. 记录 `projectPath`、`chapterPath` 和 UTF-8 内容哈希。
3. 后续所有响应都使用这三个值，不读取“当前选中章节”作为写回目标。

插入 prompt 占位符前，服务端重新读取章节并比较哈希。内容变化时返回 HTTP 409 和稳定错误码 `TEXT_TO_IMAGE_CHAPTER_CONFLICT`，不写文件。

### 7.2 角色初筛

- 从 `lorebook/**/image-tags.md` 读取候选角色。
- 角色识别 Agent 只返回候选 ID，不得创造角色。
- Agent 每次使用独立一次性 session；调用完成后归档，不复用跨章节对话历史。
- 本地别名保底忽略过短别名，使用边界匹配，减少单字误命中。

### 7.3 正文 LLM

- 世界书继续返回 `<image>...</image>`。
- 修正模板变量识别：`currentChapter` 视为正文 request 槽位，避免章节重复发送。
- `promptRules` 只由确定性 compiler 应用一次，不要求正文 LLM 模拟替换。
- 固定系统合同与用户可编辑任务要求分离；用户提示词不能移除输出合同。

### 7.4 Prompt Resolver

原 `body-image.prompt-placer` 升级并重命名为 `body-image.prompt-resolver`。一次调用返回：

```json
{
  "resolutions": [
    {
      "promptId": "prompt-1",
      "afterParagraphId": "p-3",
      "characterIds": ["character-a"],
      "view": "front",
      "framing": "upper",
      "rating": "sfw",
      "outfitName": "dark navy sailor uniform",
      "reason": "该段为角色在窗边回头的画面",
      "confidence": 0.92
    }
  ]
}
```

枚举：

- `view`: `front | back`
- `framing`: `face | upper | lower | full`
- `rating`: `sfw | nsfw`

只接受本次请求中的 prompt、paragraph 和 character ID。`confidence < 0.65` 的 resolution 不自动插入。

Resolver 输入只保留段落数组、图片 prompt 和候选角色紧凑信息，不再同时重复发送完整章节和完整 LLM 回复。

### 7.5 Prompt Compiler

Compiler 是纯函数，并按 resolution 确定性选择：

- 所有命中角色：英文名、角色特征。
- `front`：五官外貌；`back`：五官外貌背面。
- `face`：不追加身体分区。
- `upper`：追加对应 SFW/NSFW 上半身分区。
- `lower`：追加对应 SFW/NSFW 下半身分区。
- `full`：追加对应上下半身分区。
- 角色负面提示词合并到图片 negative prompt。
- 服装只使用 `image-tags.md` 中声明的中英文名称，不虚构详细服装 tag。
- 最后统一应用启用的 prompt replacement rules，并去重。

NovelAI 请求必须接收 compiler 结果，不再传 `characters: []` 后完全依赖 LLM 展开。

### 7.6 Prompt 占位符

正文生成按钮仍使用 NeuroBook 内部 Markdown 节点，但内容改为结构化 payload，至少包含：

- `id`
- `prompt`
- `negativePrompt`
- `characterIds`
- `sourceChapterHash`

占位符是待生成状态，不是最终图片格式。

## 8. 服务端队列

### 8.1 调度

- 同一 Provider 默认串行执行。
- Provider 请求间隔由服务端配置，默认 15 秒。
- 多浏览器标签页和多个前端入口共享同一队列。
- 创建任务立即返回 job ID；前端通过任务列表查询或事件流更新状态。

### 8.2 超时与重试

- LLM 请求默认超时 120 秒。
- NovelAI 图片生成默认超时 300 秒。
- 只对网络错误、HTTP 429 和 HTTP 5xx 重试，最多 2 次，指数退避。
- 4xx 参数错误不重试。
- 用户可以取消 `queued`；`running` 使用 AbortController 尝试终止并标记 canceled。

### 8.3 成功写入

1. NovelAI 返回图片。
2. 写入 Project 临时文件。
3. 原子 rename 到最终 Project-relative 路径。
4. 创建 `TextToImageAsset`。
5. 更新 job 为 succeeded。
6. 如果任务来自正文，占位符仍存在时在文件锁内替换为标准 Markdown 图片。

任一步失败都执行补偿清理，不能留下指向不存在文件的资产记录。

如果正文占位符已经被删除或文件发生冲突，图片仍作为成功资产进入历史页，job 标记“已生成但未插入正文”，不覆盖正文。

## 9. 标准 Markdown 图片

最终正文格式：

```markdown
![NovelAI 生成图片](assets/text-to-image/2026/07/<asset-id>.png "seed 123456 | 832x1216")
```

- 不再写 `<text-to-image-result>`。
- 不在正文中保存 prompt、负面词、base64、绝对路径或重绘版本数组。
- Markdown Studio 在渲染时把 Project-relative 图片 URL 映射到受控 asset content API，但序列化仍保留原始相对路径。
- 重绘操作从历史图片页发起；新结果是新的 asset，不修改旧资产文件。

## 10. 角色 `image-tags.md` 生成

### 10.1 固定合同

- 子 Agent 只提取视觉事实。
- LLM 固定 system message 始终包含 JSON schema；用户可编辑提示词作为附加 system/user message，不能替换固定合同。
- LLM 返回通过 Zod schema 校验；不再只依赖宽松字段文本解析。

### 10.2 写入策略

- 文件不存在：创建完整模板。
- 文件存在：默认只填充空字段，并始终保留用户负面词和服装列表。
- UI 提供明确的“重新生成全部视觉字段”二次确认；即使覆盖视觉字段，也保留负面词和服装列表。
- 所有写入通过 `writeWorkspaceTextFileTracked`，并使用 ProjectSession 守卫。
- 平铺角色文件转换为角色目录时，创建/复制动作也进入 Workspace History。

## 11. 历史图片分页

### 11.1 导航

- Novel IDE 新增 tab kind：`text-to-image-history`。
- 文生图面板标题区新增带图库图标的“历史图片”按钮。
- 点击后打开当前 Project 的单例历史 tab。
- 文生图配置面板删除内嵌图片列表，只保留队列摘要和入口。

### 11.2 页面布局

- 顶部工具条：来源筛选、状态筛选、时间排序、刷新。
- 主区：响应式图片网格，每个 asset 是独立卡片。
- 详情视图：大图、正负 prompt、模型、seed、尺寸、来源和生成时间。
- 操作：复制 prompt、套用到手动生成、重绘、打开来源章节、删除。

页面是工作型图库，不使用营销式 hero，不把页面区块包装成嵌套卡片。

### 11.3 删除

- 删除前扫描当前 Project 中除 `.nbook/` 外的 authored Markdown，确认是否仍引用该 `relativePath`。
- 被正文引用时拒绝删除文件，并提示先从正文移除图片。
- 未引用时二次确认，删除文件和数据库记录。
- 删除失败保留数据库记录并显示可恢复错误，不产生静默孤儿。

## 12. 旧代码清理

- 删除 `characterGroups`、`outfitGroups`、旧角色/服装 CRUD 和对应 persisted state。
- 删除 `NovelTextToImagePanel.vue` 中 `v-if="false"` 的旧模板。
- 删除不再可达的旧角色生图工作区和 tab kind。
- 保留 LLM 设置工作区、tag 词库、画风、prompt replacement rules 和手动生成能力。
- 把文生图大组件按 Provider、生成参数、画风、替换规则、队列摘要拆分为职责单一组件。
- 删除已经没有消费者的旧 helper 和相应测试；仍有新链路消费者的纯函数测试迁移到新模块。

## 13. API 设计

主要接口：

- `GET/POST/PATCH/DELETE /api/text-to-image/providers`
- `POST /api/text-to-image/body-prompts`
- `POST /api/text-to-image/jobs`
- `GET /api/text-to-image/jobs`
- `POST /api/text-to-image/jobs/:id/cancel`
- `GET /api/text-to-image/assets`
- `GET /api/text-to-image/assets/:id/content`
- `DELETE /api/text-to-image/assets/:id`
- `POST /api/text-to-image/character-image-tags`

所有 Project API 都要求 `projectPath`，未 open 时返回 HTTP 409 与 `PROJECT_NOT_OPEN`。错误通过现有 `resolveApiErrorMessage` 在前端解析。

## 14. 错误处理

- Provider 配置错误：保存时校验，任务创建前再次校验。
- Agent/LLM 输出不合法：不写正文，保留诊断，不把无锚点图片追加末尾。
- 章节冲突：返回 409，不写文件，用户可以基于最新章节重新运行。
- 图片生成成功但正文插入失败：资产保留在历史页，状态明确可见。
- 队列请求失败：记录可读错误与 attemptCount，允许历史页或队列摘要重试。
- 文件/数据库不一致：服务启动维护任务扫描缺失文件和孤儿临时文件，记录 warning，不自动删除有效图片。

## 15. 硬切策略

项目处于快速开发阶段，不保留旧数据兼容层：

- 删除旧 Pinia 角色/服装和 generation results 持久字段。
- 旧绝对路径图片不会自动导入 Project 历史。
- 删除旧 `<text-to-image-result>` 运行时解析和写入链路；已有旧节点保留为原始 Markdown 文本，不再提供运行时兼容或自动读取绝对路径。
- 新代码不再产生旧结果节点。

## 16. 测试策略

### 16.1 单元测试

- URL policy 与 Provider 凭据加解密。
- Prompt Resolver 输出归一化。
- Prompt Compiler 的正背面、构图、SFW/NSFW、负面词和替换规则组合。
- Project-relative asset path 校验。
- 队列状态机、超时、取消、重试和重启恢复。
- `image-tags.md` 合并与 Zod 输出校验。
- 标准 Markdown 图片生成与序列化。

### 16.2 API/服务测试

- Project 未 open 时稳定返回 409。
- 任意绝对路径和未登记 asset 不能读取。
- Provider API 不返回密钥。
- 章节 hash 冲突不会写文件。
- Workspace History 能记录角色 tag 和正文图片写入。
- 图片文件与数据库补偿清理。
- 历史分页、筛选和受保护删除。

### 16.3 前端测试与检查

- 文生图面板不再渲染历史图片网格。
- 历史按钮打开当前 Project 单例 tab。
- 历史页显示加载、空、错误、任务中和成功状态。
- 修复现有文生图测试类型错误。
- 运行文生图聚焦 Vitest 与 `bun run typecheck`。
- 按项目规则不自动运行浏览器验证。

## 17. 验收矩阵

| 原问题/新增需求 | 验收证据 |
| --- | --- |
| 1. 异步错误写回 | 章节 identity + hash 冲突测试；切换 tab 不改变写回目标 |
| 2. SSRF、凭据、绝对路径 | Provider ID 请求；URL policy；asset ID 读取；前端无密钥持久化 |
| 3. 角色 tag 不确定 | Prompt Compiler 测试证明逐图精确选择和 negative 合并 |
| 4. `image-tags.md` 覆盖 | 默认补空、保留负面词/服装、tracked write 测试 |
| 5. 固定输出合同被覆盖 | 固定 schema message 与 Zod 校验测试 |
| 6. 浏览器内存队列 | 服务端 job API、跨 tab 共用、超时/取消/恢复测试 |
| 7. token 重复/session 污染 | `currentChapter` 不重复；Resolver 紧凑 payload；一次性 Agent session |
| 8. 非标准 Markdown/正文膨胀 | 最终标准 Markdown 相对路径；正文无结果 JSON |
| 9. 旧代码残留 | 旧 store 字段、隐藏模板、旧 tab/helper 搜索结果为零 |
| 历史图片子页面 | 配置页仅有入口；当前 Project 历史 tab 展示服务端资产 |

## 18. 实施分片

1. Provider、安全边界、Project schema 与资产服务。
2. 服务端队列和任务 API。
3. Resolver 与 Prompt Compiler。
4. 正文版本写回和标准 Markdown 图片。
5. 角色 tag 安全生成与 History 接入。
6. 历史图片 workspace tab 和配置面板迁移。
7. 删除旧角色/服装链路并拆分组件。
8. 验证、任务 walkthrough 与 PROJECT-STATUS 同步。
