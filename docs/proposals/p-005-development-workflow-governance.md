# 开发流程与角色治理提案

状态：accepted

## 问题

NeuroBook 已有根 `AGENTS.md`、PM / Leader / Tasker / Reviewer 角色合同、Proposal、Spec、Task、walkthrough、evidence、GitHub Issue / Project 和 `governance:check`。这些资产分别约束了授权、产品合同、任务执行和结构检查，但没有一份从需求输入到合并决策的最小流程描述：一次非平凡开发依次经过哪些逻辑阶段、每个阶段消费和产出哪些文件、上下文缺失时如何判断继续还是阻塞，分散在多个文档中，新 session 无法凭单一入口恢复现场。

当前主要问题有三类：

1. 根 `AGENTS.md` 同时承载开发入口、仓库导航、角色规则、Git 操作、发布载荷和用户文案细则，开发步骤被参考信息打断；默认读者也没有被建模为能够依次承担各逻辑角色的 Agent。
2. 跨 session 交接缺少统一的最小清单：下一角色应读取 Issue/授权来源、Spec、Task、`context.md`、walkthrough、evidence 和实际 diff 中的哪些内容，缺失时如何处理，没有一处集中说明。
3. 验证证据（required / notRun、walkthrough、evidence）与 Reviewer 结论、人类合并授权之间的门禁关系没有统一表述。

本提案只讨论开发治理，不改变 NeuroBook 产品运行时的 Agent、Skill、Workflow、Project Workspace 或用户数据协议。

## 目标与非目标

### 目标

1. 角色职责互斥：PM/请求方、Leader、Tasker、Reviewer 各自的输入、输出和停止条件清楚，不互相代做核心职责。
2. Task 能跨 session 被恢复：任一角色重新进入时，重读既有记录即可判断当前状态，从最后一个已验证状态继续，或在无法恢复时写明阻塞。
3. 验证证据可追溯：required / notRun、walkthrough 和 evidence 与 Task 目标、diff 和 Spec 关联，Reviewer 结论基于可核对证据。
4. 受限动作由人类明确决定：合并、发布、部署等动作在证据闭合之外始终需要人类明确授权。

“交接”在本提案中仅指下一角色读取既有 Issue/授权来源、Spec（或“行为合同未变”依据）、Task、`context.md`、walkthrough、evidence 和实际 diff；它不是宿主权限隔离、不可伪造状态机或事务系统。

### 非目标

- 不改变 NeuroBook 产品功能、数据、网络接口、数据库 schema、运行时 Skill 或用户 Workspace。
- 不把通用 Agent Skills 的默认 `SPEC-*`、`tasks/plan.md`、`tasks/todo.md` 或缺失的 `definition-of-done.md` 引入项目。
- 不要求所有任务走完整访谈、Proposal、浏览器验收或发布流程；不为小改动强制创建 Task。
- 不新增宿主权限隔离、签名、revision 计数、claims 台账、journal、compare-and-swap 写入、隐式 fallback、新 CLI 或新 Skill。
- 不通过本提案授权远端写入、合并、发布、部署、数据库迁移、真实 Provider/Model、浏览器人工验收或数据删除。
- 不批量改写历史 Task、walkthrough 或已归档 Proposal。

### 未启用的扩展层

本提案早期草案曾定义批量输入分流（Intake、candidate、Selection set 与计数基线）、多任务编排（Initiative 与 Phase DAG）、结构化迁移（Proposal v1、Task v2、authorization schema、lineage）和事务式交接（claims ledger、handoff journal、`governance:handoff` CLI）。以上内容已全部移出本提案：它们属于未来可能的扩展，任何一项推进都需要独立 Proposal、独立实现 Task 和独立人类授权；它们不是本轻量合同的前置条件，也不属于其验收范围。

## 当前行为与证据

### 现有真相源

- 根 `AGENTS.md` 与 `.omp/RULES.md`：仓库级授权、范围、安全、验证和报告边界。
- `docs/proposals/`：需要人类评审的长期方案；`accepted` 只授权后续 Spec 和实现 Task。
- `docs/specs/`：`planned` 目标合同与 `implemented` 当前合同的唯一真相源。
- GitHub Issue / Project：公开问题、实现授权、优先级、迭代和交付状态。
- `.agents/tasks/`：一次实现的执行合同、上下文、过程报告和正式证据。
- `.agents/roles/`：PM、Leader、Tasker、Reviewer 的职责和停止条件。
- `.agents/skills/agent-workflow-router/`：按任务类型选择最小充分 Agent Skills 路由。
- `governance:check`：治理资产、Task owner、迁移、monorepo 边界和 Agent Skills 适配的结构检查。
- walkthrough 与 evidence：追加式过程报告，以及脱敏后的命令结果、日志、截图、JSON 等正式产物；记录历史，不充当状态真相源。

