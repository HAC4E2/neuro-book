---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: media.text-to-image.llm-toolcall
owners:
  - media
  - server
  - text-to-image-settings
---

# 文生图 LLM Toolcall 与 Tail 设置合同

## 目标与非目标

本能力让 NeuroBook 的五类 OpenAI 兼容 LLM 文生图请求使用可配置的 function Tool 承载结构化思考/正文输出，并按配置追加 Tail 消息；结果继续交给现有正文生图、角色设计、角色展示、角色修改和 Tag 修改解析链。Tool/Tail 的默认值与固定版本 `damoshen123/st-chatu8` 的默认值逐字一致。

本能力不执行模型返回的工具，不引入 Agent 工具循环、第二次请求、RunningHub、视频、Extra Body、Headers、翻译或 NovelAI 请求语义，不改变数据库 schema/migration、凭据所有权、图片写回和现有业务结果格式。

## 术语与参与者

- **Tool 配置**：启用状态、工具命名、描述和有序字符串字段的对象。
- **Tail 配置**：启用状态和有序 `system/user/assistant` 消息数组。
- **全局配置**：`textToImage.toolCallConfig` 与 `textToImage.tailMessagesConfig`。
- **Provider 覆盖**：OpenAI 兼容 Provider settings 中同名的完整对象；缺少键表示继承全局。
- **有效配置**：完整 Provider 覆盖 > 全局配置 > 固定内置默认值，Tool 与 Tail 分别计算。
- **请求类型**：`image_gen`、`char_design`、`char_display`、`char_modify`、`tag_modify`。

## 输入与前置条件

调用方先按请求类型解析 Provider 与上下文 profile。上下文条目过滤、`complete/augment` 选择、运行时占位符替换、图片过滤和消息合并在 Tool/Tail 组装之前完成。有效 Tool 配置的字段名只能包含字母、数字、下划线和连字符；字段名唯一，至少一个字段必填；最终 function 名不超过 64 个字符。Tail role 只能是 `system`、`user` 或 `assistant`，允许空消息数组。

配置保存和独立导入都必须通过同一运行时 schema；无效对象拒绝并保留旧值。凭据只沿用现有 Provider 凭据边界，不进入全局配置、导出文件、预览响应或日志。

## 输出与可观察行为

Tool 开启时，HTTP 请求包含一个 function Tool 和指向本次工具名的固定 `tool_choice`；parameters 是 object，字段按配置顺序生成 string properties，required 只列必填字段。Tail 开启时按配置顺序追加消息，并只替换 `%TOOL_NAME%`、`TOOL_NAME%`、`%s` 为本次工具名。

非流式和流式响应都只读取 `choices[0]`。同名 function 调用的 arguments 合并为字段结果，按配置字段顺序输出，字段之间使用两个换行；`wrapTag` 只在值尚未包裹匹配标签时添加。未知工具、非法 JSON、缺少必填非空字符串和空结果都失败。Tool 开启但没有 tool_calls 时，非空普通 content 可作为兼容结果；content 与 tool_calls 都为空时失败。

管理端预览返回最终 `messages`、`tools` 和 `tool_choice`，不发起网络请求，不返回凭据。Tool/Tail 设置页面可以编辑字段与消息、调整顺序、恢复固定默认、选择 Provider 继承或完整覆盖，并以 `antigravity_tool_config` / `antigravity_tail_config` version `1.0` 独立导入导出。

## 状态与转换

本能力不引入持久状态机。配置读取状态为“全局/Provider 有效对象”；Provider 缺省覆盖键时读取为继承，保存独立覆盖时写入完整对象，切回继承时删除覆盖键。每次请求在重试循环外生成一次动态工具名，所有重试复用该名称；请求结束后不保留工具运行状态。

## 副作用与数据

请求会向已配置的 OpenAI 兼容 Provider 发起现有 `/chat/completions` 网络请求，继续使用现有 URL/DNS、凭据和重试边界。配置保存沿用现有用户设置持久化；本能力不新增表或迁移。预览只有内存构造，无网络和持久化副作用。导入导出只处理用户选择的配置文件，不自动导入或绑定上下文预设附件。

## 失败与恢复

