# 更新日志

这里只放当前版本。更早的版本见 [docs/changelog/](docs/changelog/)。

## 0.9.3-canary（限量 canary，已发布） - 2026-08-07

这一版收口了 Agent 停止、会话恢复、后台任务结果和 Source Dev 缓存的几个可靠性边界，也补上了配置中心窄屏布局和 Windows-first Desktop 壳实验。它已于 2026-08-07 以限量 canary 公开发布，tag 为 `v0.9.3-canary.20260807.175842Z.771ac42b`；真实 provider 和人工 Agent/Workflow 全流程仍未完全验证，因此不把它们写成全流程通过。

### 新功能

- 后台任务完成后，完整结果会保留下来；服务重启后仍可从任务中心查看已完成任务 (#79)。
- Windows-first Desktop Workbench 实验进入主线，提供共享标题栏、Activity Bar、Agent/IDE 切换和 Electron/Tauri Envelope 合同验证。它仍是 spike，不是正式安装器或最终框架选择 (#77)。

**文生图工作台**

现在可以从左侧进入文生图工作台，先配好 AI 和 NovelAI：支持连接后获取模型列表、流式生成、发送图片、上下文预设注入、运行时占位符和敏感词替换；NovelAI 这边可以管理模型与采样参数、固定提示词预设、翻译提示词、常用 Tag、提示词替换规则、氛围参考和配置档案。写正文时可以让 AI 标出配图位置并生成插图占位符，点卡片上的「生成图片」就会自动出图，图片会直接写回正文。出图任务在本机逐个处理，暂不接云端队列。

### 改进

- Source Dev 未指定缓存目录时使用 checkout 下的 `.agent/cache`，不再把图片变体默认写入仓库根 `cache/`；显式 `NEURO_BOOK_CACHE_ROOT` 仍优先 (#85)。
- 配置中心在手机宽度下改为上下布局，Profile 导航使用可横向滚动的紧凑标签；桌面布局保持不变 (#82)。
- retrieval 的固定文件枚举命令改为 Git Bash 安全的 `rg --files -g 'index.md'` 形式 (#69)。
- clean-runner 会先生成 Prisma/Nuxt 产物，并使用宿主临时绝对路径运行跨平台测试；Source Dev 依赖安装固定使用 hoisted linker (#83, #75)。
- 内部维护：跨平台 code baseline 修复与 clean-runner 测试预算调整 (#76, #84)。

### 修复

- 停止请求失败现在会给出用户可见提示；主动取消、运行错误和半截正文继续保持不同语义 (#78)。
- 主 Session 的恢复不再因关联 Agent Session 缺失而被误判为失效；同一连接上的自动 recovery 失败后不会无限重复 (#80)。
- Job 终态会先完成 durable 保存再发布；损坏的单个 Job 文件会隔离，仍待结果回流的 Job 不会被清除 (#79)。
- cover 路由首次冷导入测试不再因 Windows 机器的合理启动时间误报超时 (#86)。

### 升级须知

- 这是限量 canary。升级前请备份完整 State Root 和重要 Project Workspace 的 `.nbook/`、`project.yaml`；完整步骤见 [0.9.3-canary 迁移指南](docs/migrations/0.9.3-canary.md)。
- 本版本没有新的数据库 schema 迁移。旧 `jobs.jsonl` 只会把遗留 active Job 转为 `interrupted`，不能伪造旧 terminal result；新的 Job 历史位于 `<Workspace Root>/.nbook/agent/jobs/`。
- 重启后会保留已完成 Job 的结果，但不会续跑旧 Workflow，也不会持久化完整 Workflow 图、逐步时间线或 pending ask。
- Source Dev 旧的仓库根 `cache/image-variants` 不会自动迁移或删除；停服、确认没有自定义 Cache Root 后，再按迁移指南人工清理。
- 显式 Profile 模型覆盖不可用时，请恢复继承全局默认模型或选择已确认可用的模型；本版本不做静默 fallback。
- 本次公开发布对应 [GitHub Release](https://github.com/notnotype/neuro-book/releases/tag/v0.9.3-canary.20260807.175842Z.771ac42b)，Manager provenance 使用 `manager-v0.1.0-canary.52` 并已通过。真实 provider 和全量 Agent/Workflow 浏览器验收仍是限量 canary 的已知未完成项；签名安装器和最终 Desktop 选型不属于本次发布承诺。
