# Tag 修改两阶段工作流设计

## 状态

已确认设计。

## 目标

把正文图片的 Tag 修改拆成两个明确阶段：

1. 用户输入自然语言修改要求，使用文生图 LLM 设置中的 `tag_modify` 任务生成新的正向 Tag。
2. 用户确认 Tag 后点击“发送”，才把当前图片槽位的 Tag 交给 NovelAI 生图。

LLM 修改阶段不能创建 NovelAI Job，也不能替换正文图片。用户可以不做任何 Tag 修改，直接用当前 Tag 点击“发送”完成单图重 roll。

## 当前实现约束

正文 LLM 的原始 `<image>` 块会先转换为 `text-to-image-prompt` 结构化占位符；首次生图成功后，占位符再替换为正文图片引用。因此后处理界面读取的是该图片槽位的 prompt 语义，而不是重新从历史图片文件推断 Tag。

历史资产的 `prompt` 是已生成图片的不可变快照，不能因为用户尚未点击“发送”就被改写。待发送 Tag 需要独立保存，避免污染历史预览和模型参数。

## 用户流程

1. 用户双击正文中的 NovelAI 图片，打开后处理对话框。
2. 对话框按图片槽位加载历史图片；切换历史图片只切换当前预览，不自动发送请求。
3. 用户点击“Tag 修改”，输入自然语言修改要求。
4. 点击“请求 LLM”后，服务端读取当前图片正向 Tag，将它与修改要求、`tag_modify` 任务绑定的上下文预设组合，调用绑定的 LLM。
5. LLM 成功后，只更新当前图片槽位的“待发送 Tag”状态；预览图片、历史资产、负面 Tag、NovelAI 模型参数均不变。
6. 用户点击“发送”后，服务端读取该待发送 Tag，沿用当前图片的负面 Tag、NovelAI 请求快照和图片槽位锚点，创建现有 NovelAI 串行队列任务。
7. NovelAI 成功后，正文当前位置替换为新图片；旧图片继续保留在历史列表。发送失败时保留待发送 Tag，用户可以修正或再次发送。
8. 用户关闭并重新打开后处理对话框时，当前页面内同一图片槽位的待发送 Tag 仍然存在；成功发送后清除该槽位的临时状态并以新资产 Tag 作为初始值。

## 状态模型

在页面级维护按图片槽位锚点索引的待发送状态：

```ts
type PendingTextToImagePrompt = {
    sourceAnchorId: string;
    prompt: string;
};
```

索引优先使用资产的 `sourceAnchorId`，没有锚点时回退到资产 ID。状态由后处理入口持有，关闭对话框不清空，切换项目时清空。它不修改 `TextToImageAssetDto.prompt`，也不修改历史 Job/Asset 数据。

## 服务端合同

### Tag 修改预览

保留 `/api/text-to-image/assets/:id/edit-tag` 路由，但将请求体改为：

```ts
{
    projectRoot: string;
    modificationRequest: string;
}
```

服务端流程：

1. 鉴权并读取当前资产及其 Job 快照。
2. 使用 `resolveBoundTextToImageLlmRuntime(user.id, "tag_modify")`，严格读取 `tag_modify` 绑定的 OpenAI-compatible Provider 与上下文预设。
3. 发送当前正向 Tag、用户修改要求和任务系统提示给 LLM。
4. 解析纯 Tag、`image###...###` 或 `<image>...</image>` 包装；结果为空时拒绝。
5. 只返回 `{prompt}`，不创建或消费 NovelAI Job。

### 发送当前 Tag

新增 `/api/text-to-image/assets/:id/send` 路由，请求体为：

```ts
{
    projectRoot: string;
    prompt: string;
}
```

服务端从资产快照读取 Provider、负面 Tag、NovelAI 参数和图片槽位锚点，只把请求体中的正向 Tag 替换进现有后处理请求，使用 `seed: -1` 创建 `reroll` Job，并复用全局 NovelAI 串行队列、代理和间隔规则。

原有“重 roll”快捷操作可以复用该发送服务，使用资产原始 prompt；Tag 修改流程本身不再隐式触发生图。

## LLM 提示词合同

系统提示要求：

- 根据当前 Tag 和修改要求生成可直接发送给 NovelAI 的英文 Danbooru/Stable Diffusion Tag 串。
- 保留未被用户要求修改的场景、构图和角色信息。
- 只输出 Tag，不输出解释、Markdown、JSON 或自然语言段落。
- 允许兼容既有预设输出的 `image###...###` 和 `<image>...</image>` 包装。

用户消息包含明确分隔的当前正向 Tag与修改要求。负面 Tag不发送给 LLM 修改，始终沿用当前资产快照。

## 错误与并发

- 未绑定 `tag_modify` Provider、Provider 类型不支持、LLM 超时或输出为空：不进入 NovelAI 队列，对话框保留原待发送 Tag并显示错误。
- NovelAI 失败（包括 429）：保留待发送 Tag；不自动重试，用户再次点击“发送”才创建新的 Job。
- LLM 请求期间禁止重复提交；发送期间禁止切换当前发送资产。
- 预览状态与历史图片解耦，任何 LLM 回复都不能改变正文图片，只有发送成功后的资产替换动作能改变正文图片引用。

## 验证范围

- Tag LLM：验证 `tag_modify` Provider、上下文条目、当前 Tag、用户修改要求和固定 `maxTokens/stream` 参数。
- Tag 输出：验证纯文本、两种包装、空输出和 reasoning 块解析。
- 后处理服务：验证 Tag 预览不创建 Job；发送使用新正向 Tag、原负面 Tag和原 NovelAI 参数。
- API：验证请求字段、鉴权用户、错误状态和成功响应。
- 前端：验证 LLM 成功只更新待发送 Tag；关闭重开仍保留；“发送”才调用 NovelAI；发送成功后替换正文图片。
- 回归：现有双击图片入口、历史图片预览、局部重绘、原始重 roll 和 NovelAI 队列测试继续通过。
