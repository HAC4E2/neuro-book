# Task Agent 指令

Task 的目录用途、真相源分工、目录结构、frontmatter、状态和人类工作流统一见 [`README.md`](README.md)。本文件只补充 Agent 执行动作：

- 创建或推进 Task 前，读取 `README.md`、当前规范、相关 Proposal/ADR、目标 Task `README.md` 和 `context.md`；缺少规范归属的新功能不能进入实现状态。
- 严格使用 `README.md` 定义的目录、frontmatter 和状态，不创建第二套字段、文件名或证据目录。
- 历史迁移 Task 保留原编号、目录名和正文；除当前用户明确授权的目标 Task 外，不批量规范化历史内容或修复其中的旧路径。
- 过程更新追加独立 walkthrough，不覆盖已有报告；阻塞、范围变化和未运行验证必须写入本次报告。
- 正式证据进入目标 Task 的 `evidences/`，写入前脱敏；运行数据留在根 `AGENTS.md` 定义的系统临时根。
- 完成前核对代码、测试和当前规范一致，并确认 Issue/Project 字段没有复制进 Task。
