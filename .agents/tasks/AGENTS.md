# Task Agent 指令

Task 的目录用途、真相源分工、目录结构、frontmatter、状态和人类工作流统一见 [`README.md`](README.md)。本文件只补充 Agent 执行动作：

- Leader创建或推进Task前，读取相关Spec、Proposal/ADR、ownership和已有Task，创建唯一README与context；开发者批准目标后无需等待PM或claimed状态。应用owner当前Task固定`issueRequired: true`和正整数Issue，根owner才允许`false`和`null`。
- Tasker开始前通过`.agents/skills/load_role/SKILL.md`加载`tasker`；`draft`不得执行，`planned`/`in-progress`用于实现，`verifying`只补required证据或同合同修复。合同变化交回Leader，Leader取得开发者决策后退回`in-progress`。
- `agentWorkflow`由Leader填写。`kind: design`必须有非空的`设计类型`、`设计产物`、`决策范围`、`允许文件`章节和context唯一`基线 revision`；该基线必须是首次密封提交的严格祖先，API类型必须路由`api-and-interface-design`。首次提交的活跃Design合同密封门禁，后续改frontmatter、状态或context不能扩大允许文件或关闭真实diff检查；已提交退出后不得重开。普通Tasker不修改Issue、Proposal、Spec、Task范围或owner。
- `verification.required`必须真实执行或报告不可执行；`verification.notRun`只表示不适用且有具体原因，未获授权仍留在required并报告阻塞。
- 过程更新追加独立walkthrough；正式脱敏证据进入`evidences/`，运行数据使用系统临时根。
- 双根Task严格按ownership解析；登记项只读应用Task root，未登记项只读根Task root，禁止fallback。
- 完成前核对实现、调用方、测试、smoke与Spec；planned Spec由Leader在证据闭合后原地晋升implemented。
- 历史Task不为流程切换批量改写。
