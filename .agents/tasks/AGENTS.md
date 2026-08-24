# Task Agent 指令

Task 的目录用途、真相源分工、目录结构、frontmatter、状态和人类工作流统一见 [`README.md`](README.md)。本文件只补充 Agent 执行动作：

- 创建或推进 Task 前，读取 `README.md`、相关 `planned` / `implemented` Spec、Proposal/ADR、目标 Task `README.md` 和 `context.md`；缺少 capability 或黑盒合同的新功能不能开始写代码。
- 严格使用 `README.md` 定义的目录、frontmatter 和状态，不创建第二套字段、文件名或证据目录。
- Proposal accepted 后新建或重新打开 Task 时，Leader 必须填写 `agentWorkflow`；Tasker 开始前读取 `.agents/skills/load_role/SKILL.md` 并按参数加载指定角色合同，再按画像建立验证回路；`verification.required` 是必须闭合的检查，`verification.notRun` 只记录建立时明确不属于门槛且有具体原因的检查。为每个 `verification.notRun` 保留具体授权或环境原因；历史 Task 可暂不补写，除非重新打开或继续执行。
- 历史迁移 Task 保留原编号、目录名和正文；除当前用户明确授权的目标 Task 外，不批量规范化历史内容或修复其中的旧路径。
- 过程更新追加独立 walkthrough，不覆盖已有报告；阻塞、范围变化和未运行验证必须写入本次报告。
- 正式证据进入目标 Task 的 `evidences/`，写入前脱敏；运行数据留在根 `AGENTS.md` 定义的系统临时根。
- 双根 Task 先查 `.agents/tasks/ownership.json`；登记项只从 `packages/neuro-book/.agents/tasks/` 读取，未登记项只从根读取，禁止候选路径 fallback。
- 完成前核对代码、测试、smoke 与 Spec 一致；新能力的原 Spec 已从 `planned` 晋升为 `implemented`，并确认 Issue/Project 字段没有复制进 Task。
