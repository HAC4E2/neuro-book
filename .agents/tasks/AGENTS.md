# Task Agent 指令

Task 的目录、schema、状态、人机协作章节和历史边界统一见 [`README.md`](README.md)。本文件只补执行动作：

- Leader创建或推进 Task 前读取相关 Issue、Spec、Proposal/ADR、roadmap、ownership 和已有 Task；属于 Issue 验收范围时写正整数 `actionIssueId`，本地治理/隔离实验/机械工作可写 `null`，不按 root 分叉。
- Task 创建即为完整 `planned` 合同。Leader必须写 `目标`、`Agent 工作`、`开发者参与`、`任务产物`、`修改计划`、`完成门禁`、`Leader 继续条件`、`允许文件`，派发后停止并明确需要什么才能继续；不得预建依赖未知结果的后续 Task。
- Tasker开始前通过 `.agents/skills/load_role/SKILL.md` 加载 `tasker`；`planned`/`in-progress` 用于执行，`verifying` 只补 required 证据或同合同修复，`blocked` 在解除条件满足前不执行。
- Agent 主导执行。到达 `开发者参与` 时，Tasker提供证据、产物、选项与建议；未取得结果不自行代替开发者决定。
- `agentWorkflow.verification.required` 必须真实执行或报告不可执行；`verification.notRun` 只表示不适用且有具体原因，未获授权仍留在 required。
- `agentWorkflow.kind: research` 必须有研究问题、研究产物、决策范围；声明 allowlist 与研究产物集合一致，active research 进入 HEAD 后按 owner scope 检查 staged、unstaged、untracked 实际路径，当前 kind/status/产物或合同删除不能关闭或扩大门禁。`kind: design` 必须有设计类型、唯一设计产物、决策范围、允许文件和 context 唯一 `基线 revision`。API design 路由 `api-and-interface-design`；Design 密封 diff 门禁和退出后不重开规则保持。
- 过程更新追加独立 walkthrough；正式脱敏证据进入 `evidences/`，运行数据使用系统临时根。
- 主应用双 root 严格按 ownership 解析，禁止 fallback；自治包的当前 `nbook.task/v1` Task 使用同一合同，无 frontmatter 导入记录只读。
- 完成前核对实现、调用方、产物、开发者参与结果、测试/smoke 与 Spec；planned Spec 由 Leader 在证据闭合后晋升 implemented。
- 历史 Task、completed/abandoned Task 和 walkthrough 不为流程切换批量回填。
