# 图片资产交互、当前画风串重 roll、NovelAI V5 与 LLM 预设导入施工合同

> 状态：施工前合同，尚未实施
> 日期：2026-08-22
> 所属任务：[`142-text-to-image-chatu8-port`](README.md)
> 适用范围：正文生成图片的后处理工作台、历史图片、大图预览、图片复制/下载、重 roll、Tag 修改后发送、NovelAI V5 请求参数、LLM 上下文预设条目名称导入与编辑
> 不适用范围：正文图片块生成队列、正文锚点插入、角色视觉 JSON、角色头像、LLM 正文生图格式、Vibe/角色参考资产管理、插件化安装包

## 1. 文档目的

这份文档是后续 Agent 的实现合同，不是建议清单。实现者必须先读完本文，再修改业务代码。

本文用以下方式减少实现偏差：

- 明确定义“当前画风串”“基础 Prompt”“历史快照”“重 roll”等术语，禁止用相近字段替代。
- 明确哪些数据允许从历史任务继承，哪些数据必须在点击时从当前工作台重新解析。
- 明确后处理工作台和历史图片详情的尺寸、布局、动作、状态和错误反馈。
- 明确图片剪贴板和下载的二进制合同，不允许复制 URL 冒充复制图片。
- 明确 chatu-8 的 SillyTavern 代理参数与 NeuroBook 直连 NovelAI 参数不是同一层合同。
- 明确 LLM 上下文预设的“预设名称”和“条目名称”是两个字段，导入后必须完整保留、显示、编辑和再次导出。
- 给出接口、服务、测试和验收矩阵；实现偏离时必须先更新本文并记录理由。

## 2. 施工前置条件

### 2.1 Git 与任务记录

当前 `D:\neuro-book-new-text-to-picture` 已验证不是 Git 仓库。正式施工前必须：

1. 找到包含 `.git` 的真实 NeuroBook 仓库。
2. 执行 `git fetch origin`。
3. 从 `origin/master` 创建符合 `AGENTS.md` 命名规则的独立 worktree 和分支。
4. 将本文和 Task README 的设计记录带入该 worktree。
5. 在对应 Task walkthrough 中持续记录计划偏差、实现结果和验证证据。

不得在无 Git 元数据的源码副本中直接完成正式施工后再声称已按仓库流程提交。

### 2.2 外部合同证据优先级

NovelAI V5 参数冲突时，证据优先级固定为：

1. NovelAI 官方 Web 客户端实际出站请求，且必须删除 Authorization、图片 Base64、账号信息和其它私人数据后才能保存为测试材料。
2. chatu-8 直连 NovelAI 的请求路径。
3. chatu-8 发往 SillyTavern `/api/novelai/generate-image` 的代理请求。
4. 注释、UI 名称或根据字段名作出的推测。

低优先级证据不得覆盖高优先级证据。找不到字段真实取值、层级或默认值时，必须保持字段未启用并报告缺口，不得猜值。

### 2.3 真实服务调用边界

- 单元测试和请求金样必须使用 mock fetch，不发送真实 NovelAI 请求。
- 真实 NovelAI 冒烟测试可能消耗 Anlas，只有用户明确授权后才能执行。
- 浏览器人工验收只有用户明确授权后才能执行。
- 任何测试材料不得包含 API Key、用户小说、角色视觉资料或生成图片 Base64。

## 3. 已确认的当前状态

以下结论来自 2026-08-22 的只读代码调查。

### 3.1 后处理工作台

- `TextToImageAssetActionDialog.vue` 使用 `Dialog size="lg"`，最大宽度约 `720px`。
- 主图区域固定 `h-[360px]`。
- 局部重绘区域固定 `h-[320px]`。
- 菜单动作覆盖在图片中央，遮挡原图。
- 弹窗可按同一正文锚点浏览历史资产。
- 关闭弹窗时，如果用户停留在其它历史资产上，当前逻辑可能把该历史资产作为成功结果发回正文替换链路。

### 3.2 图片复制和下载

- 后处理工作台没有复制和下载动作。
- 历史图片详情没有复制和下载动作。
- `OriginalImagePreviewDialog.vue` 有原图加载、失败重试和下载入口，但没有图片剪贴板能力。
- `app/utils/browser-download.ts` 已提供 Blob 下载工具，应复用。
- `/api/text-to-image/assets/[id]/content` 已提供同源、鉴权、路径校验后的图片二进制，不需要新增公开静态文件接口。

### 3.3 重 roll

- 后处理工作台菜单中的刷新图标按钮显示为“发送”，实际调用 `/assets/[id]/send`。
- 前端没有调用已有 `/assets/[id]/reroll`。
- `rerollTextToImageAsset()` 最终也转入 `sendTextToImageAsset()`。
- `sendTextToImageAsset()` 设置 `useFinalPrompt: true`，复用历史 `novelAi` 和历史 `finalPromptBundle`。
- 新 Job 使用历史 Job 的 `providerId`、`providerOwnerUserId`、`providerCredentialRevision` 和 `providerSnapshotJson`。
- 因此当前实现的真实语义是“用随机 Seed 重放历史请求”，不是“用当前工作台配方重新生成”。

### 3.4 活动画风串

- `activeGenerationRecipeId` 存在于 NovelAI Provider 设置中。
- 用户在工作台选择画风串时，前端会把配方加载进本地表单并修改本地 `activeGenerationRecipeId`。
- 只有执行保存动作后，服务端才能可靠看到新的活动画风串。
- 未保存的模型或画风串字段不能被服务端重 roll 安全读取。

### 3.5 历史图片

- 历史列表使用固定 `128px` 高缩略图。
- 点击后只打开模型、尺寸、Seed、来源、时间、正面 Prompt 和负面 Prompt 信息弹窗。
- 当前合同测试把历史图片定义为只读，并禁止 reroll、edit 和 inpaint。

### 3.6 NovelAI V5

本地已经支持：

- `nai-diffusion-5-full`
- `nai-diffusion-5-curated`
- `params_version: 4`
- V5 Full inpaint 模型
- V5 Curated inpaint 回退
- V5 UCP 文本和 `ucPreset`
- V5 首发阶段禁止 Vibe Transfer 和角色参考图

当前仍有以下差异或缺陷：

