# Agent Reference

本目录保存 Agent runtime、profile、上下文、默认协作协议和前端事件相关的稳定参考。任务 walkthrough 和历史迁移记录只作为背景材料。

## Profile And Prompt

- [profile-guide.md](profile-guide.md)：Profile 作者和 Agent 修改 profile 时的主入口。
- [context.md](context.md)：TSX Profile DSL 的上下文分区、历史写入和模型可见顺序。
- [profile-import.md](profile-import.md)：`<Import />` 节点 API、安全边界、渲染格式和 build contract。
- [profile-compiled-artifacts.md](profile-compiled-artifacts.md)：profile `.compiled/` 内容寻址 artifact、manifest、Publisher 和状态机契约。
- [profile-routing.md](profile-routing.md)：入口 leader 和专用 profile 的职责地图，说明任务错位时应建议用户切换到哪个 agent。
- [leader-default.md](leader-default.md)：`leader.default` 工具、任务、多 Agent、SQL、Plan Mode 和 Skills 操作协议。
- [project-workspace-guide.md](project-workspace-guide.md)：Agent 使用 Project Workspace 文件工具的短指南，覆盖路径、基础内容节点和常用目录。
- [novel-writing-workflow.md](novel-writing-workflow.md)：写作模式标准流程、emulation 使用边界、小说 workflow skill 分层和 runs 产物建议。
- [skill-package.md](skill-package.md)：Skill package、SemVer、portable root、首次安装与依赖失效合同。
- [rp-tick/](rp-tick/)：RP Tick 完整交互协议。覆盖 Tick 生命周期（5 Phase）、LOD 世界模拟系统、actor-facing packet 标签规范、Writer Brief 剧本格式。各文件可被 profile 按需 Import。

## Runtime

- [runtime-hooks.md](runtime-hooks.md)：Run Kernel / runtime hooks 稳定心智模型，覆盖 harness、session、profile、turn loop 的生命周期阶段。
- [../../docs/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md](../../docs/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md)：prompt / continue / steer / followup 的外部行为合同。
- [attachments.md](attachments.md)：Session 图片附件的存储、Markdown、授权、目录、Composer 与模型预算合同。
- [sse.md](sse.md)：Agent session SSE / snapshot / event contract。
- [pi-trace-observability.md](pi-trace-observability.md)：Pi 请求 trace 的存储布局、隐私边界、统一入口约束与抽库 runbook。
- [workflow/](workflow/README.md)：Agent Workflow 参考入口：选用边界、目录覆盖、`run_workflow` 契约与内置库。
- [workflow/authoring.md](workflow/authoring.md)：workflow 定义、参数、agent 调用、并发、返回值与确定性约束。
- [workflow/chart.md](workflow/chart.md)：`wf.chart` 状态图 API、扇出/汇合/循环构图规范与好坏示例。

## Reading Rules

- 实现或修改 profile：先读 [profile-guide.md](profile-guide.md)，再读 [context.md](context.md)、[profile-import.md](profile-import.md) 和 [profile-compiled-artifacts.md](profile-compiled-artifacts.md)。
- 处理 profile 职责边界、用户用错 agent 或入口切换建议：读 [profile-routing.md](profile-routing.md)。
- 处理默认 Leader prompt、工具、writer / retrieval / researcher、Plan Mode 或 Skills：读 [leader-default.md](leader-default.md)。
- 创建或更新 runnable Skill、版本、依赖、vendored snapshot 或 user-assets 同步：读 [skill-package.md](skill-package.md)。
- 处理 Project Workspace 文件、内容节点、lorebook、manuscript 或 simulation：先读 [project-workspace-guide.md](project-workspace-guide.md)，需要完整目录协议时读 [../content/project-structure.md](../content/project-structure.md)。
- 处理 Plot System：读 [../plot/system.md](../plot/system.md) 和 [../plot/agent-spec.md](../plot/agent-spec.md)。
- 处理小说写作流程、剧情推进、emulation tick 或 workflow skill 命名：读 [novel-writing-workflow.md](novel-writing-workflow.md)。
- 处理 RP Tick 交互协议、LOD 世界模拟、actor-facing packet 格式或 Writer Brief 格式：读 [rp-tick/README.md](rp-tick/README.md)。
- 处理 harness 行为、runtime hooks 或队列语义：先读 [HARNESS-BLACK-BOX-CONTRACT.md](../../docs/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md)，再读 [runtime-hooks.md](runtime-hooks.md)。
- 处理图片上传、Session 附件目录、Composer 图片 Markdown 或附件读取授权：读 [attachments.md](attachments.md)。
- 编写、运行或排查 Agent Workflow：先读 [workflow/README.md](workflow/README.md)，写源码继续读 [workflow/authoring.md](workflow/authoring.md)，画运行图继续读 [workflow/chart.md](workflow/chart.md)。
