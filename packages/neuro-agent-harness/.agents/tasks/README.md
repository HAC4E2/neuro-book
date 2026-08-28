# NeuroAgentHarness 任务导航

本目录保存真实执行过或当前正在执行的 Harness Task。Issue #193 的未确定未来步骤位于 [`../../docs/issue-193-roadmap.md`](../../docs/issue-193-roadmap.md)，路线图不是 Task 合同，Tasker不得执行。

## 当前状态

- [`01-harness-decoupling`](01-harness-decoupling/README.md)：历史项目演进记录，无 `nbook.task/v1` frontmatter，按导入历史只读。
- [`02-product-host-success-research`](02-product-host-success-research/README.md)：Issue #193 当前唯一活动 Task，`in-progress`。来源证据和三类宿主画像已就绪，当前停止在开发者独立观察。
- 后续没有已创建 Task。Task 02 满足 `Leader 继续条件` 后，新 Leader 才能根据真实结果更新路线图并创建唯一下一 `planned` Task。

## Task 与路线图区别

- Task README 是一次派发合同，包含 Agent 工作、开发者参与、任务产物、修改计划、完成门禁、Leader继续条件和允许文件。
- 路线图只保存候选阶段、上游触发和新 Leader 复核点，没有 Task ID、状态、owner、允许文件或授权。
- 不预建依赖未知结果的 Task 链，不从路线图恢复已删除的 03–11 草案。

## 当前人机协作

Task由Agent主导执行。开发者只在 README 的 `开发者参与` 节点完成设计、实际观察/验证、产品判断、风险接受或受限动作授权；不审批 Skill、文件列表、验证命令或 Task 状态。

Task 02 当前需要开发者阅读 `walkthroughs/001-host-evidence-and-observation.md` 与 evidence manifest，并填写空白观察模板。观察完成后 Agent 才能形成 `002-product-decision-brief.md`；开发者再对 `D-PRODUCT-01` 和 `D-PRODUCT-02` 判断，Leader写 `003-product-decision-record.md`。

## 文件与权限

- README：Leader维护的当前执行合同。
- `context.md`：Leader维护的基线、权限、上游决定、阻塞和下一合法动作。
- `walkthroughs/`：追加式证据、开发者观察来源、决策简报、决定记录和偏差报告。
- `evidences/`：脱敏的固定 manifest、trace 和验证结果；大型运行数据使用系统临时根。

`planned`只授权Task工作本身。源码、依赖/lockfile、Proposal、Spec、Issue/Project远端写入、数据库迁移、真实Provider/Model、浏览器人工验收和数据删除仍需具体授权。
