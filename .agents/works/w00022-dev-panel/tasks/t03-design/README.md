---
schema: nbook.task/v2
taskId: t03-design
---

# 面板与命令行的设计

## 目标与范围

按 [`design-review`](../../../../skills/design-review/SKILL.md) 流程设计开发者项目面板（网页）与 Agent 用的命令行，依据 [t01 的需求分析](../t01-requirements/requirements.md)。先出静态稿与讲解页组件的样子，开发者确认后写 Proposal 与实施计划。只写文档与本地草稿，不写产品代码。

行为合同未变：面板不是产品功能，不改 Spec；方案定了以后写 Proposal。

## 当前状态

- 2026-10-12 开工。首页注意力排序按主 Agent 的提议进入静态稿（开发者说“可以进入 t03”）：
  1. 等开发者处理的事：没答复的讲解页、待定的决定、待批准的回写建议、审查报告里没处理的条目；
  2. 进行中的 Task：在哪个 worktree 与分支、最后一次动静、相对主线领先落后、有没有未提交文件；
  3. 正在跑的东西：开发服务、omp、子代理（第一版只显示数量与入口）；
  4. 最近的变化：新提交、新报告、新讲解页；
  5. 搜索框一直在顶部。
- 第一轮静态稿完成：本机评审板 `.local/agent/works/w00022-dev-panel/tasks/t03-design/review/index.html`，直接是 HTML（首页 A、B 两个候选，Task 页以 t80 为例，讲解页的 7 个组件，命令行三个命令的文字与 JSON 输出），数据是本机 13:40 的真实快照，样式由 `review/build.ts` 从 nb-ui 源码拼出 `tokens-nbook.css`。主 Agent 已在五个待定问题上写了推荐（首页选 B）。画稿时发现 11 条需求问题，写在评审板“画稿时发现的需求问题”一节，多数已在需求补充分析里有对应的待定项。
- 需求深化完成：[analysis-supplement.md](../t01-requirements/analysis-supplement.md)，主 Agent 抽查后入库；其中待开发者决定的问题，主 Agent 整理成 12 条加若干小项交开发者。

## 下一步

开发者看第一轮静态稿；需求深化的结论并入需求分析后，写 Proposal 与实施计划。