- V5 的 `noise_schedule` 被强制写成 `karras`，不能遵循当前画风串选择。
- chatu-8 已为 V5 显示 `native` 噪声表，并允许 DDIM。
- chatu-8 对 V5 继续计算 Variety 的 `skip_cfg_above_sigma`，本地当前不发送。
- chatu-8 的 SillyTavern 代理路径出现 `straight_alpha`、`tag_hint_qt`、`tag_hint_uc_preset`，但当前主干没有找到稳定赋值来源。
- 本地 `FinalNovelAiPromptBundle.modelFamily` 只能写 `"nai4"`，V5 资产也被错误标成 `nai4`。

### 3.7 LLM 上下文预设条目名称

已核对用户提供的三份真实 chatu-8 导出 JSON，且只检查 JSON 结构和字段，没有把其中 Prompt 内容当作指令：

- 一份单预设包含 `30` 个条目。
- 一份单预设包含 `185` 个条目。
- 一份批量导出包含 `14` 个预设、共 `2635` 个条目。
- 上述 `2850` 个条目全部直接使用 `name` 字段；缺失 `name` 的条目为 `0`，空白 `name` 的条目为 `0`。
- 单个预设内部未发现重复条目 ID；不同预设之间允许复用条目 ID，因为条目 ID 的唯一性边界是所属预设。

本地 `normalizeImportedContextProfiles()` 已读取 `rawEntry.name`，共享 DTO 也已经声明 `entry.name`。实际缺陷位于显示和回归保护：

- `TextToImageLlmSettingsSection.vue` 的条目标题固定显示“条目 N”，没有读取 `entry.name`。
- 条目编辑区没有“条目名称”输入框，因此用户不能确认或修改已导入名称。
- 导入单元测试虽然样例含 `name: "用户消息"`，断言却没有检查 `name`，所以名称显示缺失没有被测试捕获。

结论：这不是 chatu-8 导出字段变更，也不需要猜测 `entryName`、`title` 等别名；本轮应修复现有 `name` 字段的展示、编辑和往返测试。

## 4. 术语和真相源

### 4.1 术语

| 术语 | 唯一定义 |
| --- | --- |
| 源资产 | 用户双击正文图片或在历史列表点击的 `TextToImageAsset`。 |
| 源 Job | 创建源资产的 `TextToImageJob`。 |
| 基础 Prompt | 源 Job `requestJson.prompt` 中尚未拼入当前画风串固定正向、质量串和替换结果的场景/人物内容。不得使用资产最终 `prompt` 代替。 |
| 基础负面 Prompt | 源 Job `requestJson.negativePrompt`。没有时按现有队列合同处理空值，不得从资产最终负面串反推。 |
| 角色槽 | 源 Job `requestJson.characterPrompts`，包括角色正向、负向和坐标。 |
| 当前 NovelAI Provider | 点击动作所属已认证用户当前唯一可用的 NovelAI Provider。不得从源 Job 推断。 |
| 当前画风串 | 当前 NovelAI Provider 中 `activeGenerationRecipeId` 指向的已保存 `generationRecipes` 项。 |
| 未保存画风串草稿 | 工作台表单中尚未持久化的修改。它不是重 roll 的真相源。 |
| 历史最终 Prompt | 源资产 `prompt`、`negativePrompt` 或历史 `finalPromptBundle` 中已经完成组装的最终字符串。 |
| 重 roll | 继承源 Job 的基础内容和正文血缘，使用当前 Provider 与当前已保存画风串重新组装并发送全新 NovelAI 请求。 |
| Tag 修改后发送 | LLM 修改基础 Prompt 后，使用当前 Provider 与当前已保存画风串重新组装并发送。 |
| 局部重绘 | 使用源图和遮罩执行 inpaint。本合同不把它改为当前画风串语义。 |

### 4.2 真相源矩阵

| 数据 | 重 roll 来源 | Tag 修改后发送来源 | 局部重绘来源 |
| --- | --- | --- | --- |
| Provider ID | 当前 Provider | 当前 Provider | 历史 Provider，保持现状 |
| API Key 修订号 | 当前 Provider | 当前 Provider | 历史 Provider，保持现状 |
| Provider 快照 | 当前 Provider | 当前 Provider | 历史 Provider，保持现状 |
| 模型 | 当前已保存画风串 | 当前已保存画风串 | 历史请求 |
| 采样器/噪声表/Steps/Guidance | 当前已保存画风串 | 当前已保存画风串 | 历史请求 |
| 宽高 | 当前已保存画风串 | 当前已保存画风串 | 历史请求 |
| 固定正向/后置正向/固定负向 | 当前已保存画风串 | 当前已保存画风串 | 历史最终 Prompt |
| 替换规则/质量预设/福瑞数据集 | 当前已保存画风串 | 当前已保存画风串 | 历史最终 Prompt |
| 基础 Prompt | 源 Job | LLM 返回的基础 Prompt | 历史最终 Prompt 或用户输入，保持现状 |
| 基础负面 Prompt | 源 Job | 源 Job，除非以后单独增加负面修改合同 | 历史请求 |
| 角色槽 | 源 Job | 源 Job | 历史请求 |
| Seed | `-1`，生成器随机化 | `-1`，生成器随机化 | `-1`，保持现状 |
| sourcePath/sourceAnchorId | 源资产 | 源资产 | 源资产 |

任何实现若让重 roll 读取历史最终 Prompt、历史 Provider 快照或历史模型，即违反合同。

## 5. 后处理工作台 UI 合同

### 5.1 打开方式和资产范围

- 正文中只有已识别为文生图资产的图片才响应双击。
- 双击后仍通过相对路径解析资产，不允许前端根据文件名猜资产 ID。
- 弹窗打开后可加载同一 `sourceAnchorId` 的历史资产。
- 历史加载失败时，源资产仍可操作；错误不关闭弹窗。
- 切换历史图片只是改变弹窗内的查看/操作目标，不得自动替换正文图片。
- 只有生成成功并得到新资产时才允许向正文发出 `success`。
- 用户浏览到旧历史图后直接关闭弹窗，必须无副作用，不得把旧图写回正文。

### 5.2 尺寸

桌面端使用明确的大工作台尺寸：

- 宽度：`min(1440px, calc(100vw - 24px))`
- 高度：`min(900px, calc(100dvh - 24px))`
- 最大高度不得再受 `lg` 的自动内容高度限制。
- Dialog body 必须使用 `min-height: 0` 和受控 overflow，避免内容把整个弹窗撑出视口。

