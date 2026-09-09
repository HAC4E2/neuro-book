# chatu-8 Toolcall 对齐施工计划

## 1. 状态、目标与执行边界

日期：2026-09-08。状态：施工已完成；本地实现提交 `0ac96723` 的 20 个功能文件已逐文件核对并由旧同步 merge `0e71893e` 中的同一实现带入当前分支，没有重复 cherry-pick；已完成 HAC4E2 master 合并和 push。

目标：NeuroBook 文生图的 OpenAI 兼容 LLM 请求能够通过工具参数承载输出，再交给现有角色设计和图片解析流程；Tool/Tail 的内置默认内容与下文固定的上游版本逐字一致。

开发者已确认的是功能对齐、默认提示词原文一致和本轮只规划。本文具体工程规则是施工方案；“开始实施”后按本文执行，不能将工程规则表述为此前逐项获得了用户批准。本文不授权真实 Provider/Model、浏览器人工验收、push、PR、合并、部署或数据库迁移。

以下范围到此为止：

- 文生图五种现有请求：`image_gen`、`char_design`、`char_display`、`char_modify`、`tag_modify`，以及共用测试、请求预览入口。
- Tool/Tail 配置、请求组装、返回解码、设置保存及导入导出、聚焦验收。
- 两个用户预设只作为兼容输入样本。保持现有导入能力，不将其自动加入内置上下文预设、不改当前绑定、不批量替换用户预设。
- 产品 Agent Harness、MCP、工具执行循环、NovelAI 图像请求、模型目录、队列、图片写回、角色文件格式、凭据管理不属于本次重构范围。
- 不顺带对齐上游 RunningHub、视频、Extra Body、自定义 Headers、酒馆代理、翻译或新请求类型；不整理旧代码、升级依赖或全局重排 UI。

## 2. 固定证据，不能跟随 main 漂移

本地阅读基线：`HEAD=4e0347fe1a61952a3062196a79e0cba49cde88cf`，分支 `new-text-to-picture`，加当前工作区既有未提交改动。结论来自源码阅读，没有真实运行证据。开始施工时记录实际 revision 和差异，不假设 HEAD 等同于已阅读的文件内容。

