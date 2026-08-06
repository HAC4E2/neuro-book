# P0 基础设施盘点与迁移基线

> 本文件是 Task 142 的 P0 产出，结论服务于 `README.md` 的 P1–P4 实施。

## 1. 版本与规模

- 线上 st-chatu8：`2.8.1`。
- 参考分支（`C:\Users\admir\Desktop\Pi\neuro-book`）：`server/text-to-image` 187 文件 / 约 3.96 万行；`server/api/text-to-image` 53 文件 / 约 2.17 千行；shared 文生图相关 52 文件 / 约 9.43 千行；app 文生图相关 18 文件 / 约 5.21 千行。
- 当前干净仓库：无 `server/text-to-image/`、`app/components/novel-ide/text-to-image/`、文生图 schema 模型。

## 2. 可迁移文件清单

| 文件 | 参考分支路径 | 决策 | 说明 |
|---|---|---|---|
| 凭据密封/打开 | `server/text-to-image/provider-credential.ts` | 迁入 | AES-256-GCM；主密钥在 Workspace Root `secrets/text-to-image.key` |
| URL 策略 | `server/text-to-image/provider-url-policy.ts` | 迁入 | 拒绝私网/内网、凭据 URL、HTTPS 降级 |
| 安全出站 fetch | `server/text-to-image/provider-fetch.ts` | 迁入 | undici dispatcher + DNS 校验 + 重定向策略 |
| NovelAI 生图 | `server/text-to-image/novelai-image-generation.ts` | 迁入/改造 | 需要按本仓库 Provider/Job 简化参数适配 |
| Provider 服务 | `server/text-to-image/provider.service.ts` | 改造 | 参考分支含 reconciliation/lane，首版只保留 Provider CRUD + 凭据密封 + openai_compatible 支持 |
| 队列服务 | `server/text-to-image/queue.service.ts` | 改造 | 首版简化：Job 先落库 + 进程内串行本地队列；云端队列及 DispatchPreparation/Lane/Throttle saga 不迁移 |
| 资产服务 | `server/text-to-image/asset.service.ts` + `asset-path.ts` | 迁入/改造 | 文件与 Project DB 记录成对维护 |
| 章节写回 | `server/text-to-image/chapter.service.ts` | 迁入/改造 | 依赖 tracked write + Workspace History |
| L2 占位符 | `shared/text-to-image-markdown.ts` | 迁入 | render/parse/find；schema `nbook.text-to-image-prompt/v2` |
| TipTap Node | `app/components/markdown-studio/tiptap/TextToImagePrompt.ts` | 迁入/改造 | 对齐当前 `WorkspaceReference` 扩展注册方式 |
| 历史图片 | `app/components/novel-ide/text-to-image/TextToImageHistoryWorkspace.vue` | 迁入/改造 | 首版先做网格 + 分页 + 筛选 |
| Project Prisma 客户端 | `server/text-to-image/project-client.ts` + `project-client-module.ts` | 改造 | 适配当前 Project Session 的 module token |
| 参考资产/Vibe | `server/text-to-image/reference-asset.service.ts`、`vibe-encoding.service.ts` 等 | 部分迁入 | 首版先做参考图上传/预览/角色组；Vibe 文件生成器可后续接通 |

## 3. NovelAI 全量能力清单

| 能力 | 来源 | 首版决策 |
|---|---|---|
| Provider 密钥显隐 / 官网或第三方站点 | `novelai.html` | 迁入 |
| 配置档案 CRUD | `novelai.html` | 迁入 |
| 模型 / 采样器 / 噪点表 / Guidance / Rescale | `novelai.html` | 迁入 |
| AI 默认角色位置 | `novelai.html` | 迁入 |
| SMEA / SMEA DYN / Variety / Decrisp | `novelai.html` | 迁入 |
| 尺寸预设 + 宽高 / steps / seed | `novelai.html` | 迁入 |
| 固定提示词：前置/后置/负面 + token 统计 + 可视化选择 + 翻译 + tag 自动补全 | `novelai.html` | 迁入 |
| 提示词替换：多触发词 + if 条件 | `novelai.html` | 迁入 |
| 质量预设 AQT/UCP + 福瑞数据集 | `novelai.html` | 迁入 |
| Vibe Transfer（单图） | `novelai.html` | 迁入 |
| 角色参考图 + 角色组编辑（最多 4 角色） | `novelai.html` | 迁入 |
| Vibe 文件生成器（`.naiv4vibe`） | `novelai.html` | 迁入 |
| Vibe 组 / 随机 Vibe 组 / normalizeRefStrength | `novelai.html` | 迁入 |
| 云端队列 | `novelai.html` | **不移植**，只保留本地队列语义 |

## 4. LLM 执行链路清单