当可用宽度小于 `960px` 时改为上下布局：

- 图片区在上。
- 操作区在下。
- 弹窗内部滚动，页面主体不得跟随滚动。

不得只把 `size="lg"` 改成 `size="full"` 后保留 `h-[360px]`；这不满足本合同。

### 5.3 布局

桌面端：

- 左侧图片区占可用宽度约 `65%–72%`。
- 右侧操作区占剩余宽度，最小宽度 `320px`，最大宽度 `440px`。
- 左侧图片使用 `object-contain`，完整显示，不裁剪。
- 原图背景可使用黑色或图片预览专用背景，但不能使用新增 Tailwind 调色板状态色。
- 上一张、下一张和序号可以覆盖图片边缘，但不得遮住图片主体中央。
- 预设、Tag、重 roll、局部重绘、复制、下载放入右侧工具区或顶部工具栏，禁止用全屏半透明层覆盖原图。

### 5.4 状态

工作台至少区分：

- `loadingAsset`：加载当前资产信息。
- `loadingHistory`：加载同锚点历史。
- `copying`：读取并写入剪贴板。
- `downloading`：读取 Blob 并触发下载。
- `submitting`：重 roll、Tag 发送或 inpaint 已提交。
- `error`：当前动作可恢复错误。

要求：

- 一个动作执行时只禁用会造成重复提交或目标切换的控件。
- 复制或下载不应锁死 Tag 文本编辑。
- 重 roll/inpaint 期间禁止切换资产，避免结果归属混乱。
- 错误使用 `resolveApiErrorMessage()`；跨入口反馈使用 `useNotification()`。
- 成功通知必须写清动作，例如“图片已复制到剪贴板”“已下载原图”“已使用当前画风串重新生成”。

### 5.5 局部重绘画布

放大工作台时必须同时修正遮罩坐标合同：

- Canvas 的 CSS 尺寸必须与图片真实渲染矩形一致，而不是覆盖包含黑边的整个容器。
- 根据资产宽高比和容器 `clientWidth/clientHeight` 计算 contain 后的渲染宽高与偏移。
- Canvas 像素尺寸使用渲染尺寸乘设备像素比，设备像素比最多沿用当前上限 `2`。
- resize 后需要按比例迁移已有遮罩，或在确实无法安全迁移时提示用户并清空；不得静默错位。
- 导出的遮罩必须仍是合法 PNG，并对应源图片坐标系。

## 6. 图片复制与下载合同

### 6.1 共享实现

后处理工作台和历史详情必须调用同一套共享能力。建议职责拆分为：

- `fetchTextToImageAssetBlob(assetId, projectRoot)`：读取受鉴权二进制并检查 `response.ok`、MIME 和非空内容。
- `copyImageBlobToClipboard(blob)`：转换并写入图片剪贴板。
- `downloadTextToImageAsset(blob, filename)`：调用现有 `triggerBrowserDownload()`。
- UI composable 只管理 loading、错误和通知，不重复实现二进制处理。

不得在两个 Vue 组件中分别手写 fetch、ClipboardItem 和 Object URL 生命周期。

### 6.2 复制图片

“复制图片”必须把图片二进制写入系统剪贴板：

```text
navigator.clipboard.write([new ClipboardItem({"image/png": pngBlobOrPromise})])
```

要求：

- 不得复制图片 URL、Markdown、文件路径或 Base64 文本冒充复制图片。
- 动作必须由用户点击直接触发。
- 优先使用 `ClipboardItem` 接收 Promise 的方式保持用户激活链；不支持时再采用兼容路径。
- 如果源图片不是 `image/png`，使用 `createImageBitmap` 或 `<img> + canvas` 转为 PNG。
- 转换 Canvas 尺寸使用图片原始像素尺寸，不得使用缩略图 DOM 尺寸。
- 转换完成后释放 `ImageBitmap`、Object URL 等临时资源。
- 缺少 `navigator.clipboard`、`ClipboardItem`、安全上下文或权限时，显示可理解错误；不得自动下载替代复制，因为这会造成意外文件写入。
- 剪贴板失败不改变资产、正文或当前弹窗状态。

### 6.3 下载图片

- 通过现有资产 content API 获取 Blob，再使用 `triggerBrowserDownload()`。
- 下载名优先使用 `asset.fileName`。
- 文件名必须移除 Windows 禁止字符、控制字符和路径分隔符。
- 扩展名必须与实际 Blob MIME 一致；MIME 缺失时才使用资产文件名扩展名。
- 不允许把 `projectRoot`、绝对路径、用户 ID 或 Prompt 拼进文件名。
- 每次下载完成后必须回收 Object URL。
- HTTP 非 2xx、空 Blob 或不支持的 MIME 必须报告失败，不生成空文件。

### 6.4 可用入口

以下位置都必须提供“复制图片”和“下载原图”：

1. 正文双击打开的后处理工作台。
2. 历史图片大图详情。

本阶段不要求在正文图片 hover 层或缩略图卡片直接放按钮，避免增加编辑器误触面。

## 7. 历史图片大图合同

### 7.1 打开和关闭

- 点击历史缩略图直接打开大图详情，不先打开纯文字小弹窗。
- 关闭详情不得改变历史分页、当前 Project 或正文。
- 历史详情不得 emit 正文资产替换事件。

### 7.2 布局

桌面端采用左右结构：

- 左侧：大图，使用可用空间 `object-contain` 完整显示。
- 右侧：模型、尺寸、Seed、来源、生成时间、正面 Prompt、负面 Prompt。
- 底部或右上角：复制图片、下载原图、关闭。
- Prompt 区域只读，可滚动，不得挤压图片到缩略图尺寸。

窄屏采用图片在上、信息在下的布局。

### 7.3 只读边界

历史页继续是只读资产浏览器。不得在本阶段加入：

- 重 roll
- Tag 修改
- 局部重绘
- 设为正文当前图片
- 删除资产

如果以后要加入这些动作，必须单独设计正文血缘和删除恢复合同。

## 8. 活动画风串持久化合同

### 8.1 已保存与未保存

- 重 roll 只使用服务端已保存的当前画风串。
- 用户仅修改模型下拉框、Prompt 或参数但未保存时，这些修改不得偷偷进入重 roll。
- UI 必须把活动画风串显示为“当前已保存：<名称>”，避免把本地草稿误称为当前生效。
- 存在未保存修改时应显示现有 warning/dirty 语义；重 roll 不需要替用户自动保存整份草稿。