### 已有角色边界

- PM 将人类目标转换为可决策计划，不实现代码。
- Leader 将已批准目标拆成 Task，组织 Tasker、请求 Reviewer 并准备合并决策。
- Tasker 只实现已批准 Task，不管理 Issue、PR、合并或发布。
- Reviewer 独立判断合同和证据是否满足，不修改被审查代码。

现状锚点：根 `AGENTS.md` 的“仓库结构与文件路由”“Git 注意事项”“常用命令”“了解开发者”共处同一入口文件，开发步骤被参考信息与文案细则打断（问题 1）；跨角色读取要求按各角色自己的章节分散组织——Leader 的“开始工作”“人类批准后”“阻塞处理”、Tasker 的“实现规则”“遇到阻塞”、Reviewer 的“验证步骤”“禁止事项”、PM 的“相关资料与文档索引”“你的工作”“职责、权限、与边界”——加上 `.agents/tasks/README.md` 的 context/walkthrough/evidence 规则，无一处端到端汇总（问题 2）；合并、发布与部署门禁写在根 `AGENTS.md` 的“Git 注意事项”（不自行合并 PR、关闭 issue、部署或做其他收尾）和 `.omp/RULES.md` 的授权边界中，worktree/branch/PR/checkout 审批另见该文件的“开发者审批与通知”；`governance:check` 只做治理结构检查，不证明门禁语义被执行（问题 3）。

这些边界已经存在；缺的是把它们串成端到端流程并说明跨 session 恢复方式的一份最小合同。

## 方案、备选方案和取舍

### 方案 A：最小角色交接合同（建议）

用一份流程描述固定五个逻辑阶段的职责、交接证据清单、自恢复规则和人类授权点。两种使用方式（单 Agent 依次承担逻辑角色、显式分角色协作）作为设计背景，共用同一套 Task、walkthrough 和 evidence。

收益：

- 只修订提案文档本身，不新增治理对象、schema、CLI 或 Skill。
- 跨 session 恢复依靠 LLM 重读既有记录的自检能力，符合“相信 LLM 自觉与自恢复”的轻量方向。
- 两种使用方式不需要重复记账。

代价：

- 交接前置条件和越权只能靠 Agent 遵守文档合同，无法机器拒绝。
- 多个 session 并发推进同一 Task 时检测不到过期状态。
- 批量输入分流、多任务依赖和事务式交接等诉求延后到独立提案。

### 方案 B：完整生命周期平台

本提案早期草案的方向：Intake、Initiative DAG、frontmatter 迁移、带 revision 的 `governance:handoff`。表达力最强，但引入两类新治理对象、全库 schema 切换和原子写协议，维护成本与当前需要不成比例。经用户决策改为轻量方向，不再作为本提案范围。不采用。

### 方案 C：所有开发都采用严格四角色流水线

任何改动都由 PM、Leader、Tasker、Reviewer 四个独立 session 依次处理。边界最清楚，但文档修正、局部 Bug 和小型重构承担不成比例的交接成本。不采用。

### 方案 D：只依赖通用 Agent Skills 生命周期

直接沿用通用 Skill 的默认文件和完成定义，会创建第二套 Spec、计划、Task 和 DoD，绕开项目现有 Proposal、Spec、Issue/Project、Task、角色和授权边界。不采用。

## 目标开发流程

### 五个最小角色阶段

以下是拟议合同：只有本提案被人类接受、且后续实现 Task 另行获批后，才会修改现行合同使其生效；在此之前本节不构成对任何现行规则的变更。

1. **PM/请求方**：明确目标、范围、非目标、待决策项和 Issue/人类批准来源；不实现代码。
2. **Leader**：确认 Spec，或为无 Spec 变化的工作记录“行为合同未变”依据；建立或更新 Task、`context.md`、`agentWorkflow` 和 `verification.required/notRun`；只拆分已批准范围。
3. **Tasker**：只实现 Task 范围内的改动，按 required 检查完成 focused 验证，追加 walkthrough 和 evidence；合同、范围或环境前提不成立时停止并报告。
4. **Reviewer**：核对目标、diff、Spec、Task、required/notRun、测试、smoke 和残余风险；输出建议合并、需要修复、未完成验证或无法判断；返工意见交回 Leader/Tasker。
5. **Human/Leader**：只在证据闭合且人类明确授权后执行合并、发布、部署或其他受限动作。

