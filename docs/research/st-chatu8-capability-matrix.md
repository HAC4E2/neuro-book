# st-chatu8 能力清单与 LLM 生图链路（移植参考）

> 来源：`/c/Users/admir/Desktop/Pi/neuro-book/.agent/st-chatu8/`（html/settings/*.html UI 契约 + index.js 运行时逻辑 + tagData 词库加密数据）。版本 2.7.7。
> 用途：作为 NeuroBook 文生图移植的逐项对照清单。配置项均为浏览器 localStorage 形态，**NeuroBook 不照搬**，应落全局配置 + Project Markdown 真相源。

## 1. 总体架构特征

| 特征 | 说明 | 对 NeuroBook 的启示 |
|---|---|---|
| 设置单窗口 + 左侧导航 | `settings.html`：模态设置窗口，左侧 16 分页导航，右侧内容区 | 文生图工作台 Dialog 同构 |
| AI 助手独立会话框 | `st-chatu8-ai-dialog`：独立聊天窗口（历史/新建/总结/设置） | 正文生图/角色 tag 的 LLM 会话交互 |
| 配置全 localStorage | 所有配置存浏览器 localStorage | NeuroBook 不照搬：全局配置 + Project Markdown 真相源 |
| 上下文预设驱动 | 所有 LLM 请求 = 请求类型 × (API 档案 + 上下文预设条目) | 核心可移植模型 |
| LLM 单次直调 | `executeTypedLLMRequest` → `/chat/completions` 单次调用 + 解析 | 与「director 收缩为 LLM 交互层」目标一致 |
| 词库加密 | tagData AES 加密，安装时解密入 IndexedDB | NeuroBook 用服务端 TagIndex 替代 |

## 2. LLM 模块（llm.html）

| 能力 | 关键配置项 | 运行时行为要点 | 移植注意 |
|---|---|---|---|
| LLM 配置档案 CRUD | 档案列表：新建/保存/改名/导入/导出/删除 | 多档案并存，按名切换 | 对应 NeuroBook Provider 概念；档案含 API 连接信息 |
| API 连接 | Base URL（手填含 /v1）、API Key（显隐）、模型下拉+手输、「连接并获取模型」 | 拉取 /models 列表填充下拉 | 复用 Provider URL 安全策略 |
| 流式生成 | stream 开关 | 流式 vs 非流式 | 可先做非流式 |
| 代理 | bypass_proxy（不走酒馆代理） | — | NeuroBook 无此概念，不需要 |
| 消息合并 | merge_system_user | 把 system 当 user 合并 | 可选兼容项 |
| 发送图片 | send_images（默认关） | 开则保留消息图片（多模态） | DS 等不支持多模态需提示 |
| 模型参数 | temperature 0–2（默认 0.7）、top_p 0–1（默认 1）、max_tokens 1–30000（默认 512） | — | 生图任务 max_tokens 调大 |
| 上下文预设 | 预设 CRUD + 另存为 + 导入导出；条目：role + content + enabled + trigger words | 按条目 role/content 拼装；trigger 命中才注入（checkTriggerWords 逗号分隔子串匹配） | 核心能力；NeuroBook 落 Project Markdown 真相源 |
| 上下文历史 | llm_history_depth 0–20（默认 2） | 发送历史层数 | — |
| Tagthink 回显 | tagthink_echo | 图片标签前显示 <Tag_think> 思考内容 | 可选 |
| 历史保留 <image> | history_keep_image_tag（仅正文生图） | 历史消息中的 <image> 块保留作参考 | 正文生图时参考已有图 |
| 错误重试 | llm_retry_count 0–5（默认 0） | 空响应/429 等重试，间隔 2s | 对齐 Provider 重试 |
| 请求类型绑定 | 10 类请求类型 ×（API 档案 + 上下文预设）；请求类型档案 CRUD | 每类独立绑定，可保存档案 | 核心架构：请求类型注册表 |
| 请求类型清单 | 正文图片生成 / 角色服装设计 / 角色服装展示 / 角色服装修改 / 翻译 / Tag 修改 / 智绘姬助手 / 角色人设生成 / User 人设生成 / 聊天总结 | 助手复用智绘姬面板 API | NeuroBook 先收敛：正文生图、角色 tag 生成、角色 tag 修改 |
| 测试工具 | 发送测试请求按钮；组合提示词预览（readonly）；AI 回复预览 | 展示最终拼装消息 + LLM 回复 | 调试利器，建议保留 |

## 3. NovelAI 模块（novelai.html）

| 能力 | 关键配置项 | 运行时行为要点 | 移植注意 |
|---|---|---|---|
| 固定提示词 | 前置正面 + 后置正面 + 负面，各带 token 占用显示、翻译、tag 自动补全 | token 本地 transformers 计算 | token 统计可做（NAI 官网口径） |
| 提示词预设 | 预设 CRUD + 可视化选择 + 另存为 + 导入导出 | 多套固定提示词快照 | 对应 Recipe 画风串 |
| 提示词替换 | 替换规则预设 CRUD + 规则文本（novelai.html） | 后端生成参数里的替换规则，作用于最终 prompt | 已有 prompt rules 可迁移；与第 10 节敏感词替换/正则区分 |
| 福瑞数据集 | addFurryDataset 开关 | 附加 furry 数据集 tag | — |
| 质量预设 | 正面 AQT / 负面 UCP 下拉 | 正负质量 tag 注入 | 对应 Recipe quality preset |
| 配置档案 | 参数快照 CRUD | 整组生成参数快照 | Recipe = 配置档案超集 |
| API | 站点（官网/其他+URL）、API Key、云端队列（URL + 排队个性语 + 显示他人） | 云端队列规避 429 | 用服务端队列，不需要第三方云队列 |
| 模型 | nai-diffusion-3 / 4-full / 4-curated-preview / 4-5-curated / 4-5-full | — | 模型注册表已有 |
| 采样/调度 | 采样器 7 种、噪点表（native/exponential/polyexponential/karras） | — | 已有对应实现 |
| 引导参数 | Prompt Guidance（scale）、Guidance Rescale | — | — |
| 高级生成 | AI 默认角色坐标、SMEA、SMEA DYN、Variety、Decrisp | 无图参数注入请求 | 已有实现但被旁路，需接通 |
| 生成参数 | 尺寸预设 + 宽高手输、steps、seed | — | — |
| Vibe Transfer | 启用、参考图选择/预览/移除、信息提取量 0–1、氛围强度 0–1 | 单图氛围参考 | 已有 reference-asset 基建 |
| 角色参考 | 启用、参考图库（上传）、角色组管理（最多 4 角色组） | 多图参考；每图+5 点数费用提示 | 已有 reference-asset |
| Vibe 文件生成器 | 生成 .naiv4vibe 官方兼容文件 | — | 已有 vibe-encoding/import 服务 |
| Vibe 组 | Vibe 组管理（最多 4 Vibe）、启用组转移、normalizeRefStrength 归一化强度 | 组模式与单 Vibe 互斥 | — |

## 4. 图片缓存管理（image-cache.html + main.html 缓存区）

| 能力 | 关键配置项 | 运行时行为要点 | 移植注意 |
|---|---|---|---|
| 缓存网格 | 图片网格展示（懒加载缩略图） | — | 有 TextToImageHistoryWorkspace 可对齐增强 |
| 多选操作 | 多选/全选/取消全选；下载选中（zip）；删除选中 | — | — |
| 分页 | 分页控件 + 页码跳转 | — | — |
| 缓存统计 | 缓存信息展示 | — | — |
| 缓存清理 | 按天数清理：不再缓存/1/7/30/365 天前 | 批量清除 | — |
| 存储位置 | 「缓存图片到酒馆」开关；「缓存 Vibe 到酒馆」 | 同步服务器图片；迁移 Vibe | 固定 Project 资产，无双存储 |
| 空间优化 | 转 JPEG 储存节省 70% 空间 | 格式转换（噪点增加提示） | 可选 |
| 数据迁移 | 数据迁移按钮 | 旧版本数据升级 | — |

## 5. 词库模块（vocabulary.html + tagData）

| 能力 | 关键配置项 | 运行时行为要点 | 移植注意 |
|---|---|---|---|
| 词库文件管理 | 可用词库列表；安装全部/卸载全部 | 文件 AES 加密，安装时解密导入 IndexedDB | TagIndex 已是服务端确定性索引 |
| 标签浏览器 | 树形结构浏览 | — | TagIndex 可对齐层级浏览 |
| 已选标签 | 点击收集到 textarea；回退/清空/复制 | — | — |
| 手动标签管理 | 添加（原文+翻译）、列表、过滤、刷新、导出/导入 JSON | 用户自定义标签 | — |
| 搜索设置 | 开头匹配、最大结果数（1–1000）、排序（热度升/降、英文名升序） | — | — |
| 测试搜索 | 搜索输入 + 结果展示 | — | — |
| 数据来源 | Danbooru 官方标签 27 文件，post_count ≥ 3000 分层 | — | 已定「官方 post_count≥3000 分四层」方案 |

## 6. 生图日志模块（log.html）

| 能力 | 关键配置项 | 运行时行为要点 | 移植注意 |
|---|---|---|---|
| 生图生涯统计 | 汇总卡片、图例、时间维度（日/周/月/年）、柱状图、按后端进度条 | 每次生图成功自动记录，永久保存 | Job/Asset 已有数据，可做统计投影 |
| 统计操作 | 刷新统计 / 重置统计 | — | — |
| 调试模式 | 启用详细调试日志（不持久化）、下载/清空 | 记录函数执行时间与分支逻辑 | 有 App JSONL 日志 |
| 错误收集器 | 全局错误监听、错误统计、查看详情、下载诊断包、清空（上限 500 条） | 诊断包附带当前日志 | — |
| 普通日志 | 导出 / 清空 / 只读 textarea | 插件专属运行日志 | 后端日志可投递 |
| 任务管理 | 任务列表 + 全部取消 + 清空已完成 + 任务统计 | 并发任务可视化管理 | 队列已有 cancel/retry，可对齐 UI |

## 7. 角色管理模块（character.html）——照搬决策

> **NeuroBook 决策**：角色视觉数据从 `image-tags.md`（tag-id 引用）改为 chatu8 式 JSON 真相源文件，LLM 正文生图时直接读取；支持角色头像生成。

| 能力 | 关键配置项 | 运行时行为要点 | 移植注意 |
|---|---|---|---|
| 角色预设 | 预设 CRUD + 可视化选择 | 角色视觉数据快照 | 角色 = Project 角色，visual.json 真相源 |
| 角色照片 | 照片上传/预览、发送照片、生成照片 prompt、修改照片 prompt、照片数据、prompt 翻译 | LLM 生成照片 prompt + 后端生图 | 核心新增：角色头像生成 |
| 角色详细参数 | 中文名/英文名/角色特征/五官正背/上下半身 SFW(正背)/NSFW(正背)/负面；token 统计；翻译；清空 | 字段与 CharacterVisualRawFieldsSchema 一一对应 | 字段模型已对齐，直接复用 |
| 服装预设 | 预设 CRUD | 服装视觉快照 | outfits/*.md 或 visual.json 内嵌 |
| 服装照片 | 上传/生成 prompt/修改/翻译 | — | — |
| 服装详细参数 | 中文名/英文名/上半身/上半身背/下半身/下半身背；token 统计 | 字段对应 OutfitVisualRawFieldsSchema | 已对齐 |
| 角色启动预设 | 预设 CRUD + 绑定角色卡/当前聊天 | 角色与启动预设关联 | 可后置 |
| 启用角色列表 | 添加/检查/测试触发词 | 触发词命中判断 | 可后置 |
| 通用服装列表 | 预设 CRUD + 列表管理 | 跨角色通用服装 | 可后置 |
| 通用角色列表 | 预设 CRUD + 列表管理 | 跨聊天通用角色 | 可后置 |

## 8. 主要设置模块（main.html）

| 能力 | 关键配置项 | 移植注意 |
|---|---|---|
| 总开关 | 启用插件、设置项答疑提示 | — |
| 后端模式 | SD / NovelAI / ComfyUI / Banana(Grok) | 只做 NovelAI |
| 图片交互 | 长按修改 tag、单击预览、双击触发、折叠、对齐（左/中/右）、显示大小（100/75/50/25%） | 编辑器图片交互体验 |
| 自动生成 | 自动点击生成、流式预生成、自动 LLM 请求生图、随机提示词预设、AI 自主分辨率、生图间隔 | 部分可选 |
| 触发标记 | 开始标记 / 结束标记（如 [ ]） | 正文触发标记 |
| 储存 tag 模式 | 插入原文（非同层） | — |
| 缓存管理 | 清理周期、缓存到酒馆、转 JPEG、同步服务器图片、迁移 Vibe、数据迁移 | 见模块 4 |

## 9. LLM 生图链路（运行时）

### 9.1 请求类型注册表（LLMRequestTypes）

10 类请求类型，每类绑定独立 API 档案 + 上下文预设（`llm_request_type_configs`）：

| 类型 key | 名称 | 用途 |
|---|---|---|
| image_gen | 正文图片生成 | 从正文生成 <image> 块 |
| char_design | 角色/服装设计 | 生成角色视觉 tag JSON |
| char_display | 角色/服装展示 | 生成角色照片 prompt |
| char_modify | 角色/服装修改 | 修改既有视觉 tag |
| translation | 翻译 | 翻译 prompt/tag |
| tag_modify | Tag 修改 | 修改 tag 串 |
| ai_assistant | 智绘姬助手 | 聊天助手 |
| persona_gen | 角色人设生成 | 生成人设数据 |
| user_persona_gen | User 人设生成 | 生成玩家设定 |
| chat_summary | 聊天总结 | 总结对话 |

### 9.2 请求执行链路（executeTypedLLMRequest）

```
调用方（onImageGenRequest 等）→ executeTypedLLMRequest(data, requestType, responseEvent, updateResultUI)
  ├─ 1. 取请求类型配置：getEffectiveConfigForRequestType → { api_profile, context_profile }
  ├─ 2. 拼装消息：buildPromptForRequestType(requestType, triggerText)
  │    ① entries 遍历：enabled=false 或 content 空跳过；
  │       triggerMode=trigger 时 checkTriggerWords(triggerWords, triggerText) 命中才注入
  │       push { role: entry.role || "user", content: entry.content }
  │    ② mergeAdjacentMessages({mergeSystemUser})：合并相邻同 role 消息
  │    ③ processRollPlaceholders：替换 1d6 等骰子占位符
  ├─ 3. 图片处理：send_images ? 保留 : stripImagesFromMessages
  ├─ 4. 参数：{ api_url, api_key, model, temperature, top_p, max_tokens, stream }
  ├─ 5. 发送：bypass_proxy=true → 直连 `${api_url}/chat/completions`（Bearer）
  │          bypass_proxy=false → 酒馆代理 /api/backends/chat-completions/generate
  ├─ 6. 重试循环（最多 llm_retry_count 次，间隔 2s）：网络/429/5xx/空响应重试；AbortError 取消
  ├─ 7. 读响应：stream=true SSE 解析（delta.reasoning_content + delta.content）；
  │          stream=false response.json() 取 choices[0].message.content
  ├─ 8. 事件回传：eventSource.emit(responseEvent, { success, result, id })
  └─ 9. 任务管理：taskQueue 记录任务 / 日志 / 悬浮球 loading
```

### 9.3 正文生图链路（handlePromptRequest → LLM_IMAGE_GEN）

```
handlePromptRequest（正文生图业务入口）
  ├─ 附加用户上传图：attachImagesToMessage（多模态参考图）
  ├─ 收集角色/服装参考图：getEnabledCharacterImages / getEnabledOutfitImages / getCommonCharacterImages
  │     → attachImagesToMessage 注入「角色服装参考图片」消息
  ├─ 变量替换：{{上下文}}、角色变量、getvar 变量（含 unused 诊断）
  ├─ updateCombinedPrompt：最终 prompt 展示到「组合提示词」文本框
  ├─ LLM_IMAGE_GEN(promt, { timeoutMs: 600000 }) → 单次请求，10 分钟超时
  └─ 回复处理：
       ├─ removeThinkingTags → 去 <think>/<thinking>
       ├─ parseImagesFromPrompt(cleanedPrompt)
       │    ├─ applyWordReplacement(text, "ai") → 动态词语替换
       │    ├─ convertNewXmlFormatToOld / normalizeImagesReply → 兼容与规范化
       │    ├─ 提取 <images>...</images> 容器（可多个，合并）
       │    ├─ /<image>([\s\S]*?)<\/image>/g 提取每个块
       │    │    └─ 块内解析：<imgthink> 思考块（可选）→ regex: 行；tag = 剩余内容（去 regex 行）
       │    │       tag 清洗：中文标点 → 半角，逗号后补空格
       │    └─ 输出 [{ regex, tag }]
       ├─ insertImagesIntoElement(el, images) → 按 regex 定位插入正文 DOM
       └─ 自动点击：zidongdianji=true 时批量触发后端生成
```

**LLM 输出契约（正文生图）**：

```
<image>
<imgthink>
对画面内容的思考（可选）
regex: 插入位置的正则匹配行
</imgthink>
<startTag>tag 串,1girl,long black hair,...<endTag>   ← 实际生图 prompt
</image>
```

- `regex:` 行决定插入位置；`startTag/endTag` 包裹的 tag 串是最终 NovelAI prompt；`tagthinkEcho=true` 时保留完整内容。

### 9.4 角色/服装生图链路（LLM_CHAR_DISPLAY → 角色照片）

```
角色管理窗口「生成照片 prompt」
  → showUserRequirementPopup2：弹窗输入要求（可带参考图）
  → handleImagePromptGenerate(userRequirement, userImages)
       ├─ getCurrentCharacterPreset → 当前角色预设（必须已选）
       ├─ buildCharacterText → 角色视觉文本（12 字段）
       ├─ buildOutfitsText → 服装文本
       ├─ triggerText = [userRequirement, 角色名, 服装名] 拼接
       ├─ 拼装完整消息（含角色/服装参考照片）
       └─ LLM_CHAR_DISPLAY(prompt) → 单次请求 → 回复写入 char_photo_prompt
            → 用户点击生图 → NovelAI 后端生成 → 存入 photoImageIds
```

**char_design（角色/服装设计）**：LLM 返回 12 字段 tag JSON → 填回角色详细参数表单 → 保存进角色预设。

### 9.5 支撑机制

| 机制 | 实现 | 说明 |
|---|---|---|
| 上下文预设 | test_context_profiles[name].entries[] | role + content + enabled + triggerMode(always/trigger) + triggerWords + andTriggerWords |
| API 档案 | llm_profiles[name] | api_url / api_key / model / temperature / top_p / max_tokens / stream / merge_system_user / send_images |
| 请求类型档案 | llm_request_type_profiles + llm_request_type_configs | 10 类型 × (api_profile + context_profile) 整体保存/读取 |
| 事件总线 | eventSource.emit/on | 所有 LLM 请求走事件解耦 |
| 任务队列 | taskQueue（TaskType.LLM） | 取消/重试/状态跟踪 |
| 日志 | addLog | 每次请求记录请求 ID、prompt、回复、重试 |
| 测试工具 | updateCombinedPrompt / getResultTextareaUpdater | 实时显示组合提示词 + AI 回复 |
| 图片插入 | insertImagesIntoElement | 按 regex 定位插入点 |

## 10. 文本处理能力（去重 / 敏感词替换 / Tag 锁定）

> 与「3. NovelAI 提示词替换」区分：prompt_replace 是**后端生成参数里的替换规则预设**；本节是**独立于后端的文本处理管线**，作用于正文与 LLM 回复。正则模块（regex.html）是酒馆提取正文的工具，**不移植**。

| 能力 | 实现函数 / 配置 | 行为要点 | 移植注意 |
|---|---|---|---|
| **Prompt 去重** | `deduplicateTags(tagString)` | 按逗号切分 → 逐 tag 取基础 tag（`getBaseTag` 剥离权重）→ Map 去重 → **保留加权版本**（`((tag))` 优先于 `tag`）；`$变量$` 先替换为占位符保护再处理；输出 `, ` 连接；去重时 addLog 记录 | 生成/编辑 tag 时自动去重，可服务端纯函数实现 |
| **敏感词替换（正文）** | `word_replacement_profiles[name].textReplacement`，默认规则：肉棒→🥒、小穴→🌸、乱伦→⚠️💘、色情→🔞、岁→🎄、小学→🏫 等 | `applyWordReplacement(text, "text")`：parseRules 逐行 `find=replace`，`escapeRegexChars` 后全局 replace | 正文过滤，合规用途；NeuroBook 可做成 Project 可编辑替换规则 |
| **敏感词替换（AI）** | 同档案 `aiReplacement`（默认 `sf_=sāfe&=`） | `applyWordReplacement(text, "ai")` 在 **parseImagesFromPrompt（LLM 回复解析时）** 先应用再解析 `<image>` 块 | LLM 回复清洗链的一环 |
| **Tag 锁定/解锁** | `lockTagForElement(el, tag)` / 解锁同函数 locked=false；`context.chat[id].extra.lockedTags` | 正文消息图片 tag 标记 `img.locked = true`；锁定后该 tag 在后续操作（重绘/修改）中被保护不丢失；锁定列表存 `extra.lockedTags` | 正文图片交互层（长按修改/双击重绘时保护 tag） |
| **正则模块** | `regex.html` 独立分页：正则配置预设 CRUD + 前后正则（切掉前后文）+ 文字正则（替换内容）+ 正则条目编辑器 + 正则测试模式 | `regexTestMode` 开启时展示最终 prompt 不发起 LLM 请求；`textToProcess.replace(filter.pattern, "")` 过滤 + `applyWordReplacement(text, "text")` 组合使用 | **不移植**：正则是酒馆中从聊天上下文提取正文的工具；NeuroBook 发送给 LLM 的只会是正文，无需提取管线 |

## 11. 已生成图片的后续操作（重绘 / 编辑 tag / 局部重绘）

> 作用于正文/聊天中已生成的图片，交互入口在 `imageInserter` 消息图片区。

| 能力 | 触发方式 | 实现函数 | 行为要点 | 移植注意 |
|---|---|---|---|---|
| **重 roll（重新生成）** | 双击图片（`dbclike` 开关） | `handleClick` 双击 → `triggerGeneration(button)` | 用原 tag 重新生成一张 | 历史/正文图片卡片加「重绘」按钮或双击，复用 queue reroll 语义 |
| **修改 tag 后重生成** | 长按图片 500ms（`longPressToEdit` 开关） | `showEditDialog` → `doSend()` | 编辑对话框改 tag → 新 tag 写 `button.dataset.change` → `_triggerGeneration2(button)` 重新生成 | 图片卡片「编辑 tag」按钮 → Dialog（复用词库补全）→ 新 job |
| **Tag 操作菜单** | 编辑对话框内 `...` 菜单 | 重置 / `lockTagForElement` / `deleteTagForElement` | 重置（清变更）、锁定/解锁（重绘保护该 tag）、删除 tag | Tag 锁定可选：Asset 加 lockedTags |
| **局部重绘（Inpaint）** | 编辑对话框「图像处理」→ NovelAI 局部重绘 | `showNovelAIInpaintDialog` → `generateNovelAIInpaint` | 画布涂抹 mask → 原图 + mask + prompt + strength（默认 0.54）+ negative（默认 `blurry, lowres, bad quality`）→ NAI inpaint 端点；标记 `{NovelAI局部重绘}` | NovelAI 原生支持；资产已存原图，可做画布涂抹 UI + 新 job kind `inpaint` |
| **翻译（编辑框内）** | 编辑对话框「翻译」按钮 | `translateButton` → LLM 翻译请求类型 | 中文 tag → 英文 | 复用 LLM 翻译请求类型 |
| **AI 分辨率** | 全局开关 `aiAutonomousResolution` | 从 tag 串/变更提取 `NNNxNNN` 覆盖默认尺寸 | — | 可选 |
| **单击预览** | `clickToPreview` 开关 | `_showImagePreview` | 大图预览 | — |

### 交互分层（消息图片区）

```
单击 → 预览（clickToPreview）
双击 → 重绘（dbclike）
长按 500ms → 编辑对话框（longPressToEdit）
```

### 编辑对话框细节（showEditDialog）

- textarea 预填当前 tag；**透明文字 + 彩色 backdrop 高亮 `$变量$` 占位符**（`updateBackdrop` 实时渲染）
- 词库自动补全：按逗号切分当前 tag，`searchTags` 下拉补全
- 翻译：`stripChineseAnnotations` 清洗 → LLM 翻译 → 回填
- 发送：新 tag → `dataset.change` → 触发生成；长按发送按钮弹尺寸选择（`showImageSizePopup`）

### tag 变更流转

```
长按 → 编辑对话框 → 发送
  → button.dataset.change = 新 tag（或加 {NovelAI局部重绘} 标记）
  → _triggerGeneration2(button) → generateNovelAIImage / generateNovelAIInpaint
  → 新图替换旧图
```

## 12. 用户 chatu8 上下文预设（LLM 输出契约参考）

> 用户导出的 4 个 `test_context_profiles` JSON 已复制到 `.agent/workspace/chatu8-presets/`（另含 5 个旧版）。这些是**实际调教过的 LLM 输出契约**，NeuroBook P2/P3 实现应直接采用。

### 12.1 预设结构

```json
{
  "预设名": {
    "entries": [
      { "id", "name", "role": "system|user|assistant", "content", "enabled": true,
        "triggerMode": "always|trigger", "triggerWords": "", "andTriggerWords": "" }
    ]
  }
}
```

运行时占位符：`{{正文}}` `{{上下文}}` `{{用户需求}}` `{{世界书触发}}` `{{角色启用列表}}` `{{通用角色启用列表}}` `{{通用服装启用列表}}`。
`triggerMode=trigger` 条目按 `triggerWords` 命中才注入（正文生图预设中为**体位 Tag 库**：后入/口交/足交/骑乘/肛交/69/群交等）。

### 12.2 正文生图输出格式（NAI正文变量生图 预设）

```xml
<content>
<images>
<image>
<regex>挂载点文本</regex>
<title_styled>[图片标题，5-15字中文]</title_styled>
<Tag_think>（关键视觉元素：谁/在哪/穿什么状态/在干嘛/镜头意图）</Tag_think>
<size>图像尺寸,推荐分辨率</size>
<prompts>[完整tag]</prompts>
</image>
（重复直到所有图片完成）
</images>
</content>
```

**角色/服装调用代码**（基因盲盒语义，调用后禁止重复写基础外貌/服装单品）：
```
${"name":"角色名", "angle":"视角", "upperBody":"nsfw/sfw/hidden", "lowerBody":"nsfw/sfw/hidden"}$
```
角色来源三路线：列表角色（调用模式）/ 原创角色（`姓名 (original)` + 公式 `1girl, 姓名 (original), 年龄, 发型, 发色...`）。

### 12.3 角色 tag 生成输出格式（小克角色和服装设计 / 修改 预设）

```xml
<角色设计>
<人物>
中文名称:xxx
英文名称:xxx
角色特征:innocent/seductive/cold...（仅绘图相关）
五官外貌:发型、发色、瞳色、脸型、肤色、年龄段（不包含表情！）
五官外貌背面:头发重复、后脑勺、脖子（不能写五官）
上半身SFW:穿衣可见轮廓
上半身SFW背面:肩膀、腰
下半身SFW:腿型
下半身SFW背面:臀部、腿背
上半身NSFW:胸部、乳头
上半身NSFW背面:背部、肩胛骨
下半身NSFW:生殖器
下半身NSFW背面:臀部、肛门
负面:bad anatomy...
</人物>
<服装>
中文名称:直观特点+年龄性别+用途分类（如"脏的男士工作服"）
英文名称:英文翻译
上半身:上半身服装tag
上半身背面:（正面装饰不能写）
下半身:下半身服装tag
下半身背面:（正面装饰不能写）
</服装>
</角色设计>
```

POV 规则：正背互斥、共有特征两面重复；SFW 禁裸露 tag（会破坏服装显示）、NSFW 单独调用；Tag 语法 `(tag)` 权重 / `(tag:1.5)` 精确 / 逗号分隔 / 空格连接复合词。

### 12.4 展示（照片 prompt）输出格式（小克角色_服装展示 预设）

```xml
<image>
<imgthink>什么类型/主体/精彩点/什么角度/上半身部位状态/下半身部位状态/角色信息/衣物信息</imgthink>
image###...完整tag...###
</image>
```

判断标准：穿内衣不算 nsfw，穿内衣内裤算 sfw。
