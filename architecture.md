# Architecture Notes

当前项目的专题规范按模块放在 `spec/`，日常文档、调研、草案、任务 walkthrough 放在 `docs/`。仓库级进度和风险统一记录在 `PROJECT-STATUS.md`。

## 主要入口

- [PROJECT-STATUS.md](PROJECT-STATUS.md)：仓库现状、当前重点、模块状态和近期任务。
- [docs/README.md](docs/README.md)：文档体系入口。
- [spec/README.md](spec/README.md)：稳定规范索引。

## 核心模块规范

- [spec/agent/](spec/agent/)：多 Agent、Profile、上下文和前端运行状态。
- [spec/editor/](spec/editor/)：Markdown Studio 与富文本 live preview 规范。
- [spec/plot/](spec/plot/)：剧情系统和前端工作区规范。
- [spec/reference/](spec/reference/)：统一引用系统和 inline 引用规范。
- [spec/content/](spec/content/)：内容校验与规范化流程。
- [spec/theme/](spec/theme/)：主题系统规范。