### 8.2 切换活动画风串

仅切换已有画风串时，应立即持久化活动 ID，但不得覆盖任何画风串内容。

推荐新增窄合同端点：

```http
PUT /api/text-to-image/providers/:id/active-generation-recipe
Content-Type: application/json

{
  "recipeId": "style-cinematic"
}
```

服务端必须：

1. 认证用户。
2. 校验 Provider 属于当前用户且 kind 为 `novelai`。
3. 校验 `recipeId` 存在于该 Provider 已保存的 `generationRecipes`。
4. 原子地只更新 `activeGenerationRecipeId`。
5. 不接收或更新模型、Prompt、Key、分组、参考图等其它字段。
6. 返回更新后的安全 Provider DTO，不返回凭据。

前端必须：

- 在选择成功保存后更新“当前已保存”标识。
- 保存期间禁用重复切换或使用最后请求获胜的明确序号合同。
- 保存失败时恢复上一个已保存选项并通知用户。
- 不得调用会把整个当前表单写回的 `saveStyle()` 来模拟活动 ID 切换，因为这可能误保存未完成草稿。

## 9. 重 roll 服务合同

### 9.1 入口语义

后处理菜单中的刷新按钮改名为“重 roll”或“重新生成”，调用：

```http
POST /api/text-to-image/assets/:id/reroll
Content-Type: application/json

{
  "projectRoot": "<当前项目根标识>"
}
```

不得继续用 `/send` + `asset.prompt` 模拟无修改重 roll。

### 9.2 身份和 Provider

- 路由必须保存 `requireTextToImageUser()` 返回的 `userId` 并传给服务层。
- 服务层使用该用户解析当前 NovelAI Provider。
- 不得使用源 Job 的 `providerOwnerUserId` 代替当前认证用户。
- 当前 Provider 缺失、未配置凭据、活动画风串缺失或活动 ID 悬空时，动作无副作用失败。
- 入队使用当前 Provider ID、当前 owner、当前凭据修订号和当前安全设置快照。

### 9.3 请求组装

服务层先读取源资产和源 Job，再构造新的基础请求：

```ts
{
    prompt: sourceRequest.prompt,
    negativePrompt: sourceRequest.negativePrompt,
    characterPrompts: sourceRequest.characterPrompts,
    novelAi: {
        seed: -1, // 仅作为队列内部的“请求随机 Seed”标记
    },
}
```

关键限制：

- `-1` 禁止直接进入 NovelAI HTTP payload；消费者必须在出站前只解析一次为合法 `uint32`，并把同一个实际 Seed 写入新资产。
- 不设置 `useFinalPrompt: true`。
- 不传历史 `finalPromptBundle`。
- 不展开复制历史 `novelAi`。
- 不把 `asset.prompt` 写入 `request.prompt`。
- 不把历史模型、宽高、采样器或固定画风串字段写入 request override。

队列处理器随后从当前 Provider 解析活动画风串，并通过唯一最终 Prompt 组装器重新执行：

```text
当前替换规则
→ 当前固定正向/后置正向
→ 当前福瑞数据集
→ 源基础 Prompt
→ 当前质量预设
→ 当前固定负向 + 源基础负向
→ 当前模型的字符槽合同
```

### 9.4 血缘和正文替换

新 Job 必须继承：

- `sourcePath`
- `sourceAnchorId`
- 合适的 `kind = "reroll"`

不得继承源资产 ID 或覆盖源文件。生成成功后创建新资产；正文替换仍由现有成功事件按新资产 `relativePath` 完成。

生成失败时：

- 源资产保留。
- 正文不变。
- pending Tag 草稿不被清除。
- 用户可以重试。

### 9.5 同步与队列

本阶段不重写 Project FIFO 队列：

- 重 roll 仍进入现有 Project 队列。
- 不绕过请求间隔。
- 不并行直调 NovelAI。
- 不为后处理创建第二套内存队列。
- 如果接口继续等待任务完成后返回资产，必须保持现有取消和终态保护。

## 10. Tag 修改后发送合同

### 10.1 LLM 输入

`edit-tag` 的 `currentTag` 应改为源 Job 基础 Prompt，而不是 `asset.prompt` 中已经拼入历史画风串的最终 Prompt。

理由：若 LLM 在历史最终 Prompt 上修改，再使用当前画风串组装，会重复固定提示词、质量串和旧画风标签。

### 10.2 pending 草稿

- LLM 返回值是新的基础 Prompt 草稿。
- 草稿继续按资产 ID/血缘隔离，不得串到其它历史图。
- LLM 修改成功不立即生图。
- 用户确认发送后调用 `/send`。
- `/send` 与 `/reroll` 必须共享“当前 Provider + 当前已保存画风串”的入队组装器。

### 10.3 `/send` 输入

```http
POST /api/text-to-image/assets/:id/send
Content-Type: application/json

{
  "projectRoot": "<当前项目根标识>",
  "prompt": "<修改后的基础 Prompt>"
}
```

服务端：

- 使用 body.prompt 替代源基础 Prompt。
- 基础负面 Prompt和角色槽仍从源 Job读取。
- 其它规则与重 roll 相同。
- 成功后才清理 pending 草稿。

### 10.4 与局部重绘的边界

局部重绘不共享上述当前画风串组装器。原因是 inpaint 需要保持源图、历史模型和遮罩语义兼容。本阶段不得顺手把 inpaint 改成当前模型。

## 11. Prompt Bundle 版本合同

### 11.1 新写入格式

`FinalNovelAiPromptBundle` 升级为版本 2：

```ts
type FinalNovelAiPromptBundleV2 = {
    version: 2;
    modelFamily: "nai45" | "nai5";
    model: TextToImageNovelAiModel;
    basePositive: string;
    baseNegative: string;
    characters: Array<...>;
    actualInput: string;
    actualNegativeInput: string;
    appliedRuleLines: number[];
};
```

要求：

- V4.5 写 `modelFamily: "nai45"`。
- V5 写 `modelFamily: "nai5"`。
- 保存实际模型 ID，不能仅靠 family 反推。
- 新资产只写 version 2。

### 11.2 历史读取

