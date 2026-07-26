# Provider 模型 Pi API 批量修复设计

## 背景

旧版 `config.json` 可以包含没有 `modelApi` 和模型级 `api` 的 Provider/模型。新版 Provider Config 合同要求每个 Provider 有默认 Pi API，且每个已保存模型（包括停用模型）都有自己的明确 Pi API。当前界面只把 Provider 默认值用于发现和新模型补全，不会改写已有模型，所以用户即使选择默认值，已有模型的 `missing_api` 仍持续显示。

## 选定方案

扩展现有“一键修复”：当 Provider 默认 Pi API 是受支持值时，只将它写入该 Provider 下 `api` 为空的模型；已有模型 API 无论是否与默认值相同都不覆盖。模型 API 补齐后，继续运行现有 Model Library 能力补全和不完整停用模型清理。

未采用的方案：保存时隐式继承会隐藏持久化事实；自动猜测 OpenAI/Anthropic 等协议可能发错请求；直接批量覆盖全部模型会破坏同一 Provider 下混合 API 的合法配置。

## 边界

- 只响应用户已明确选择的、受支持的 Provider 默认 Pi API。
- Provider ID 或模型 ID 重复时跳过，保持现有 fail-closed 语义。
- 只补空值，不覆盖任何非空模型 API。
- 保持“一键修复”只修改前端草稿，用户检查并手动保存后才持久化。
- 修复结果单独显示补齐的模型 API 数量。

## 验证

- 红灯覆盖：空模型 API 被补齐、已有不同 API 不覆盖、Provider 默认 API 无效时不处理、重复 ID 跳过。
- 组合测试覆盖：同一次 repair 中，API 补齐发生在 Model Library 能力补全之前。
- 运行模型设置聚焦测试、typecheck、完整 Nuxt build、Product stage 和 Desktop assemble。
- 最终输出更新到 `dist/neuro-book-desktop-x64`；不自动修改用户的 `config.json`。

## 追加设计：旧运行时隐式回退迁移

真实 Portable 配置证明 Provider 与模型两级 API 都为空，因此前述草稿修复没有输入值可用。旧运行时的有效解析顺序明确以 `openai-completions` 作为最终回退；新严格合同移除回退后，必须在 stored config 归一化边界把这个历史有效值显式物化。

- Provider `modelApi` 缛失时物化为 `openai-completions`；非空值保持原样，包括需要合同报告的无效值。
- 模型 `api` 缺失时复制该 Provider 的受支持 API；如果 Provider 是非空无效值，则不替模型掩盖错误。
- 这是加载期的数据规范化，不是 runtime 隐式继承：编辑快照和后续保存都会携带模型自己的显式 API。
- 该方案不按 Provider 名称、Base URL 或 Secret 猜协议，严格复现旧版本对这些空值实际采用的运行语义。