这些是逻辑阶段，不要求每项工作都创建全部文档；小改动继续由 Git diff、commit 和 PR 追踪。

### 交接清单与自恢复

每次交接，下一角色至少读取：Issue/人类授权来源、Spec 或“行为合同未变”依据、Task、`context.md`、`agentWorkflow`、`verification.required/notRun`、追加式 walkthrough、evidence 和实际 diff。

Agent 发现上下文缺失时按以下顺序自恢复：

1. 重读上述既有记录和当前 diff；
2. 能确定最后一个已验证状态的，从该状态继续；
3. 不能恢复的，写明阻塞点和缺失信息，交回上一角色或人类；
4. 不伪造缺失记录，不创建隐式 fallback，不因恢复失败而扩大范围。

### 两种执行模式（设计背景）

以下两种方式是本提案预期支持的使用背景；在实现 Task 获批并同步现行合同前，二者都不改变现行入口，也不是强制门禁：

- **单 Agent 模式**：普通 Code Agent 在一个 session 内依次承担五个逻辑角色，写一份追加式总报告，按真实阶段记录切换；数据、安全、隐私、公开接口、安装、发布或跨模块合同等高风险变化仍应另开独立审查 session。
- **分角色模式**：用户显式要求时按 PM、Leader、Tasker、Reviewer 分 session 执行，各自写追加式 walkthrough。

两种模式共用同一份 Task、walkthrough 和 evidence；不引入新的 Skill、状态机或工具沙箱。

## 实际使用场景与 Agent 反应

本节是拟议合同的使用说明，不是新增 CLI、Skill 或 PM → Leader → Tasker → Reviewer 的可执行引擎。实现 Task 获批并同步现行合同前，下面的行为只是目标样例，不构成对任何现行规则的变更；实现 Task 如需修改现行入口，必须另行定义文件改动和验证方式。

### 开发者如何发起工作

开发者通常只需说明想要的结果、已知约束和是否允许修改；不需要指定实现文件，也不需要自己编写 Task。可以使用自然语言表达以下几类请求：

- **小改动**： “修正文档中的这处错误，保持现有行为。” Agent 读取相关规则和文件，确认不涉及行为合同后直接完成最小改动，运行与改动面匹配的检查，并报告实际 diff 和未运行项。
- **非平凡需求**： “修复这个 Bug，不能改变现有数据格式；先确认预期行为。” Agent 先读取根规则、相关 Issue、Spec、角色合同和已有 Task，区分已知事实、推断和待决策项；缺少授权、Spec 或验收条件时先输出诊断和问题，不开始代码实现。
- **继续已有工作**： “继续 Task 00149，先恢复上次进度。” Agent 先读取 Task README、`context.md`、最新 walkthrough、evidence、引用的 Spec 和当前 diff，确认基线与范围后，从最后一个已验证状态继续；记录不一致或缺失信息时先阻塞，不凭记忆补全。
- **指定角色**： “只做 Reviewer，检查这个 Task，不要改代码。” Agent 只执行该角色允许的读取、验证和报告；“按 Leader 拆分这个已批准 Issue”则只做上下文、Task、验证画像和派发准备，不代 Tasker 实现。

### Agent 在各阶段如何反应

对同一请求，普通单 Agent session 可以依次承担以下逻辑角色；开发者显式指定角色时，Agent 只承担指定阶段：

1. **理解阶段**：先说明当前理解、目标、非目标、已读真相源和仍需决定的问题。发现产品行为、权限、数据、公开接口或其他合同不明确时，提出决策问题，不把推断写成实现依据。
2. **PM/请求方阶段**：整理目标、范围、非目标、待决策项和 Issue/人类批准来源；不写业务代码。若需求需要长期方案，建议进入 Proposal/Spec 决策；`draft` 或 `reviewing` Proposal 不被当作实现授权。
3. **Leader 阶段**：确认已有 `planned` / `implemented` Spec，或记录“行为合同未变”的依据；在人类批准后建立或更新 Task、`context.md`、`agentWorkflow` 和 `verification.required/notRun`，只拆分批准范围。没有批准或关键上下文缺失时，输出阻塞和待决定事项。
4. **Tasker 阶段**：读取当前 Task 和上下文后实现；按 `required` 执行验证并把命令、结果和正式产物写入 walkthrough/evidence。发现需要扩大范围、改变合同或替换 required 检查时停止，说明原因和可选方案。
5. **Reviewer 阶段**：独立读取目标、Spec、Task、diff、required/notRun、测试、smoke 和 evidence；只输出“建议合并、需要修复、未完成验证或无法判断”之一及其依据，不修改被审查代码。
6. **合并决策阶段**：Agent 汇总实际结果、未运行项和残余风险，等待人类明确决定。Reviewer 通过或证据齐全不等于自动合并、发布、部署或关闭 Issue。