- 已有 version 1、`modelFamily: "nai4"` 继续作为历史展示和 inpaint 快照读取。
- 不批量改写用户数据库。
- 重 roll 不依赖 version 1 的最终 Prompt，因此无需用错误 family 推断当前模型。
- 解析失败只影响需要该快照的动作，不得让历史图片无法预览、复制或下载。

本变更只修改 JSON 内容合同，不需要 Prisma schema migration。

## 12. NovelAI V5 参数合同

### 12.1 能力表

实现必须建立集中式模型能力表，至少表达：

```ts
type NovelAiModelCapabilities = {
    family: "nai45" | "nai5";
    paramsVersion: 3 | 4;
    allowedSamplers: readonly string[];
    allowedNoiseSchedules: readonly string[];
    supportsVariety: boolean;
    varietySigmaFamily: "v4" | "v45" | null;
    supportsVibe: boolean;
    supportsCharacterReference: boolean;
    supportsInpaint: boolean;
    inpaintModel: string;
};
```

UI、normalizer、payload builder 和验证器必须消费同一能力定义或同一组稳定常量，不得各自维护互相漂移的模型判断。

### 12.2 已确认的 V5 字段

V5 Full/Curated 至少遵守：

- `params_version: 4`
- `use_new_shared_trial: true` 位于顶层请求体
- `v4_prompt` 和 `v4_negative_prompt` 继续发送
- `characterPrompts: []` 与当前多角色 caption 合同一致
- `native` 是允许的噪声表选项
- DDIM 是允许的采样器选项
- V5 不发送 V4.5 Vibe/角色参考字段
- Variety 开启时按 chatu-8 当前 V5 路径使用非 V4.5 sigma family；关闭时发送 `null` 或按权威请求金样省略

当前本地对 V5 强制 `noise_schedule = "karras"` 的代码必须删除。保存值不合法时才使用模型默认值。

### 12.3 UCP 与质量串

- UI 可继续显示 `Heavy`、`Light`、`Human Focus`、`Furry Focus`、`none`。
- 序列化层必须把显示值规范化为 V5 所需的 UCP 语义。
- 当前项目由本地最终 Prompt 组装器展开 UCP 时，生成请求继续关闭 NovelAI 的重复质量注入，避免同一负面串出现两次。
- V5 正面质量串不得继续无证据继承 V4.5 AQT。必须先用第 2.2 节证据优先级确认 `tag_hint_qt`、`qualityToggle` 和本地 AQT 的职责，再决定唯一所有者。
- 任一组合只能有一个质量预设所有者：本地展开或 NovelAI 参数提示，不得两者同时开启。

### 12.4 `straight_alpha` 和 Tag Hint

chatu-8 当前只在发往 SillyTavern 代理的对象中出现：

- `straight_alpha`
- `tag_hint_qt`
- `tag_hint_uc_preset`

同时存在以下证据缺口：

- 没找到 `preset_data` 中稳定的赋值来源。
- 没确认字段应该位于 NovelAI 官方请求顶层还是 `parameters`。
- 没确认字段类型和默认值。
- chatu-8 直连官方路径没有相同的显式附加逻辑。

因此本阶段的硬性规则是：

- 不得把这三个字段直接复制进当前官方 `/ai/generate-image` 请求。
- 不得发送值为 `undefined` 的键。
- 不得根据名字猜测 boolean、number 或 enum。
- 若施工期间取得权威出站请求，先新增脱敏请求金样和类型测试，再更新本文并实现。
- 如果证据仍缺，最终报告必须把它们列为“上游代理合同未闭合”，而不是宣称已经完整支持。

### 12.5 V5 请求金样

至少建立以下 mock 请求金样：

1. V5 Full：Euler Ancestral、native、Heavy、质量预设开、Variety 开、无参考图。
2. V5 Curated：DDIM、none、质量预设关、Variety 关、无参考图。
3. V5 多角色：基础 caption + 两个角色 caption 和坐标。
4. V5 Full inpaint：正确模型 ID、action、image、mask 和 strength。
5. V5 + Vibe：在任何网络调用前失败。
6. V5 + 角色参考：在任何网络调用前失败。

每份金样必须断言允许字段和值，也必须断言禁止字段不存在。

## 专题 A：LLM 上下文预设条目名称导入合同

### A.1 字段语义与唯一性边界

上下文预设必须区分以下四个概念：

| 字段 | 用途 | 唯一性/显示规则 |
| --- | --- | --- |
| `profile.id` | NeuroBook 内部预设标识和请求类型绑定目标 | 在全部上下文预设中唯一 |
| `profile.name` | 预设选择器中显示的名称 | 可以与 ID 不同 |
| `entry.id` | 单个预设内部的条目标识和 Vue key | 只要求在所属预设内唯一 |
| `entry.name` | 用户给该消息条目起的名称 | 允许重复；不参与触发和 LLM 消息组装 |

不得用预设名称覆盖条目名称，也不得用条目 ID、角色、内容首行或数组序号替换一个已经存在的非空 `entry.name`。

### A.2 受支持的导入形状

本轮必须继续支持两种现有入口：

1. chatu-8/NeuroBook 上下文预设对象：`{ "预设键": { "entries": [...] } }`。
2. 全局配置对象：顶层含 `contextProfiles`，由全局配置导入路径解析。

对于上下文预设对象：

- 顶层键在缺少显式 `profile.id`、`profile.name` 时分别作为二者的回退值。
- `entries[index].name` 是条目名称的唯一已验证来源。
- 不新增未经真实样本证明的 `entryName`、`title`、`comment` 等猜测别名。
- `andTriggerWords` 缺失时继续使用 DTO 默认空串，这与条目名称无关。
- 非对象条目、非法 role 或其它 DTO 校验错误继续让整次导入失败；不得只导入前半段再留下部分写入。

全局配置导入和上下文预设导入最终必须经过同一条 `TextToImageContextProfileSchema`/`TextToImageContextEntrySchema` 校验边界，不能让其中一个入口保留名称、另一个入口丢名称。

### A.3 名称规范化

- 字符串 `name` 按现有 DTO 规则去除首尾空白后保存，中文、英文、数字和常用标点必须保留。
- 非空名称不得在导入、选择预设、保存、刷新、导出任一步变为空串。
- 对历史数据中确实缺失或为空的名称，界面只显示回退文案“条目 N”；不得从 Prompt 内容推导名称，也不得在用户未保存时把回退文案静默写回数据。
- 用户在名称输入框中填写“条目 N”并保存时，它就是普通显式名称，后续不得再次当成临时回退值。

