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

- 开发者对第一轮的决定：
  1. 首页选 B（左栏导航加主区两栏），以后有需要可以再开三栏。
  2. 导航里 Work 与 Task 是层级关系（Work 下展开 Task）；另加 GitHub 的 Issue 与 PR。
  3. “讲解页”这个概念要重新分类：先想清楚开发者经常要看哪些东西（Spec、Docs 等项目文档；审查结果；UI 设计稿、讲解，类似 Artifact），再定导航与页面类型。主 Agent 的分类提议交开发者确认。
- 范围扩大：Agent 会话挂进面板（替代另开终端）、局域网访问、面板直接给会话发消息，见 [需求分析第九节](../t01-requirements/requirements.md#九范围扩大开发者-2026-10-12-提出)。会话托管的做法另派子代理调研。
- t80（设置界面）作为第一个验证对象：它的 Spec 晋升暂缓，以后经面板决定。
- 开发者再定（2026-10-12）：
  4. **会话**：面板只做 herdr 的网页前端，会话由 herdr 后端托管，面板依赖 herdr。
  5. **内容分类与导航**按主 Agent 的提议：收件箱（只放要开发者动手的条目，指向下面各类）、工作（Work › Task，Task 页是聚合页）、产物（Agent 交来的：设计稿、讲解与报告、审查、证据；“提问”是任何产物上都能挂的东西，挂了未答的才进收件箱）、文档（Spec、ADR、Proposal、规范与测试规范、Skill、AGENTS、用户文档，默认看 master）、现场（会话、在跑、代码、GitHub 的 Issue 与 PR）。左栏按“首页与收件箱、工作、产物、文档、现场”分组。
  6. **需求补充分析里的待定项**按主 Agent 的推荐确认：产物页第一版只做 HTML（Vue 与 nb-ui 等 w00017 合入后）；worktree 一个 Task 一个（改规则）；Task 号允许三位（t100 起，改治理检查的正则）；omp 会话目录放 `.local/agent/…/reports/`（改用户全局规则里那句）；执行位置以 Work README 为准，登记表的 `home` 只当提示；新增本地目录 `run/`、`logs/`、`review/.pages/`、`panel.json`；核心放 `packages/dev-panel` 并加编号规则一致性测试；命令名 `nbdev`，装用户级入口；以及小项（`dev stop` 默认不停别人的、同 checkout 复用开发服务、未检出分支默认不显示、“治理文件落后 master”放第二版、允许 Agent 代录口头答复并标明、纯讲解页无“已看”、只支持 Linux、`.local/agent` 不自动清理、`shot` 薄包装、用户区不动、编号规则随命令行同提交切换）。受范围扩大影响、等会话托管调研再定的：通知方式（面板经 herdr 直接通知会话）、面板是否常驻、产物页放第二个来源。
- 第二轮静态稿完成（评审板最上面一节，数据 16:01）：首页（分组导航、Work › Task 树、收件箱四类、会话）、会话页（真实的只读终端输出、发消息与“空闲时再发”）、回复后通知会话的小窗、产物页（四类，问题挂在旁边）、文档页（切换 checkout）、GitHub（PR 与 Issue）。主 Agent 已在六个待定问题上写推荐。画稿发现 14 条需求问题（会话相关为主：会话属于哪个 Work 拿不到、herdr 读不出“问完停下”、输入框里没发出的话读不出、排队要面板常驻等）。
- 会话托管调研完成：[session-hosting-research.md](session-hosting-research.md)。只用 herdr 现有接口第一版的四件事都能做：看终端用 `herdr terminal session observe` 的实时流，发消息用 `agent.prompt`，按会话 id 核对身份、等空闲再发；herdr 的 socket 没有鉴权，局域网开放等于远程 shell，第一版只绑回环、跨设备走 Tailscale Serve 或 SSH 隧道，设备配对登录，产物页放另一个来源。

## 下一步

开发者看第一轮静态稿；需求深化的结论并入需求分析后，写 Proposal 与实施计划。