### 跨 session、返工和阻塞示例

- **上下文完整**：新 Agent 读到一致的 Task、Spec、`context.md`、最新 walkthrough 和 diff，能够定位最后已验证状态时，继续未完成步骤，并在新 walkthrough 中说明恢复依据。
- **上下文缺失**：Task 没有 `context.md`，或 `required` 与 `notRun` 相互矛盾时，Agent 不猜测、不生成替代状态；写明缺失项，交回 Leader 或请求开发者决定。
- **范围发生变化**：实现过程中发现需要改变数据格式、公开接口、权限或 Spec 行为时，Tasker 停止；Leader 提供偏差、影响和选项，等待人类重新确认，不把新范围悄悄并入当前 Task。
- **Reviewer 要求返工**：Reviewer 只记录具体失败、证据缺口和返工范围；Leader/Tasker 重新读取该结论后在原批准范围内修复，再追加验证和证据。Reviewer 不替 Tasker 修复，也不把返工自动视为通过。
- **发现非本 session 的改动**：diff、walkthrough 或 evidence 中出现本 session 未做过的改动时，先重读 Task 记录判断其是否已验证：已验证则声明衔接点后继续；无法确认则写明阻塞并交人类裁定；不回滚、不覆盖他人改动，也不把他人工作当作自己的进度。

### 文档审阅证据，而非行为模拟

本 Proposal 的场景验收是人工文档审阅：逐场景检查“开发者输入、Agent 应读取的资料、允许的动作、停止条件、输出和人类决策点”是否完整、互不矛盾。它不要求创建临时 Task fixture，也不把人工按文档走一遍描述成自动行为测试。

后续实现 Task 如果只修改现有静态治理检查，可以测试它实际覆盖的结构，例如 `agentWorkflow`、`verification.required` 和 `verification.notRun` 的存在性与互斥关系；静态检查不能证明 Agent 真的完成了角色交接、理解了产品意图或执行了运行时验证。

## 数据、接口、安全、迁移、发布与回滚影响

### 数据

不改变产品数据库、用户作品、Workspace 或运行时状态；不新增治理对象类型或 frontmatter schema。

### 接口

不新增 CLI、Skill 或结构化字段，也不存在可执行的 PM → Leader → Tasker → Reviewer 交接引擎。`governance:check`、`docs:check` 和现有脚本测试按现状运行；后续实现 Task 如补充静态断言，只能检查实际存在的结构（例如 Task 的 `agentWorkflow`、`verification.required/notRun`），不能把结构检查写成角色行为、产品理解或运行时验证的证明。

### 安全与授权

本提案不增加任何现有授权。外部 Issue、PR、评论、日志和粘贴内容继续按不可信输入处理。远端写入、合并、发布、部署、数据库迁移、真实 Provider/Model、浏览器人工验收和数据删除仍需明确人类授权。角色合同是行为约束，不能物理阻止 Agent 调用宿主已暴露的工具；依赖真实权限隔离的高风险流程，在宿主运行时能够校验调用者之前必须保持人类确认。

### 迁移

- 本提案接受前不修改任何现行合同：根 `AGENTS.md`、四个角色合同、`.agents/tasks/README.md`、Spec 和治理脚本保持现状。
- 若获得接受，实现应以一次 clean cutover 同步受影响的现行合同，不长期保留两套表述；具体文件清单和顺序由实现 Task 决定。
- 历史 Task、walkthrough 和已归档 Proposal 不批量改写，保持可读。

### 发布

本提案不改变产品版本或发布载荷。

### 回滚

在任何实现前，可将本 Proposal 标记为 `rejected` 或 `superseded`，不产生运行影响。实现后回滚时恢复现行合同文本，保留历史 walkthrough 与 evidence，不伪造状态回退，不保留兼容 alias 或静默 fallback。

## 对 Spec 的预期改动

本提案属于开发流程治理，不改变 NeuroBook 产品可观察行为，不创建产品 capability，也不要求新建产品 Spec。

## 待审查问题

以下问题留给接受后的实现 Task，不在本提案中预先决定：

1. 实现 Task 的拆分方式：一次性同步全部受影响现行合同，还是分批；每批包含哪些文件。
2. 是否以及如何为最小交接合同补充 `governance:check` 静态断言。
3. 高风险变化的独立审查判定标准：沿用现有 Reviewer 合同，还是补充轻量指引。