### A.4 前端显示与编辑

每个条目卡片必须同时做到：

- 标题显示 `entry.name.trim() || `条目 ${index + 1}``。
- 编辑区提供明确标注的“条目名称”文本输入框，使用 `v-model="entry.name"` 绑定当前草稿。
- 名称输入框不得设置为只读；用户修改后仍通过现有“保存”动作持久化，不新增第二套自动保存状态。
- 条目 role、启用状态、触发模式、触发词和 content 的现有语义保持不变。
- 删除、重排或编辑其它字段时，名称必须跟随同一个条目对象，不能按当前数组位置重新分配。

名称只是管理界面的元数据。LLM 请求消息仍只使用条目的 `role`、`content`、启用状态和触发条件；不得把名称拼进 Prompt 或发送给模型。

### A.5 保存、刷新与再次导出

必须保证以下往返成立：

```text
chatu-8 JSON 的 entries[].name
→ normalizeImportedContextProfiles
→ contextProfiles 状态
→ 当前预设草稿
→ 全局配置持久化
→ 页面重新载入
→ 导出 JSON 的 entries[].name
```

每一步都必须保留名称。导出继续使用真实 `entry.name`；界面的“条目 N”临时回退文案不能被导出成伪造名称。

本轮不改变现有导入时的预设 ID 冲突策略；若施工 Agent发现冲突会覆盖数据，应另行记录为产品决策，不得借名称修复擅自改变导入合并语义。

### A.6 大型预设

用户真实批量样本包含单预设 `505`、`506`、`507` 个条目的情况。名称修复不得：

- 为显示标题逐项深拷贝完整 Prompt 内容。
- 为每次输入重新规范化全部预设。
- 移除现有最高 `400px` 的条目滚动容器。
- 因名称为空或重复而过滤合法条目。

至少使用一个包含大量条目的程序化测试或组件夹具确认：展开、选择和保存不会丢失首条、中间条和末条的名称。测试夹具只能生成无私人内容的虚构数据，不得把用户提供的 JSON 提交到仓库。

### A.7 兼容和迁移边界

- 不需要 Prisma migration。
- 不需要新增 API。
- 不修改 LLM Provider、流式传输、请求类型绑定或运行时占位符合同。
- 不批量改写已有全局配置；历史空名称按 A.3 的显示回退处理。
- 不把用户提供的三份 JSON、预设名称、Prompt 内容或本机下载路径复制进仓库测试夹具、日志或文档。

## 13. 错误合同

| 场景 | 用户提示 | 副作用 |
| --- | --- | --- |
| 图片二进制 404/403 | 无法读取原图，请刷新资产后重试 | 无 |
| Clipboard API 不支持 | 当前环境不支持复制图片，请使用下载 | 无 |
| 剪贴板权限拒绝 | 图片复制被系统拒绝，请检查剪贴板权限 | 无 |
| 下载 Blob 为空 | 下载失败：图片文件为空 | 不创建空文件 |
| 当前 NovelAI Provider 不存在 | 请先在文生图工作台配置 NovelAI | 不入队 |
| Provider 无 Key | 请先保存 NovelAI API Key | 不入队 |
| 活动画风串为空或悬空 | 请先选择并保存一个画风串 | 不入队 |
| 活动画风串切换保存失败 | 当前画风串切换失败，仍使用上一个已保存画风串 | 回滚前端选择 |
| 源 Job requestJson 非法 | 无法读取该图片的原始生成请求 | 不入队，不改正文 |
| 源 Job 缺基础 Prompt | 该历史图片缺少可重 roll 的基础 Prompt | 不回退最终 Prompt |
| 重 roll 生成失败 | 使用当前画风串重新生成失败：<安全错误> | 源图和正文保留 |
| Tag 修改发送失败 | 图片发送失败：<安全错误> | pending 草稿保留 |
| V5 参数组合不支持 | 当前 V5 模型不支持所选参数：<字段> | 网络前失败 |
| 上下文预设 JSON 非法 | 导入失败：<安全校验错误> | 不写入任何预设 |
| 条目名称缺失或为空 | 界面显示“条目 N” | 不伪造或覆盖持久化名称 |

错误信息不得包含 API Key、完整 Provider 快照、图片 Base64、绝对磁盘路径或完整小说正文。

## 14. 并发和竞态合同

- 活动画风串切换必须有请求序号、AbortController 或禁用交互，确保迟到响应不能覆盖最后一次选择。
- 后处理弹窗打开期间 Project 切换时必须关闭弹窗或重新绑定资产；不得把旧 Project 的 assetId 与新 `projectRoot` 组合请求。
- 复制和下载捕获点击时的 assetId，不得在异步返回时改用已经切换后的 `activeAsset`。
- 重 roll/发送点击后捕获源 assetId；执行期间禁止切换历史图。
- 生成成功事件只接纳本次返回的 jobId/asset，不接纳同锚点其它并发任务的“最新资产”。
- 若现有 `findLatestTextToImageAssetBySourceAnchorId` 可能拿到另一任务结果，必须优先按本次 `jobId` 查找，再校验 anchor；不得只依赖“最新”。
- 多次快速点击重 roll只能产生一次 Job；按钮 busy 与服务端幂等策略至少要有一层可靠保护。

## 15. 安全与隐私合同

- 图片读取继续经过现有 content API 的认证和路径安全检查。
- 不新增未经认证的静态图片目录。
- 前端不得获得 Provider 密文或解密后的 API Key。
- 重 roll 服务必须按认证用户解析当前 Provider，不能信任请求体传入 ownerUserId/providerId。
- 请求体不接受绝对 `projectPath`，只接受现有 `projectRoot` 标识并沿用安全拼接规则。
- 文件名只用于下载显示，不参与服务端路径解析。
- 日志只记录 assetId、jobId、model、recipeId 等结构化标识；不记录完整 Prompt、Key 或图片数据。

## 16. 预计修改面

以下是预计修改范围，不代表允许机械全改；施工前仍需重新检查实际代码。

### 16.1 前端

