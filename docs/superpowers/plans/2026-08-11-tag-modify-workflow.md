# Tag 修改两阶段工作流实施计划

## 目标

实现“Tag 修改只调用 LLM 生成待发送 Tag；用户点击发送后才进入 NovelAI 队列”，并让待发送 Tag 在关闭、重新打开后处理对话框时仍保留。

## 实施步骤

1. **建立 Tag 修改 LLM 合同**
   - 新增 `server/text-to-image/tag-modify-llm.ts`。
   - 编写提示词组合、`tag_modify` 任务上下文接入、输出包装解析和空输出校验。
   - 先补纯函数及注入 `complete` 的失败测试，再实现模块。

2. **拆分服务端“预览”和“发送”**
   - 修改 `edit-tag` API/服务：请求修改要求，调用 `tag_modify` LLM，只返回新 prompt，不创建 NovelAI Job。
   - 新增 `send` API/服务：接收当前待发送 prompt，沿用资产快照的负面 Tag、模型、尺寸、Provider 和锚点，复用现有串行队列。
   - 让原有 reroll 快捷操作复用发送服务的原始 prompt 路径。
   - 补充服务/API 合同测试，证明 LLM 预览阶段没有入队，发送阶段才入队。

3. **调整后处理对话框与图片槽位状态**
   - Tag 修改弹窗改为输入自然语言修改要求，并增加当前 Tag/待发送 Tag 展示。
   - LLM 返回后只更新页面级按 `sourceAnchorId` 索引的待发送 Tag；关闭对话框不清空。
   - 增加“发送”操作，发送当前待发送 Tag；原图片在发送前保持不变，成功后才通知宿主替换正文图片。
   - 历史图片切换与待发送状态按图片槽位解耦，避免预览切换污染正文。
   - 补充组件/交互合同测试，覆盖关闭重开、LLM 不触发生图、发送才触发 NovelAI。

4. **回归验证**
   - 运行 Tag LLM、资产后处理、正文占位符/图片交互相关 focused tests。
   - 运行 `bun run typecheck` 和 `git diff --check`。
   - 如环境允许，再执行相关完整文生图测试集；如 Git 权限仍失败，报告未提交状态，不修改或清理用户现有改动。

## 约束

- 不修改历史 `TextToImageAssetDto.prompt` 和已完成 Job 快照。
- 不把 LLM 的 `maxTokens`误用为 NovelAI 或队列限制；Tag LLM 使用已有 LLM Provider 参数合同。
- NovelAI 仍沿用现有代理、去重、串行队列、15 秒最小间隔和 429 不自动重试规则。
- 保持当前双击正文图片入口、历史预览、局部重绘和原有重 roll 行为。