| 能力 | 来源 | 首版决策 |
|---|---|---|
| API 档案 CRUD + 导入导出 | `llm.html` | 迁入 |
| Base URL / API Key 显隐 / 连接并获取模型 | `llm.html` | 迁入 |
| 流式生成（SSE）与非流式 | `llm.html` | 迁入 |
| 发送图片（多模态） | `llm.html` | 迁入 |
| 合并 System/User | `llm.html` | 迁入 |
| 错误重试（0–5，间隔 2s） | `llm.html` | 迁入 |
| 上下文预设条目：role/content/enabled/triggerMode/triggerWords/andTriggerWords | `llm.html` | 迁入 |
| 上下文预设另存为 / 导入 / 导出全部 | `llm.html` | 迁入 |
| 上下文历史层数（0–20） | `llm.html` | 迁入 |
| Tagthink 回显 | `llm.html` | 迁入 |
| 历史正文保留 `<image>` 标签 | `llm.html` | 迁入 |
| 请求类型档案 + 请求类型绑定 | `llm.html` | 迁入，首版 5 类 |
| 运行时占位符：`{{正文}}` 等 + 骰子 + `{@getvar::...@}` 变量 | `index.js` | 迁入 |
| 敏感词替换 `textReplacement` / `aiReplacement` | `index.js` | **必须迁移**；正则模块不移植 |

## 5. Schema Diff

### 5.1 App SQLite（`prisma/schema.sqlite.prisma`）

当前仓库只有 `User`、`DatabaseLock`、`PassportCredential`。首版新增：

- `TextToImageProvider`：`kind`（`novelai` / `openai_compatible`）、`name`、`baseUrl`、`model`、`credentialCiphertext/iv/tag`、`credentialRevision`、`settings`。
- 参考分支另有 Reconciliation / DispatchPreparation / ProviderLaneItem / Throttle / RevisionInvalidation；这些云端队列相关模型明确不迁移，简化成单 Provider CRUD。

迁移来源：`prisma/migrations/sqlite/20260710...text_to_image_providers` 等，按当前仓库 migration 时间线生成新 migration，不复制旧目录。

### 5.2 Project SQLite（`prisma/project.schema.prisma` + `project-workspace.ts`）

当前仓库已有 Story/World 等模型，没有文生图模型。首版新增：

- `TextToImageJob`：kind/status/sourcePath/sourceAnchorId/sourceInsertStatus/requestJson/errorMessage/attemptCount。
- `TextToImageAsset`：relativePath/fileName/mimeType/byteLength/width/height/model/seed/prompt/negativePrompt/sourceKind/sourcePath/sourceAnchorId/contentHash。
- `TextToImageReferenceAsset`：参考图/Vibe 文件存储记录（首版角色参考图需要）。

参考分支另有 VibeEncoding/ReferencePromotion/ExecutionManifest/DispatchOutbox/PlanningWorkflow；云端队列模型（DispatchOutbox 等）明确不迁移，本地 Job/Asset 承担队列语义。

Project SQLite 初始化目前是 `server/workspace-files/project-workspace.ts` 的幂等 DDL 字符串，不是 Prisma migration；新增表必须同时进入 `PROJECT_MIGRATION_SQL` 与 schema。

## 6. 配置与凭据边界

- 非敏感配置：`StoredGlobalConfig.textToImage`，落 Workspace Root `.nbook/config.json`。
- Provider 记录与 AES-GCM 密文凭据：App SQLite `TextToImageProvider`。
- AES-GCM 主密钥：Workspace Root `secrets/text-to-image.key`（参考分支范式）。
- 前端配置读写：扩展现有 `GlobalConfigDtoSchema` / `GlobalConfigUpdateDtoSchema` / `saveGlobalConfig`，不复写 localStorage。

## 7. 测试适配清单

- 参考分支测试依赖其 App/Project schema、config、project-client module；直接复制会失败。
- 需要新写的测试：
  - `text-to-image.dto.test.ts`：DTO schema。
  - `provider-credential.test.ts`：密封/打开/损坏密文。
  - `provider-url-policy.test.ts`、`provider-fetch.test.ts`：URL/DNS/重定向。
  - `text-to-image-markdown.test.ts`：L2 占位符。
  - `character-visual.codec.test.ts`、`body-image-llm.test.ts`、`sensitive-word-replacement.test.ts`。
  - `queue.service.test.ts`：Job 状态机、资产保存、失败重试。
- 需要删除/不迁的测试：illustration.director、Agent workflow、reconciliation、planning 相关。

## 8. 首版简化与风险

- 不移植：SD / ComfyUI / Banana / 云端队列 / 智绘姬助手 / 悬浮球 / 资料库 / 发送数据 / 主题设置 / 正则模块。
- 队列首版不做跨 Project saga，失败/取消在单 Project 内闭环。
- Vibe/角色参考首版以文件 + JSON 记录为主，DB 只保留 ReferenceAsset 基础记录。
- 最大风险：参考分支与当前仓库的 Project Session / Prisma 生成结构不同，provider 与 queue 的端口需要逐层适配并保持测试 GREEN。