- `app/components/novel-ide/text-to-image/TextToImageAssetActionDialog.vue`
- `app/components/novel-ide/text-to-image/TextToImageHistorySection.vue`
- `app/components/novel-ide/text-to-image/TextToImageNovelAiSettingsSection.vue`
- `app/components/novel-ide/text-to-image/TextToImageLlmSettingsSection.vue`
- `app/components/common/OriginalImagePreviewDialog.vue`，仅在通用能力适合时扩展；不得为文生图强塞业务字段
- `app/utils/browser-download.ts`
- `app/utils/text-to-image-context-import.test.ts`
- 新增文生图图片 Blob/剪贴板共享工具或 composable
- `app/components/novel-ide/text-to-image/image-interaction.contract.test.ts`
- 现有或新增的 LLM 设置组件合同测试，用于覆盖条目名称显示、编辑、保存和重载

### 16.2 API 和服务

- `server/api/text-to-image/assets/[id]/reroll.post.ts`
- `server/api/text-to-image/assets/[id]/send.post.ts`
- `server/api/text-to-image/assets/[id]/edit-tag.post.ts`，如需调整基础 Prompt 来源
- 新增窄作用域活动画风串切换端点
- `server/text-to-image/asset-postprocess.service.ts`
- `server/text-to-image/provider.service.ts`
- `server/text-to-image/queue.processor.ts`
- `server/text-to-image/final-novelai-prompt.ts`
- `server/text-to-image/novelai-image-generation.ts`
- `server/text-to-image/novelai-payload.ts`
- `server/text-to-image/novelai-settings-normalizer.ts`
- `server/text-to-image/novelai-quality.ts`

### 16.3 共享合同

- `shared/dto/text-to-image.dto.ts`
- `shared/text-to-image-novelai-prompt.ts`

### 16.4 不应修改

除非施工发现直接合同缺口并先更新本文，否则不应修改：

- Prisma schema 和 migration
- 正文 `<image>` 解析器
- 正文锚点插入服务
- 角色视觉 JSON schema
- LLM Provider 通用聊天流式合同
- LLM 运行时消息组装合同；条目名称只属于管理界面元数据
- Project 队列 FIFO 设计
- 插件化安装包内容

## 17. 测试合同

### 17.1 图片操作单元测试

- PNG Blob 直接写剪贴板。
- JPEG/WebP 转 PNG 后写剪贴板。
- Clipboard API 缺失。
- ClipboardItem 缺失。
- 权限拒绝。
- HTTP 非 2xx。
- 空 Blob。
- 下载名清理和 MIME 扩展名。
- Object URL 在成功和异常路径都被释放。

### 17.2 组件测试

- 后处理弹窗使用大尺寸且图片动作不覆盖中央原图。
- 关闭浏览中的旧历史图不 emit success。
- 重 roll 菜单调用 `/reroll`，不调用 `/send`。
- Tag 确认发送调用 `/send`。
- 复制/下载使用点击时资产 ID。
- 历史缩略图点击显示大图。
- 历史详情有复制和下载，没有 reroll/edit/inpaint。
- 窄屏布局 class/状态合同存在。
- busy 时不会重复创建 Job。

### 17.3 服务测试

- 重 roll 从源 requestJson 读取基础 Prompt、负面 Prompt和角色槽。
- 重 roll 不读取 asset.prompt 作为基础 Prompt。
- 重 roll request 不含 `useFinalPrompt` 和 `finalPromptBundle`。
- 重 roll request.novelAi 不含历史模型/尺寸/采样参数，仅允许明确的 seed override。
- 入队使用当前 Provider 与凭据修订号。
- 活动画风串缺失时不入队。
- 当前画风串从 V4.5 切到 V5 后，重 roll 使用 V5。
- 当前画风串固定 Prompt 与替换规则只应用一次。
- Tag 修改输入使用基础 Prompt。
- Tag 发送失败保留 pending 草稿。
- 并发同锚点任务按 jobId 找到本次资产。
- inpaint 仍使用历史快照，不受重 roll 改造影响。

### 17.4 V5 测试

- DTO/normalizer 保存和读取 V5 新能力。
- V5 尊重合法 `native`，不强制 karras。
- DDIM 组合按冻结金样发送。
- Variety 开关控制 sigma 字段。
- UCP/质量串只有一个所有者。
- V5 Prompt Bundle 写 version 2、family nai5、实际 model。
- Version 1 历史 bundle 仍可读取。
- V5 不发送 V4.5 参考图字段。
- 未确认的代理字段不存在于官方直连 payload。

### 17.5 聚焦验证命令

施工 Agent 应根据仓库当时脚本重新确认命令，最低验证面为：

1. 上述相关 Vitest 文件全部通过。
2. 文生图相关全范围测试通过。
3. `bun run typecheck` 或仓库当时规定的等价 typecheck 通过。
4. 若 Node/Bun shim 损坏，必须记录替代运行器、版本和完整通过数量，不能只写“测试通过”。

### 17.6 LLM 预设导入测试

- 真实格式等价的虚构 chatu-8 单预设导入后，逐条断言 `entries[].name` 保留。
- 全局配置导入路径保留相同名称。
- 导入 → 保存 → 重新加载 → 导出的往返结果保留名称。
- 条目卡标题显示显式名称；空名称只显示“条目 N”回退。
- 编辑名称并保存后，切换预设再切回仍显示新名称。
- 名称重复不会导致条目丢失或合并。
- 生成 `507` 个无私人内容的虚构条目，断言首条、第 `254` 条和第 `507` 条名称在导入与保存往返后不变。
- 测试必须明确断言 `name`；不得只断言 id、content 或 `andTriggerWords`。

### 17.7 人工验收

获得浏览器验收授权后，至少验证：

1. 横图、竖图、方图在后处理工作台都能明显大于旧版查看，且不裁剪。
2. 操作按钮不遮挡原图中央。
3. 复制后能粘贴到支持位图的应用，内容是图片而不是 URL。
4. 下载文件可打开，尺寸和 MIME 正确。
5. 历史图点击后显示大图，复制和下载都针对所点资产。
6. 从画风串 A 切到已保存画风串 B 后，重 roll 的模型和最终画风来自 B。
7. 画风串 B 有未保存修改时，重 roll仍使用 B 的已保存版本，并有清晰 dirty 提示。
8. 重 roll失败后正文和源图不变。
9. Tag 修改后发送只应用当前画风串一次。
10. V5 Full/Curated 设置切换时，非法参考图组合在请求前被阻止。
11. 导入单预设后，条目卡标题显示 JSON 中的真实名称，而不是统一显示“条目 N”。
12. 导入包含大量条目的批量预设后，切换预设、编辑名称、保存和刷新均不丢名称。
13. 再次导出后抽查首条、中间条和末条的 `name` 与导入前一致。