配置校验、工具名校验、字段校验、Tail role 校验和导入格式校验失败时返回可诊断错误，旧配置保持不变。HTTP 429/5xx 沿用现有 retryCount；每次重试保持相同工具名和请求合同。SSE 支持任意 chunk 边界、UTF-8 分片、CRLF、无末尾换行、`[DONE]`、finish_reason 和提前关闭；只有完整可解析的工具参数或非空文本才成功，半截 JSON 不得作为成功结果。Provider 拒绝 Tool 请求时保留错误，不自动关闭配置或改走无 Tool 请求。

## 边界与兼容

配置数据 owner 是文生图全局配置与 Provider settings；业务解析器仍拥有各自结果格式。Tool 关闭时维持原有 content 链路，不发送 tools、tool_choice 或 Tail。旧全局配置缺失新对象时补齐固定默认并开启；旧 Provider 缺少覆盖时继承全局；显式 `false`、空 messages、自定义文本和字段顺序必须保留。上游默认长文本以运行时 Unicode 内容为准，不做摘要、纠错、trim、翻译或去重。

## 验收与 Smoke

- Given 缺少新配置的旧设置，When 读取有效配置，Then Tool/Tail 使用固定默认且读取不主动写盘。
- Given 全局或 Provider 显式关闭/空数组，When 发送请求，Then 关闭值生效，不被默认值覆盖。
- Given dynamic/fixed 命名和重试，When 请求重试，Then tool、tool_choice、Tail 占位符和解析器使用同一工具名。
- Given Tool 响应包含分片 arguments、多次同名调用、未知键或缺失字段，When 解码，Then 只按合同输出或明确失败。
- Given SSE 任意 chunk/CRLF/提前关闭，When 解码，Then 完整 JSON 成功、半截 JSON 失败，且与非流式结果一致。
- Given 管理端预览，When 组合消息，Then 返回最终 messages/tools/tool_choice 且无网络请求和凭据。
- Given 两个兼容性样本导入，When 经过现有上下文组装，Then 所有条目、禁用状态和顺序保留，Tool/Tail 不重复追加。

实现后的聚焦入口为 `packages/neuro-book/server/text-to-image/llm-chat.test.ts`、配置 DTO/normalizer 测试、五类业务 LLM 测试、设置组件/预览测试和 `bun run docs:check`；真实 Provider/Model 验收另行授权。

## 实现合同

实现入口由共享 DTO、`server/text-to-image/llm-toolcall-config.ts`、`llm-toolcall-response.ts` 和 `llm-chat.ts` 组成；五类业务 LLM 调用、显式 Provider 测试接口和请求预览都使用同一份有效配置与请求准备逻辑。设置页保存全局配置或完整 Provider 覆盖，独立 Tool/Tail 文件通过同一 schema 校验；没有新增数据库字段、迁移、工具执行循环或真实 Provider 依赖。

离线合同测试覆盖默认值指纹、全局/Provider 覆盖、Tool/Tail 开关、动态名称重试复用、JSON/SSE 解码、坏参数、导入导出和取消不重试。仓库现有系统 assets global setup 与 Prisma 生成文件缺失会阻塞完整测试和类型检查，新增测试本身已在关闭该既有外部 setup 的一次性投影中通过；真实 Provider、浏览器人工验收和远端动作未运行。

## 证据

批准依据是开发者在本会话中明确要求对齐 chatu-8 Toolcall/默认设置，并在后续目标中授权将施工计划完整落地。实现与离线验收入口如下：

- [Tool/Tail 配置、请求和响应合同测试](../../../packages/neuro-book/server/text-to-image/llm-toolcall.test.ts)
- [Tool/Tail DTO 与全局 schema 测试](../../../packages/neuro-book/shared/dto/text-to-image.dto.test.ts)
- [配置 normalizer 默认与显式关闭测试](../../../packages/neuro-book/server/config/normalizer.test.ts)
- [Tool/Tail 独立文件往返测试](../../../packages/neuro-book/app/utils/text-to-image-tool-config-import.test.ts)
- [共用请求构造与解码入口](../../../packages/neuro-book/server/text-to-image/llm-chat.ts)
- [固定上游默认值](../../../packages/neuro-book/shared/text-to-image-toolcall-defaults.ts)
- [固定上游 commit 3138b2c7](https://github.com/damoshen123/st-chatu8/tree/3138b2c7f24b01c65b72389e2ff7502bd4ee9030)
