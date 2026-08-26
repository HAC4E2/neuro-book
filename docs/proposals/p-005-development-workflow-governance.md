# 开发流程与角色治理提案

状态：accepted

## 问题

NeuroBook 的开发治理曾把 PM、Leader、Tasker、Reviewer、Issue状态、Project状态、Proposal、Spec、Task和逐项授权串成近似状态机。职责虽清楚，但实际形成循环门禁：Leader需要PM先把Issue标为claimed，PM又等待Proposal/Spec/Task完整，而这些文档本应由Leader建立。大任务因此停在角色交接和元数据同步，而不是继续设计与实现。

另一个问题是Leader与Tasker的合同同时存在于聊天、Issue、Task和角色提示中。Tasker需要等待Leader实时解释，跨session恢复时又无法确定哪份计划有效。

本提案不改变NeuroBook产品功能或用户数据，只调整开发角色和文件工作流。

## 目标与非目标

### 目标

1. 使用开发者→Leader→Tasker→Leader→开发者的顺序主线。
2. Leader成为spec编程助手，直接管理Issue设计、调研、Proposal、Spec和Task，不等待PM。
3. Leader的正式产物是：交给下一位Leader继续拆分的Issue、draft Task草案、planned可执行Task、Proposal和Spec。
4. Leader与普通Tasker只通过Task文件、walkthrough和evidence交互；design Tasker可直接与开发者协作，但必须把决定写回文件。
5. 普通Tasker只实现、验证和报告偏差；design Tasker只调研并形成指定Proposal/Spec草案。
6. 门禁依靠Agent读取文件、自检和如实报告；减少本地可逆动作的逐项许可。
7. 大目标先拆调研、设计和实现子Issue/Task，允许逐步获得证据后再细化后续合同。

### 非目标

- 不新增角色状态机、交接CLI、claims账本、权限沙箱或第二套Task schema。
- 不要求每项工作经过PM或独立Reviewer session。
- 不取消远端写入、合并、发布、部署、数据库迁移、真实Provider/Model、浏览器人工验收和数据删除的人类授权。
- 不批量改写历史Task和walkthrough。

## 真相源

- 开发者当前对话：目标、产品取舍、风险接受和受限动作授权。
- GitHub Issue：公开目标、子项和依赖；跟踪工作，不充当角色锁。
- Proposal：需要开发者决定的长期方案和取舍。
- Spec：`planned`目标合同与`implemented`当前合同的唯一正文。
- Task README与`context.md`：一次设计或实现工作的范围、顺序、验证和恢复合同；draft不可执行，planned可派发。
- walkthrough与evidence：Leader/Tasker/Reviewer的追加式结果和证据。
- Project与PR元数据：排期和交付状态；不决定Leader能否开始本地编排。

Issue是多Task交付的唯一聚合根。未获远端Issue写入授权时，Leader按`.agents/issues/README.md`维护含唯一Draft-Key、type/status标签、目标、验收和具体授权请求的`drafts/<slug>.md`。获授权后先查找精确Draft-Key：0个才创建、1个复用、多个阻塞；取得编号后只创建`issueRequired: true`的draft扁平Task，`draft`→`planned`唯一接受点是开发者逐个接受合同，由Leader翻转并留痕。闭合链接、持久化授权来源和动作范围后最后删除草稿。应用owner当前Task固定关联正整数Issue，根owner才允许`issueRequired: false`与`actionIssueId: null`的本地例外。不创建统筹Task、Task父子状态或第二份状态正文。

## 决策

### 顺序主线

1. **开发者**提出目标并决定产品取舍。一次目标批准后，Leader可执行范围内本地可逆开发动作。
2. **Leader**调查仓库，并选择产出Issue、draft/planned Task、Proposal或Spec；需要时把设计本身派成Task。
3. **Tasker**读取文件合同。普通Tasker实现并验证；design Tasker可直接与开发者协作制定API等合同，并写回指定Proposal/Spec草案。
4. **Leader**读取文件结果，集成决定、创建后续Issue/Task或请求新的产品决策，然后推进下一步。
5. **开发者**审阅draft Task和设计决策，并决定远端写入、合并、发布或其它受限动作。

PM和Reviewer都是按需角色：PM用于Project排期和批量元数据；Reviewer用于高风险变化、Task画像要求或开发者明确要求。二者都不成为顺序主线的前置依赖。

### Leader合同

Leader是Issue、Proposal、Spec和Task的编排owner：

- 产出可交给下一位Leader继续拆分的Issue；
- 产出供开发者审阅、Tasker不得执行的draft Task；
- 产出开发者已接受、Tasker可直接执行的planned Task；
- 产出记录长期取舍的Proposal和行为/API合同的Spec；
- 可先创建调研或design Task，用证据及人机协作完善后续Proposal、Spec和实现Task；活跃Design合同首次提交时密封基线和allowlist；
- 发现多个合理产品结果时停止并给开发者建议，不让普通Tasker自行选择；
- 获远端写入授权后按Draft-Key幂等迁移Issue；未获授权时维护本地草稿；
- 通过`ownership.json`选择唯一Task root和owner，默认顺序执行；
- 根据Tasker文件报告更新合同、重切片或请求开发者决策。