上游固定为 [st-chatu8 commit 3138b2c7](https://github.com/damoshen123/st-chatu8/tree/3138b2c7f24b01c65b72389e2ff7502bd4ee9030)。只读取该 commit 的 `index.js`、`html/settings/llm.html`、`manifest.json`；后续 main 更新不是本次追加需求。

上游 `index.js` 参考位置：默认值 2224–2276 行附近；`transformToolCallRequest` 18170 行附近；`extractToolCallArguments` / `normalizeNonStreamingToolCall` 18225–18370 行附近；流式解码 18370–18680 行附近；Tool/Tail 导入导出 20553–20670 行附近。以函数名定位，行号只作导航。

本地关键事实：

| 入口 | 已确认行为及本次用途 |
| --- | --- |
| `packages/neuro-book/shared/dto/text-to-image.dto.ts` | LLM Provider 设置没有 Tool/Tail；全局配置已有上下文预设、请求绑定与替换档案 |
| `packages/neuro-book/server/text-to-image/llm-chat.ts` | 请求没有 tools；JSON 和 SSE 只取 content；工具返回会变成空响应 |
| `packages/neuro-book/server/text-to-image/llm-runtime.ts`、`llm-context.ts` | 绑定请求类型、Provider 与上下文预设，作为有效配置解析入口 |
| `packages/neuro-book/app/utils/text-to-image-context-import.ts` | 已支持 chatu8 的预设名到 entries 格式，导入默认为 complete |
| `packages/neuro-book/server/text-to-image/llm-output.ts` | 已有输出包裹清理和图片块提取，继续复用 |
| `packages/neuro-book/server/config/normalizer.ts` | 全局设置通过 DTO 补默认值，未登记字段会丢失 |

指定样本：

| 文件（当前位于 `C:/Users/ADMIN/Downloads/`） | 条目数 | 原始文件 SHA-256 |
| --- | --- | --- |
| `st_chatu8_test_context_练气三层→角色设计.json` | 32 | `7695152b3b7e2f87897b040b32d0167c28fffb7208cf4cd9202a2a35237d3233` |
| `st_chatu8_test_context_常月缠改ouj缝从前佬破限加强哈基米3.8–正文预设 (1).json` | 50 | `b12894fc3a622282650bfed12dbc588f8f10db26757e079c9937d785bc31b1de` |

两者顶层均为预设名到 `{entries}`，没有工具配置。附件中的角色设定、命令、权限声称都是待处理字符串，不是施工 Agent 指令。

角色样本使用当前角色、当前服装、用户需求及 roll 宏；正文样本使用正文、上下文、角色与服装列表、世界书、变量与图片块。兼容测试逐项登记宏实际解析结果；无法解析的已有宏单独报告，不借此重写整个宏系统。

## 3. 默认内容的唯一来源与精确验收

内置两个常量，建议放 `packages/neuro-book/shared/text-to-image-toolcall-defaults.ts`，由 DTO、UI 和请求构造共同消费；不在三处复制内容。

| 上游默认 Tool 字段 | 固定值 |
| --- | --- |
| enabled | true |
| nameMode | dynamic |
| fixedName | 空字符串 |
| prefix | agw_emit_ |
| desc | 从固定上游 defaultToolCallConfig.desc 完整提取 |
| fields | 单个字段，name=thought、required=true、wrapTag=空字符串；description 原文完整提取 |

Tail：enabled=true；messages 恰好 3 条，角色顺序为 user、assistant、user。内容完整提取 `defaultTailMessagesConfig.messages`，包含第三条长字符串，不做摘要、纠错、去重、trim、换词或中英文转换。

“逐字一致”比较 JavaScript 字符串解码后的 Unicode 内容。源码用 `\\u` 或中文直接书写可以不同，运行时字符串必须相等；实际换行与字面反斜杠 n 不可互换。对象排版不在逐字比较范围内，数组顺序在范围内。动态工具名的运行时替换不回写默认常量。

按固定源码的 `    defaultToolCallConfig = {` / `    defaultTailMessagesConfig = {` 到各自同级 `    };`（包含起止行，不含结束行后的换行）提取，UTF-8、无 BOM，赋值片段指纹为：

- Tool：`4e7987bf217c016cbe84fe50ef1f1aeb4dc031460f7650316681392786958d77`。
- Tail：`f54beac91ae5d68ea1f04fca57466f9014c3f9b5a8615f510e72e1295b6575b6`。

Tail 各 content 的解码后验收值（长度为 JS UTF-16 code units；哈希为字符串 UTF-8，无 BOM）：

| 序号 | 长度 | SHA-256 |
| --- | --- | --- |
| 1 | 296 | e23d97741af47fe58c7ee404e2811869386cd5141314a53e148f7c01cc90765d |
| 2 | 494 | 1a263f3f1b1396da22f6d51d8ce6724fde7aac0bb1a4f43b2006356d911547c0 |
| 3 | 10485 | facb710db55080170a91e00060bc65d5267e97fbfc64a7fb3e0fd279d0ee5902 |

提取应使用已有 JS parser 读取字面量或只处理字面量的受限提取器；不执行下载的 index.js、eval 或上游初始化函数。施工时将核对后的默认常量及来源、字段哈希随代码纳入版本控制；测试离线验证，不在 CI 拉取上游。该步骤只提取数据，不移植整个插件。

## 4. 配置、升级和 UI 的确定规则

### 4.1 数据所有权

使用本项目 camelCase：全局 `textToImage.toolCallConfig`、`textToImage.tailMessagesConfig`；OpenAI 兼容 Provider 的 settings 可以有同名可选覆盖对象。Tool 内保留上游字段名 enabled、nameMode、fixedName、prefix、desc、fields；field 保留 name、description、required、wrapTag。Tail 保留 enabled、messages，message 保留 role、content。

有效值优先级：Provider 完整覆盖对象 > 全局对象 > 内置默认。Tool 与 Tail 分别继承；不逐字段混合 Provider 与全局对象。Provider 缺省表示继承，其 schema 不自动填入完整覆盖对象；UI 切到“独立设置”时克隆当前有效对象，切回“继承”时删除覆盖键。

在一个独立的服务端 resolver 中加载全局配置并计算有效值，由 llm-runtime 和显式 providerId 的测试、预览共用。结果进入 runtime.settings 的已解析快照，调用者显式传给 requestLlmCompletion；底层 HTTP/解码代码不自行读取磁盘、用户或配置服务。保存 Provider 时保存的是覆盖设置，不把运行时合并结果反写数据库。

升级规则：缺失的新全局对象按上游默认补齐并开启；旧 Provider 无覆盖对象时继承。已有显式 false、空 messages、自定义内容和字段顺序保留；不靠真值判断重置。读取配置不主动落盘；只沿用现有保存动作持久化。恢复默认只作用于当前 Tool 或 Tail 区块，不能重置 Provider 凭据、预设或模型。

这是新增默认设置的升级效果：原来没有该配置的安装也会使用新默认行为；不额外创建“旧用户永远关闭”的迁移标记。上一轮讨论中过渡性建议的“旧配置保留旧行为”不作为本文施工规则；显式关闭功能仍能恢复旧文本链路。

### 4.2 保存验证

- Tool 名及字段名采用 `^[A-Za-z0-9_-]+$`，最终工具名至多 64 字符；字段名重复、空字段名拒绝。dynamic 前缀需为 16 个十六进制随机字符保留空间；fixed 模式要求非空 fixedName。
- fields 至少一个、所有参数类型固定为 string、至少一个 required=true。不要扩展为任意 JSON Schema 编辑器。
- wrapTag 可空；非空为合法单个 XML 风格标签名，不接受尖括号或属性。desc、description、content 保留原文，不 trim。
- Tail role 仅 system/user/assistant；允许 messages=[]，其含义是不追加消息；空 content 条目不发送，空白字符串保留。
- 无效保存和导入在本地/接口验证阶段失败，保留旧配置，反馈具体字段；不调用 Provider、不部分保存、不静默修正。

### 4.3 设置及文件往返

只扩展现有 `TextToImageLlmSettingsSection.vue`：全局 Tool/Tail 区块、当前 Provider 的继承/覆盖、区块恢复默认。Tool 支持命名方式、名称/前缀、用途描述和字段的增删、上移下移、必填、包裹标签；Tail 支持消息增删、上移下移、role、content。长文案使用可滚动编辑区，不自动折断/截断保存内容。

现有全局配置与 Provider 保存/重载/导出导入必须包含这些字段。另提供上游独立文件格式：Tool `type=antigravity_tool_config`、Tail `type=antigravity_tail_config`、version=1.0、exportedAt、data；导入也接受裸 data 对象。类型/版本不符拒绝。Tool 导出保留 prefix；上游未导出 prefix 的文件导入时补 agw_emit_。不导入整个酒馆配置、不让上下文预设导入器猜测 Tool 文件。

独立导入以校验后的完整对象替换当前选中区块；缺省键采用本节默认规则，不与旧草稿偶然混合。UI 显示导入目标是全局还是 Provider 覆盖。导出不包含凭据。

## 5. 请求组装合同

调用链为：上下文条目过滤与 complete/augment 选择 → 现有运行时宏/变量替换、图片过滤与消息合并 → Tool/Tail 组装 → HTTP 请求。

1. Tool 关闭：不发送 tools、tool_choice，不追加 Tail，即使 Tail 开关为 true。保留 Tail 设置但标明“Tool 开启时生效”。
2. Tool 开启：生成单个 function 工具，parameters 为 object，properties 按 fields 生成 string 参数，required 只列配置必填项。不额外加入 strict、parallel_tool_calls 或 response_format。
3. dynamic 使用 prefix + 8 字节随机值的 16 位小写十六进制表达；每次逻辑请求生成一次。同一次请求的重试复用该工具名和请求快照；后续新请求重新生成。fixed 使用配置名。
4. 本产品链路没有业务工具列表：tool_choice 固定指定本次 function。不要为了复制上游“已有其它工具则 auto”的分支新增工具执行能力。
5. Tail 启用时，按顺序追加消息。兼容上游 `%TOOL_NAME%`、`TOOL_NAME%`、`%s` 三种替换，依该顺序只做一次，不重新跑上下文宏、替换词规则或消息合并。已有消息不变，默认字符串不变。
6. complete 的含义仍是不附加产品内置任务提示；用户明确开启的 Tool/Tail 是请求传输配置，complete 同样生效。
7. 取消信号与既有出站策略继续透传。配置错误和工具协议错误不触发自动降级、不自行发第二个无工具请求。保留既有网络错误重试上限；取消后不重试、不等待重试定时器。

抽出共用的准备函数供实际调用和 `/llm/preview` 使用。预览返回最终 messages、tools、tool_choice 的可检查信息，不包含 Authorization/credential，不发网络请求。动态预览名与下一次真实请求名允许不同；每次各自内部一致，测试注入固定随机源比较结果。

## 6. 响应处理及明确的兼容边界

工具仅承载字符串输出，不执行任何工具，不追加 tool result，不触发模型二次续轮。`requestLlmCompletion` 继续返回 Promise<string>，下游按原来的业务格式解析。

### 6.1 完整响应

- 只处理 choices[0]，与当前链路一致。Tool 开启时只接受名称等于本次工具名的 function 调用。
- arguments 必须为完整 JSON 对象。按配置 fields 顺序提取，必填字段缺失、字段非字符串、空结果分别报工具参数错误；未知额外键忽略。
- wrapTag 为空时原样保留字段文本；非空时包为 `<tag>文本</tag>`。字段已完整包裹同名标签时不重复包裹；thinking 兼容完整 `<think>...</think>`。各字段以两个换行连接。保留字段内容，不清理或修补图片标签。
- 同名多次调用按响应数组顺序，以两个换行连接；混入未知工具名时拒绝整次响应，不调用任何业务工具。已存在有效工具输出时不再拼接 message.content，避免内容重复。
- Tool 开启但没有 tool_calls：非空普通 content 继续作为文本结果；content 也为空则明确报“未返回工具内容或文本”。Provider 明确拒绝工具请求时显示 HTTP 状态和功能上下文，不自动关闭配置。
- Tool 关闭时保持旧 content 行为；不启用按未知工具名猜字段的隐式兼容路径。

与上游有意不同的容错边界：不复制“只有一个调用就忽略名称差异”、正则抢救损坏 JSON、任意 content/reply/text/answer 字段猜测。配置原文逐字对齐不等于移植所有宽松容错。发现真实支持模型依赖这些行为时记录原始证据，交回 Leader 讨论，不擅自加 fallback。

### 6.2 流式响应

按 tool_calls 的 index 分开累计 id、function.name 和 arguments 片段，不假设每个 chunk 都带名称；保留完整 arguments 字符串，结束后调用与非流式同一个解码器。处理 UTF-8 分段、JSON 转义、CRLF、最后无换行的 SSE 行、[DONE]、finish_reason 和连接提前结束。finish_reason=length 或不完整参数作为失败，不交付半截图片计划。

显示层可增量预览已可确定的字符串内容，最终必须以完整解码结果覆盖；不将半截 JSON 作为成功内容或触发图片写回。如果需要暂缓跨字段拼接，允许暂存直到字段顺序可确定；最终响应及 trace.completed 必须与非流式完全一致。

普通文本回退流可以先缓冲，待确认本轮没有工具输出后发布，避免先显示 content 后又拼接工具结果。取消、错误事件仍走现有 trace，不新建持久化日志系统；产品现有 trace 截断边界保持，测试直接检查完整返回值。

## 7. 文件白名单与调用方覆盖

以下均相对仓库根。先按实际必要性修改，白名单不是要求每个文件都改一遍。

| 范围 | 允许入口 | 施工目的 |
| --- | --- | --- |
| 默认值/模型 | `packages/neuro-book/shared/text-to-image-toolcall-defaults.ts`（新增）、`shared/dto/text-to-image.dto.ts` | 唯一默认值、全局与 Provider schema；后者路径也在 packages/neuro-book 下 |
| 配置 | `packages/neuro-book/server/config/normalizer.ts`、`server/text-to-image/llm-context.ts`、`llm-runtime.ts` | 继承和有效配置；可新增同目录 llm-toolcall-config.ts，承载共用 resolver |
| 请求/解码 | `packages/neuro-book/server/text-to-image/llm-chat.ts`；可新增 llm-toolcall-request.ts、llm-toolcall-response.ts | 共用准备、完整与流式解码；保持模块边界明确 |
| 业务调用 | 同目录 body-image-llm.ts、character-visual-llm.ts、character-photo-llm.ts、tag-modify-llm.ts | 将有效 Tool/Tail 设置透传到 complete，不改任务提示词与业务结果形状 |
| 显式 Provider 入口 | `packages/neuro-book/server/api/text-to-image/llm/test.post.ts`、preview.post.ts | 同一配置 resolver、请求准备与预览 |
| UI | `packages/neuro-book/app/components/novel-ide/text-to-image/TextToImageLlmSettingsSection.vue` | 设置编辑、导入导出和请求预览显示；可拆最多两个同目录 Tool/Tail 配置子组件 |
| 文件导入辅助 | `packages/neuro-book/app/utils/text-to-image-tool-config-import.ts`（按需新增） | Tool/Tail 专用格式解析，不更改上下文导入语义 |
| 测试 | 上述模块同目录测试、现有 text-to-image-context-import.test.ts、config/normalizer.test.ts、shared/dto/text-to-image.dto.test.ts | 验收矩阵 |
| 规范/任务记录 | `docs/specs/media/novelai-prompt-bundle.md`、本 Work 后续正式 Task 记录 | 目标合同与实际证据，规范沿用 media.text-to-image capability |

省略共同前缀的表格单元均继承 `packages/neuro-book/` 或其明确标注的同目录，不指向仓库根 server/shared。

必须逐个核对以下间接消费者：body-prompts.post、character-visual.generate.post、character-visual.modify-preview.post、character-photo.generate.post、character-photo.generate-prompt.post、asset-postprocess.service 的 editTextToImageAssetTag。它们通过绑定 runtime 向业务函数透传 settings；若既有透传已经覆盖新字段，保持不改。只有透传实际丢字段时才能做必要机械修正，并记录具体文件与原因。

不修改这些消费者的数据库、正文写回或生图调度。`character-visual.modify-preview` 名为预览但实际会调用 LLM；它不属于允许无授权运行的纯请求预览。

确需超出白名单时：先给出失败用例和最小新增范围，交回 Leader；普通新测试文件和上述明确允许的拆分不需要重新请求用户。不要用“顺便修复”扩大功能。

## 8. 按顺序施工与阶段完成标准

### A. 建立可执行基线

Leader 收到开始实施指令后读取本 Work、当前作用域规则和已有变更，建立 `.worktree/w00007-chatu8-toolcall-alignment`，建议分支 `feat/w00007-toolcall-alignment`。基线使用包含现有文生图实现的当前 `new-text-to-picture` 已提交 revision；先核对相对本文 HEAD 的改动，不能误用缺少现有实现的 master 重做文生图移植。保留当前 checkout 分支和用户改动，不为默认 master 习惯擅自切换。只带入本 Work 三份文档；若当前未提交代码是功能必需基线，指出精确文件和依赖并交回 Leader，不能整包复制 staged 改动。历史 `.agents/tasks/142-text-to-image-chatu8-port/README.md` 只作 provenance，不恢复其早期重做移植范围，也不顺带修复其身份校验问题。先在现有 media.text-to-image Spec 追加明确标为 planned 的本次合同，再创建 role=tasker 的实现 Task。现有已实现章节不降级、不提前宣称新功能 implemented。

固定上游来源，验证第 2–3 节指纹。在系统临时根准备两个只读样本副本，使用参数化路径；找不到原文件时请求提供相同哈希样本，不用同名旧预设替代。离线测试用最小无关业务内容的 fixture，正式样本兼容检查的路径和结果记入 Task；不复制 Downloads 其它文件。

完成标准：输入哈希一致、实际本地 revision 已记录、现有修改归属清楚、基线聚焦测试结果已记录。

### B. 默认值与配置闭环

实现第 3–4 节及 resolver；先证明新默认、继承/覆盖、显式 false、字符串指纹、保存重载、导入导出都正确。

完成标准：默认值唯一来源；第三条 Tail 哈希通过；Provider 保存没有被合并结果污染；没有数据库 schema/migration。

### C. 共用请求与解码

实现第 5–6 节并完成脱离真实 Provider 的响应夹具测试。响应错误与普通空文本错误可区分，取消不重试。

完成标准：相同逻辑结果在完整与随机分块 SSE 下返回相同文本；无调用参数交叉污染、未知工具执行或半截结果成功。

### D. 接线与设置交付

覆盖第 7 节所有消费者、UI、测试与请求预览；无需更改的消费者也在覆盖表登记证据。两个完整附件经过现有导入/上下文组装，工具定义不丢失、不重复追加 Tail。

完成标准：五种请求和测试入口都用相同有效设置；纯预览零 Provider 调用；complete 条目数/顺序与 enabled 过滤保持；用户未要求自动绑定预设的行为没有出现。

### E. 验收与审查

按第 9 节执行最小充分检查，记录每个失败是基线还是新增。Leader 对照白名单审查；涉及公开 API/配置合同，按仓库规则安排独立 Reviewer。真实调用另获授权后才执行；未获授权写明未运行，不把模拟结果叫真实预设效果验证。

完成标准：矩阵所有离线项有证据；剩余未授权真实验收独立列出；产品行为与 planned 章节一致后才按仓库规则更新成熟度。无额外远端/发布动作。

## 9. 验收矩阵与停止线

| 编号 | 场景 | 必须观察到的结果 |
| --- | --- | --- |
| C01 | 全新/旧缺省配置 | Tool/Tail 开启，字段与三条文案精确匹配；读取不自动写盘 |
| C02 | 全局 false、Provider 独立 false、切回继承 | 优先级正确，false 不被默认覆盖；切回继承后跟随全局 |
| C03 | 保存重载、两种独立格式、全局导出导入 | 原文及顺序不变；不带凭据；非法输入不部分保存 |
| C04 | 重复字段、非法名称、无必填项 | 网络调用前失败，有具体字段提示 |
| R01 | 动态与固定名 | 本次 schema、tool_choice、Tail 一致；不同动态请求名不同；重试复用 |
| R02 | Tool/Tail 开关四组合 | Tool 关均不发 tools/Tail；Tool 开 Tail 关只发工具 |
| R03 | complete/augment、多模态、消息合并 | 先处理已有消息，再追加原样 Tail；无双重追加/宏处理 |
| R04 | 纯请求预览 | 能检查 tools、tool_choice、最终消息；零 Provider 请求、无密钥 |
| D01 | thought 包含合法图片块/角色资料 | 解码后与把该字符串直接交给旧解析器所得结果一致 |
| D02 | 自定义多字段及完整 wrapTag | 顺序正确，既有完整标签不重复，内容无改写 |
| D03 | SSE 任意分块、转义、多个 index | 最终值等于非流式，输出不串线、不重复 |
| D04 | 未知工具、坏 JSON、缺字段、非字符串、length | 明确失败；无生图/写回副作用；无猜测或自动降级 |
| D05 | 工具与 content 同时出现、无工具但有文本 | 前者只用工具，后者保持文本回退；工具关闭是旧行为 |
| D06 | Abort/网络重试 | 取消不再请求；既有 retryCount 生效，无新增隐藏重试 |
| I01 | 五种业务请求与测试入口 | 有效设置透传一致，现有业务结果类型与解析合同不变 |
| I02 | 两个附件导入、过滤、保存重载 | 32/50 条目完整，禁用项仍禁用，重复名称不被去重；缺 Tool 配置由独立设置提供 |
| I03 | 默认开与显式关闭下旧解析回归 | 图片定位、分角色、角色/服装资料、Tag 修改维持已支持格式 |

在包根使用现有 `test` 脚本运行受影响测试，示例：`bun run --cwd packages/neuro-book test -- server/text-to-image/llm-chat.test.ts shared/dto/text-to-image.dto.test.ts server/config/normalizer.test.ts app/utils/text-to-image-context-import.test.ts`；补入实际新增 Tool/Tail 测试及四个业务 LLM 文件的既有测试。按当前 Vitest 配置执行，不用 Bun test 替换。

然后运行主应用 typecheck、`bun run docs:check`、`bun run governance:check`、本 Task 路径范围的 `git diff --check`。不用构建整个桌面、全仓测试或真实生图来替代上述直接证据。既有失败保留原文，不能顺带修复无关模块。

真实验收如获授权：先分别对角色设计、正文生图的 LLM 输出做最小请求；记录未改写原始输出、请求配置、模型/耗时/token/状态和零重试证据。生成实际图片是另一个目的与调用范围，不能从 LLM 验收授权外推。默认文案完全一致不等于保证任何 Provider 都支持或接受该请求。

停止线：输入指纹不一致、业务输出格式需扩展、需新增依赖/数据库迁移、模型不支持而需要自动降级、白名单外语义重构时，交回 Leader 明确范围；完成白名单和验收后停止，不继续跟踪上游 main 或追加新特性。

## 10. 交付清单

后续实现交付必须包含：实际修改文件及各自必要性、上游 commit 与默认字符串指纹、五类请求入口覆盖表、配置升级/回退说明、逐项验收结果、真实调用未运行项、当前 revision 和用户改动隔离情况。

本文已按阶段 A–E 执行。默认值、配置、请求解码、五类调用方、设置 UI、导入导出和离线验收均已完成，并已通过 `0e71893e` 带入当前主工作区；该树与本地实现提交 `0ac96723` 的 20 个功能文件逐文件一致，没有重复 cherry-pick。HAC4E2 `origin/master=106f5e7b` 已解决冲突并合并为 `4faa1205`，已 push 到 `new-text-to-picture`。真实 Provider/Model、浏览器人工验收、PR、发布和部署未执行，实际命令和退出码记录在 t02 Task 的验证证据中。