## 18. 分阶段施工顺序

必须按依赖顺序施工，不要先改 UI 再临时拼服务端语义。

### 阶段 A：冻结合同测试

- 为历史快照重放行为添加当前失败测试。
- 为历史详情只读但允许复制/下载更新合同测试。
- 为 V5 当前差异建立请求金样。
- 补上上下文导入对 `entries[].name` 的直接断言，并添加条目标题/编辑框组件失败测试。

完成条件：新测试能准确暴露旧行为，且没有改业务实现。

### 阶段 B：LLM 预设条目名称

- 在条目卡标题显示真实名称并提供名称输入框。
- 保持现有导入 schema、保存按钮和运行时消息合同不变。
- 完成单预设、全局配置、保存重载、再次导出和 `507` 条大型夹具测试。

完成条件：测试证明 `name` 从导入到再次导出完整往返，空名称只触发显示回退，名称不进入 LLM Prompt。

### 阶段 C：活动画风串真相源

- 实现窄作用域活动 ID 持久化。
- 处理切换竞态和失败回滚。
- 明确已保存/未保存文案。

完成条件：刷新页面后服务端和前端仍指向同一个活动画风串，未保存内容没有被误写。

### 阶段 D：重 roll 和 Tag 发送服务

- 抽取共享的“当前 Provider + 当前配方”入队器。
- 重写 `/reroll`。
- 调整 `/send`。
- 调整 Tag 修改基础 Prompt 来源。
- 修正按 jobId 查结果。

完成条件：测试证明历史 Provider、历史 final bundle 和历史 novelAi 不再进入重 roll。

### 阶段 E：Prompt Bundle 和 V5

- 实现 Bundle version 2。
- 建立模型能力表。
- 对齐已确认的 V5 sampler/schedule/variety/UCP 合同。
- 保持未确认代理字段隔离。

完成条件：V4.5 和 V5 金样均通过，历史 version 1 可读。

### 阶段 F：共享图片动作

- 实现 Blob 获取、复制、转换、下载和错误处理。
- 完成单元测试。

完成条件：共享工具测试覆盖成功、权限和格式转换路径。

### 阶段 G：两个大图界面

- 放大后处理工作台并移出覆盖菜单。
- 修正 inpaint canvas 渲染矩形。
- 重做历史大图详情。
- 接入共享复制/下载。

完成条件：组件测试和 typecheck 通过。

### 阶段 H：总验证与 walkthrough

- 跑聚焦测试、文生图测试和 typecheck。
- 经授权后跑人工验收。
- 更新本 Task walkthrough，记录实际修改文件、测试数量、未验证项和所有计划偏差。

## 19. 完成定义

只有同时满足以下条件才能报告完成：

- 正文双击后的工作台明显放大，原图不再被动作层遮挡。
- 后处理和历史详情都能复制实际图片并下载原图。
- 历史详情显示大图且仍保持只读。
- 无修改重 roll 调用 `/reroll`。
- 重 roll 和 Tag 发送使用当前用户、当前 Provider、当前已保存画风串。
- 历史模型、历史 Provider 快照和历史最终 Prompt 不进入重 roll。
- 当前画风串切换只更新活动 ID，不误保存其它草稿。
- V5 请求遵守已冻结金样，不强制 karras，不误发 V4.5 参考字段。
- V5 Bundle 不再标成 nai4。
- 未确认的 chatu-8 代理字段没有被冒充为官方直连参数。
- chatu-8 的 `entries[].name` 在导入、显示、编辑、保存、刷新和再次导出后仍保持一致。
- 空名称只显示“条目 N”回退，回退文案不被静默写入配置，条目名称不进入 LLM 请求。
- 聚焦测试、文生图测试和 typecheck 有可核验通过记录。
- 未经授权的浏览器或真实 NovelAI 验收被明确标为“未执行”，不能写成“已验证”。

## 20. 禁止的捷径

后续 Agent 不得采用以下做法：

- 只把 Dialog 从 `lg` 改成 `full`，保留固定高度图片区。
- 在两个组件中复制粘贴 Clipboard/下载实现。
- 复制图片 URL并提示“图片已复制”。
- 用 `<a href>` 绕过鉴权失败和 Blob/MIME 校验。
- 继续让无修改“发送”调用 `/send`。
- 为了“兼容历史”继续展开复制历史 `novelAi`。
- 从 `asset.prompt` 中尝试删除旧画风标签来反推基础 Prompt。
- 活动画风串缺失时静默回退历史参数。
- 切换画风串时调用全量保存，误写未完成草稿。
- 把重 roll 改造顺手扩展到 inpaint。
- 把 `straight_alpha`、`tag_hint_qt`、`tag_hint_uc_preset` 以猜测值加入官方请求。
- 删除或批量重写用户已有历史资产来修正 Bundle family。
- 为此改动新增 Prisma 列。
- 用 `any` 绕过 V5 模型能力和 Bundle 版本类型。
- 只把固定标题“条目 N”改成文本，却不提供名称编辑和保存往返测试。
- 从条目 content 第一行生成名称，或把显示回退“条目 N”写回导入数据。
- 为修复当前已验证的 `name` 字段而擅自增加未经样本证明的字段别名。
- 把用户提供的真实预设 JSON 或 Prompt 内容提交为测试夹具。
- 只跑一个组件测试就宣布整条链路完成。

## 21. 调查与验证边界

本合同形成时：

- 已读取本地相关 Vue、API、服务、DTO、NovelAI 请求和测试合同。
- 已读取 chatu-8 `main` 的 V5 UCP、请求组装、sampler/schedule 显示和参考图限制代码。
- 已读取 chatu-8 `main` 的上下文预设默认结构、导入、导出和条目编辑代码，确认条目名称字段为 `entries[].name`。
- 已只读检查用户提供的三份真实导出：`30` 条、`185` 条以及 `14` 个预设/`2635` 条；全部条目具有非空 `name`。私人 Prompt 内容和本机路径未写入本文。
- 已确认 chatu-8 最新主干中的三个代理字段缺少稳定赋值证据。
- 未修改业务代码、数据库、用户 Project、小说正文、API Key 或图片。
- 未运行测试和 typecheck，因为本轮只写施工合同。
- 未执行浏览器验收和真实 NovelAI 请求。