## 验收方向

本提案文本（接受前）的验收标准：

1. 两种执行模式只作为设计背景出现，且被明确标注为接受并实施前不生效。
2. 五个最小角色阶段的职责、输入输出和停止条件互斥、无冲突。
3. 交接清单完整覆盖授权来源、Spec 或行为未变依据、Task、context、agentWorkflow、required/notRun、walkthrough、evidence 和 diff。
4. 实际使用场景覆盖小改动、非平凡需求、继续已有 Task、指定角色、上下文缺失、范围变化、Reviewer 返工和人类合并决策；每个场景都明确开发者输入、Agent 反应、停止条件和输出。
5. 场景验收是人工文档审阅证据，不创建临时 fixture，不模拟不存在的交接引擎；后续只对现有静态检查实际覆盖的 `agentWorkflow` 结构运行 focused 检查。
6. Reviewer 四种结论、返工路径和人类受限动作授权点表述清楚。
7. 未启用扩展层只有一段范围说明，正文不含可实施的详细合同；既有真相源分工和历史记录可读性不被改变。
8. 接受前历史条件：本文件在接受前保持正文 `状态：draft` 且无 frontmatter；2026-08-24 经人类接受改为 `accepted`，仍未引入 frontmatter，实现授权以独立实现 Task 获批为准。

接受后的实施验收（由实现 Task 定义并逐项证明）：现行合同同步、现有静态治理/文档检查的 focused 验证、必要回归；不把人工场景审阅写成自动角色行为测试，均不属于本提案文本本身的验收。

## 决策记录

- 2026-08-22｜状态：draft｜记录本轮开发流程讨论，等待人类审查；本记录不是实现授权。
- 2026-08-22｜讨论选择｜根 `AGENTS.md` 默认面向全能 Agent；严格模式继续使用 PM、Leader、Tasker、Reviewer。
- 2026-08-22｜讨论选择｜采用敏捷与严格两种使用方式；严格模式通过角色合同约束，不建宿主工具沙箱。
- 2026-08-22｜讨论选择｜曾考虑新增 Intake、Initiative、Proposal frontmatter、Task v2 和带 revision 的 `governance:handoff`；相关讨论条目保留为历史，实施合同已于 2026-08-23 移出本提案。
- 2026-08-22｜讨论选择｜敏捷模式使用一份全能 Agent 总报告；高风险改动要求独立 Reviewer；非平凡开发形成治理文档，小改动可只由 Git 追踪。
- 2026-08-22｜讨论选择｜Reviewer 给出结论后准备合并决策；人类明确批准后才执行合并和清理。
- 2026-08-23｜修订｜按用户决定的轻量方向整体收缩本提案：删除 Intake、candidate、Selection set、Initiative、Proposal v1、Task v2、authorization/lineage、claims ledger、journal、`governance:handoff` 及相关计数基线与 16 条验收场景的实施合同，改为最小角色交接合同；扩展层仅在“未启用的扩展层”一节保留范围说明。
- 2026-08-23｜边界确认｜本提案在被人类接受前不修改任何现行合同；`.worktree/t151-governance-workflow` 的 accepted 副本与 Task 00151 属于未合并的历史研究，其状态不由本提案处置，是否终止旧 T151 由人类另行单独决定。
- 2026-08-24｜修订｜补充开发者实际使用场景和 Agent 反应：小改动、非平凡需求、继续已有 Task、指定角色、上下文恢复、范围变化、Reviewer 返工与人类合并决策；场景属于文档审阅证据，不构成自动交接引擎或实现授权。
- 2026-08-24｜人类接受｜正文状态改为 `accepted`：接受轻量角色交接合同文本；按 Proposal 生效规则，本条只批准创建独立实现 Task，实现 Task 另行获批前不修改任何现行合同。
- 2026-08-24｜修订｜接受后一致性同步：`docs/proposals/README.md` 索引条目更新为轻量合同语义与 `accepted` 状态；“两种执行模式”与“实际使用场景”的门禁措辞从“提案被接受前”改为“实现 Task 获批并同步现行合同前”；验收方向第 8 条标注为接受前历史条件。
- 2026-08-24｜修订｜按接受后审查补充：为三类问题增加可核对的现状锚点（根入口章节、四个角色合同与 `.agents/tasks/README.md` 小节、“Git 注意事项”与 `.omp/RULES.md` 门禁、`governance:check` 结构检查边界），并在跨 session 示例中增加发现非本 session 改动时的保留、核对与阻塞反应。