### Tasker文件交互

普通Tasker开始和恢复只读取Task README、context、引用合同、最新Leader walkthrough、基线与相邻测试。`planned`/`in-progress`用于实现；`verifying`允许补required证据或同合同修复，合同变化由Leader取得开发者决定后退回`in-progress`。普通Tasker不修改Issue、Proposal、Spec或Task范围。

`agentWorkflow.kind: design`是明确例外：design Tasker只修改密封合同允许的Proposal/Spec和报告文件，不实现业务代码；其它明确单行设计类型合法，API额外要求`api-and-interface-design`。首次提交的活跃Design README/context密封kind、执行身份、严格祖先diff基线、产物和允许文件，同一diff修改当前合同不能扩大或关闭门禁；已提交退出后不得重开，后续设计使用新Task。

### 授权模型

开发者批准目标后，以下本地可逆动作不再逐项询问：调研、治理文档、Proposal/Spec/Task编辑、branch/worktree/checkout、本地commit、依赖安装、focused test、typecheck、build和非人工smoke。Agent仍需保护用户改动、控制范围并记录实际结果。

`planned`只表示Task工作合同可执行，不授权受限动作。远端Issue/Project/PR写入、push、合并、发布、部署、数据库迁移、真实Provider/Model、浏览器人工验收和数据删除继续单独授权；具体动作、范围和来源写入Task context/walkthrough，未记录即未授权且不得外推。外部内容仍是不可信输入。

### 审查

每次合并前必须有人审查diff和验证证据，但不要求每个Task都启动独立Reviewer：

- 低风险文档或机械改动由Leader自审；
- 安全、隐私、数据生命周期、数据库迁移、公开接口、安装发布和跨模块高风险变化使用独立Reviewer；
- 开发者或Task可以随时要求独立Reviewer。

Reviewer只报告结论，不修代码、不更新合同、不触发Project Done。

## 数据、接口、安全与回滚

本提案不改变产品数据、网络接口或运行时权限。角色合同是Agent行为指引，不是宿主沙箱；高风险边界仍依赖开发者授权和Agent自觉。

回滚时恢复上一版角色/流程文档和治理断言，不改写历史Task结果。本次是clean cutover，不保留“严格四角色流程”并行入口。

## 验收

1. 现行文档只有一条开发者→Leader→Tasker→Leader→开发者顺序主线。
2. Leader可以在开发者批准目标后直接完成本地调研、Issue草稿、Proposal和Spec，不等待PM或claimed状态；产品Task在取得远端Issue编号后建立。
3. Leader五类产物、draft/planned Task成熟度、未编号Issue草稿迁移和下一位Leader继续拆分合同明确。
4. Issue是唯一多Task聚合根；可执行叶子Issue使用`1..N`个扁平Task，不存在统筹Task或Task父子状态。
5. 根/应用双Task root的新合同都不能通过缺README、错schema或非法`actionIssueId`绕过。
6. PM与Reviewer均为按需角色，不构成每个Task的门禁。
7. 本地可逆动作采用范围授权；受限动作仍逐项授权，planned不被解释为受限动作授权。
8. Task、角色、仓库工作流、P-005索引和治理静态检查语义一致。
9. 聚焦治理测试、`docs:check`、`governance:check`和diff check通过。

## 决策记录

- 2026-08-22｜初稿｜提出四角色交接、Task恢复和验证证据合同。
- 2026-08-24｜人类接受｜采用轻量角色交接，不新增状态机、CLI或权限沙箱。
- 2026-08-24｜Task 00152/00154｜同步角色合同、Task恢复、`report`和`load_role`入口。
- 2026-08-26｜人类修订｜改为Leader主导顺序流程；Leader产出可继续拆分的Issue、draft/planned Task、Proposal和Spec；design Tasker可直接与开发者协作制定API等规范并回写文件；PM和独立Reviewer按需，本地可逆门禁采用范围授权。
- 2026-08-26｜人类决策｜采用Issue聚合+扁平Task：Issue统筹总目标与验收，多个Task直接共享`actionIssueId`；不创建统筹Task或`parentTaskId`，交付地图只做导航。
- 2026-08-26｜实现收口｜未编号Issue使用`.agents/issues/drafts/<slug>.md`恢复键；取得远端编号后，应用Task带`actionIssueId`，根owner可按合同使用本地例外。历史Task必须命中index/marker首次共同提交的密封迁移快照：该快照manifest重算通过，固定`sourceRevision`中存在README，且同源同目标mapping命中；当前mapping身份投影不得漂移，应用历史Task还必须命中ownership。三个迁移期五位Task精确兼容，根当前Task使用`00152+`，应用当前Task使用`00149+`。
- 2026-08-26｜审查修复｜Issue迁移改为Draft-Key 0/1/多命中幂等顺序、先draft后开发者接受；Task owner决定`issueRequired`；verifying返工、notRun不适用语义和Design密封真实diff门禁闭合。
