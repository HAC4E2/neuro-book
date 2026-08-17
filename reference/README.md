# NeuroBook Reference Bookshelf

`reference/` 是 NeuroBook 当前被产品 Agent/Profile 直接消费的稳定参考书架，给 Agent 和人类共同阅读。这里保存实现合同、目录协议、Profile 共享说明和内容系统规则；其当前规范归属由 [`../docs/specs/README.md`](../docs/specs/README.md) 登记。一次实现的 Task 与证据进入 `.agents/tasks/`，提案、调研和历史材料分别进入 `docs/proposals/`、`docs/research/` 和 `docs/archived/`。

## 冻结与迁移

根 `reference/` 是产品运行期过渡层：只允许修正当前实现错误，不新增顶层功能域或长期规范正文；新规范直接进入 `docs/specs/`。固定目标和状态见 [`../docs/specs/README.md`](../docs/specs/README.md)。

每个功能域迁移时，把当前规范移到固定目标、用户教程移到 `vitepress/`、失效材料移到 `docs/archived/reference/`，并在同一批更新 Profile Import、产品投影、合同测试、VitePress、CI 与打包入口；验证后删除旧域，不保留两份可独立修改的正文。

Project Workspace 内的 `{project}/reference/` 是用户导入素材协议，不属于本目录迁移范围。

不要把仓库根 `reference/` 和 Project Workspace 里的 `{project}/reference/` 混淆：

- 仓库根 `reference/`：系统参考书，可被 profile `<Import />` 加载。
- Project Workspace `{project}/reference/`：外部素材、导入归档、低置信迁移材料。

## Modules

- [agent/](agent/)：Agent runtime、profile、TSX DSL、Import、Run Kernel、Workflow、后台 Job、SSE 和默认协作协议。
- [agent/workflow/](agent/workflow/)：Agent Workflow 的选用、目录覆盖、编写 API、确定性与 `wf.chart` 状态图规范。
- [agent/skill-package.md](agent/skill-package.md)：Agent Skill package、版本、可移植路径、安装和依赖同步合同。
- [content/](content/)：Project Workspace 内容目录、lorebook、simulation、Subject RAG memory、information control、Markdown 方言、retrieval 和内容节点状态。
- [agent/profile-context-memory.md](agent/profile-context-memory.md)：profile context memory、generated recommendations 和 `.nbook/context-access` 边界。
- [plot/](plot/)：Project SQLite 剧情系统、Story / Phase / Thread / Scene 合同和 Agent 消费方式。Scene 是最小剧情单位，通过 World Anchor 连接 World Engine。
- [world-engine/](world-engine/)：World Engine 世界引擎——写作模式动态世界状态 + 时间线真相源。slice / subject / instant / reduce 模型、schema、记录原则、Calendar 和 leader/writer 协作。
- [NeuroBook 术语](../docs/specs/foundation/terminology.md)：Workspace Root、Project Workspace、user-assets、Agent、运行时与存储的标准术语。
- Markdown Studio 当前只有[用户文档](../vitepress/core/markdown-studio.md)和[历史工作台计划](../docs/archived/plan/06-editor-workbench.md)；内部规范缺口登记在 [`docs/specs/`](../docs/specs/) 中。
- [theme/](theme/)：主题系统规则。
- [media/image-variants.md](media/image-variants.md)：图片原图所有权、授权 Adapter、变体参数、有界缓存和 Project 封面合同。

## Reading Order

- 修改 Agent profile 或 prompt：先读 [agent/README.md](agent/README.md)。
- 创建或更新 runnable Skill、版本和依赖同步：读 [agent/skill-package.md](agent/skill-package.md)。
- 编写或运行 Agent Workflow：先读 [agent/workflow/README.md](agent/workflow/README.md)，再按需读 [authoring](agent/workflow/authoring.md) 与 [`wf.chart` 规范](agent/workflow/chart.md)。
- 处理 Project Workspace 文件、lorebook、simulation 或导入素材：先读 [agent/project-workspace-guide.md](agent/project-workspace-guide.md) 和 [content/README.md](content/README.md)。
- 处理 subject 长期记忆、`events.jsonl` / `memory.jsonl` 或 `subject_rag_search`：读 [content/subject-rag-memory.md](content/subject-rag-memory.md)。
- 处理小说写作标准流程、World Engine 剧情推进、writer handoff 或写作 skill 三层体系（novel-guide / novel-setup / novel-writing）：读 [agent/novel-writing-workflow.md](agent/novel-writing-workflow.md)。只有处理 legacy RP / simulation 时才继续看 emulation tick 资料（skill 本体已归档到 `docs/archived/skills/`）。
- 处理 RP Tick 交互协议、LOD 世界模拟、actor-facing packet 格式或 Writer Brief 格式：读 [agent/rp-tick/README.md](agent/rp-tick/README.md)。
- 处理旧 Plot 系统、历史剧情结构或 Plot 工具维护：先读 [plot/system.md](plot/system.md)。Plot System 负责剧情结构（Story / Thread / Scene / Chapter Plot）；动态世界状态走 World Engine。
- 处理写作模式世界状态、时间线、subject、切面、reduce 或 leader/writer 协作：先读 [world-engine/README.md](world-engine/README.md)。
- 处理 workspace / project / user-assets 术语：先读 [NeuroBook 术语](../docs/specs/foundation/terminology.md)。
- 处理图片缩略图、原图预览、Project 封面或 `sharp` Product 合同时：读 [media/image-variants.md](media/image-variants.md)。
