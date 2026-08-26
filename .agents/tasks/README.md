# Agent Tasks

这里保存 NeuroBook 开发 Agent 的任务合同、角色交接和正式证据。Task 记录一次实现，不承担产品规范；能力合同和成熟度从 [`../../docs/specs/`](../../docs/specs/) 进入。

## 真相源分工

- GitHub Issue：公开反馈、需求、决策去向和实现授权。
- GitHub Project：优先级、迭代、负责人和交付状态。
- `docs/specs/`：`planned` 目标合同与 `implemented` 当前合同的唯一真相源。
- `docs/proposals/`：把原始需求整理成待决策方案；accepted 后沉淀为 `planned` Spec。
- `.agents/tasks/<task>/README.md`：一次实现任务的执行合同。
- `.agents/tasks/<task>/walkthroughs/`：PM、Leader、Tasker、Reviewer 的追加式过程报告。
- `.agents/tasks/<task>/evidences/`：可被报告引用的截图、日志、JSON 和发布产物。

Task 不复制 Issue 的 `module`、`priority`、labels 或 iteration；变化只在 Issue / Project 更新。

## 目录结构

```text
.agents/tasks/
├── AGENTS.md
├── README.md
├── ownership.json
└── 00000-task-title/
    ├── README.md
    ├── context.md
    ├── evidences/
    └── 00000-role-YYYY-MM-DD_HH-mm-title.md

packages/neuro-book/.agents/tasks/
└── <ownership.json 登记的应用 Task 目录>

根 `.agents/tasks/ownership.json` 是双根 owner 选择的唯一索引：登记的稳定 Task 名解析到应用包 root，未登记 Task 解析到根 root；解析器不得按候选路径 fallback。

## Task README

新任务 README 使用最小 frontmatter：

```yaml
---
schema: nbook.task/v1
taskId: 00149-example
actionIssueId: 123
worktreeId: null
branchId: null
status: planned
createdAt: 2026-08-15T00:00:00Z
updatedAt: 2026-08-15T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: bug
  routes:
    - diagnosing-bugs
    - test-driven-development
    - code-review-and-quality
  verification:
    required:
      - regression-test
      - focused-test
      - diff-check
    notRun:
      - check: browser
        reason: 未获浏览器人工验收授权
---
```

- `taskId`：任务目录的稳定身份。
- `actionIssueId`：获准执行的 GitHub Issue 编号，没有时为 `null`。
- `worktreeId`、`branchId`：实现 worktree 和分支身份，没有时为 `null`。
- `status`：`draft`、`planned`、`in-progress`、`blocked`、`verifying`、`completed` 或 `abandoned`。
- `createdAt`、`updatedAt`：任务记录时间。
- `agentWorkflow`：Proposal accepted 后新建或重新打开 Task 的工作法与验证画像；历史 Task 可以暂不包含该字段。
- `agentWorkflow.profile`：必须为 `nbook.agent-skills/v1`。
- `agentWorkflow.kind`：只能是 `feedback`、`bug`、`feature`、`refactor`、`docs`、`release`、`migration`。
- `agentWorkflow.routes`：非空、无重复的 Skill kebab-case 名称列表，记录本任务采用的最小充分路由。
- `agentWorkflow.verification.required`：非空、无重复的必须完成检查；允许 `focused-test`、`regression-test`、`typecheck`、`build`、`diff-check`、`smoke`、`browser`、`security-review`、`performance-baseline`、`release-check`、`docs-check`、`governance-check`。
- `agentWorkflow.verification.notRun`：字段必须存在且为数组，数组可为空；每项必须有 `check` 和非空 `reason`，且不得与 `required` 重叠。

Task README 只记录执行合同；实际命令、结果、revision、环境、截图、日志和正式产物仍写入追加式 walkthrough / evidence。Task 不复制 Issue / Project 的 `module`、`priority`、labels 或 iteration。

Task 状态只描述本次执行记录，不替代 Issue 或 Project 状态；Task `completed` 也不能触发对应 Issue 项目条目的 Project `Done`。Project 的交付状态和统一评审门禁以 [`docs/standards/repository-workflow.md#project-交付状态与统一评审`](../../docs/standards/repository-workflow.md#project-交付状态与统一评审) 为准。

## Context、Walkthrough 与 Evidence

- `context.md` 是 Leader 在人类批准后生成的当前任务快照，记录生成时间和基线 revision；计划变化后重新生成，不成为新的项目真相源。
- 每个角色写独立、追加式 walkthrough，不覆盖已有报告。文件名使用 `<sequence>-<role>-<YYYY-MM-DD_HH-mm>-<title>.md`，frontmatter 至少记录 `schema`、`taskId`、`sequence`、`role`、`status` 和 `createdAt`。
- 正式脱敏产物进入 `evidences/`，报告使用相对链接引用。运行数据与敏感内容遵守根 `AGENTS.md` 的临时根和秘密规则。

## 新建任务

1. 人类批准 Issue 的目标、范围和验收条件；有产品歧义或长期取舍时先完成 Proposal/ADR 决策。
2. Leader 在 `docs/specs/README.md` 找到 capability。新能力创建单一 `planned` Spec；已有行为读取 `implemented` Spec；code-first 修复也必须在 Task 完成前补齐 Spec。
3. Leader 检查任务编号并创建五位编号目录：`00000-kebab-case-title/`。
4. Leader 创建带 frontmatter 的 README，记录 `taskId`、`actionIssueId`、`worktreeId`、`branchId` 和 `status`，并链接具体 Spec 与相关 Proposal/ADR。
5. Leader 生成当前 `context.md`。
6. Tasker 读取角色规则、Spec、任务 README 和 context 后开始实现；Spec 不够明确时先补合同，不在代码中发明行为。
7. 每个角色写独立 walkthrough；Reviewer 核对实现、测试、smoke 与 Spec 一致。全部合同有证据后，原 Spec 晋升为 `implemented`，再提交人类合并决策；Task 可以在技术交付闭合后置为 `completed`，但 PR 合并后对应 Issue 项目条目仍保持 `In review`，直到开发者针对该 Issue 和当前 merge revision 明确确认统一评审通过。

### 开发者请求与 Agent 恢复

开发者通常只给出想要的结果、已知约束和授权范围；Agent 按请求类型反应：

- 小文档或机械改动：先读根规则、最近作用域规则和相关 Spec；确认行为合同未变后做最小改动，报告实际 diff、已运行验证和未运行项。
- 非平凡需求：先读 Issue/授权来源、Spec、角色合同、本文件和已有 Task；缺少授权、预期行为或验收条件时，先输出诊断与待决问题，不写代码。
- 继续已有 Task：先读 Task README、`context.md`、最新 walkthrough/evidence、引用的 Spec 和当前 diff；基线一致时从最后已验证状态继续，发现缺失或矛盾时写阻塞，不凭记忆补全。
- 指定单一角色：只执行该角色的输入、输出和停止条件；Reviewer 不改代码，任何角色不自动合并、发布或部署。

上述交接是文档清单、Agent 自检和追加式证据，不是可执行引擎；静态治理检查只证明实际字段结构，不证明 Agent 理解产品意图或完成了运行时验证。

## 历史任务

本目录迁移自旧的 `docs/tasks/`。历史任务保留原编号、目录名和内容，不为了迁移批量改写正文；旧目录入口在迁移提交中删除。新旧路径迁移由专门的治理脚本、清单 hash 和链接检查负责。
