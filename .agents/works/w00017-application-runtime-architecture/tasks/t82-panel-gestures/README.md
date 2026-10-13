---
schema: nbook.task/v2
taskId: t82-panel-gestures
status: active
---

# 底部面板的拖动手势

## 目标与范围

开发者 2026-10-12 手动审查 t79 时提出，选择另开 Task：

- 拖动面板上沿能一直拖到顶，拖到顶就是最大化。
- 点“最大化面板”后，能从顶部往下拖来取消最大化。
- 面板拖到零以后往外拖，拖动过程中内容就显示。

这三条不是 t79 的回归，旧应用同样没有。行为合同改 [`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 外壳一的输出 4、7、8。

## 当前状态

- 2026-10-13 读完代码，原因与做法写在 [plan.md](plan.md)：把“拖到顶即最大化”做成编辑器在面板那一轴上拖到零，复用现有的收起判定；拖动中按网格的预览把内容搬出停放区。开发者确认 plan.md 的三项都按推荐（去掉面板高与宽的固定上限、能最大化的位置都适用、阈值 24px）。
- 实施在 worktree `.worktree/w00017-t82-panel-gestures`、分支 `feat/w00017-t82-panel-gestures`（从 `refactor/w00017-runtime-foundation` 的 `f0ae4278` 切出）。
- S1（`845359e5`、`8d61bcb9`）：nb-ui 网格的余量叶也能带收起意图（测试钉住，原实现已支持）；收起意图加 `toggleable: false`——面板在底部或右侧时编辑器在边界前侧，网格的 Enter 优先切换前侧，不加的话“Enter 恢复拖到零的面板”会变成最大化。网格与独立 `Splitter` 一致。
- S2（`ab218d9f`）：去掉面板的 600 上限；面板同列的内容节点带编辑器的最小尺寸；可最大化的组合里编辑器带只经拖动的收起意图，拖到零即最大化（补丁只写 `panelMaximized`，不改面板尺寸）、拖回即还原（写新尺寸）；最大化时边界保留 1px。连带：高度装不下时先压缩面板、给编辑器留 120px，面板最小值 80 也放不下才退到标题头（原来是偏好放不下就退），分栏与紧凑一样，Spec 输出 5 写明。
- S3（`22052ed6`、`a9d66632`）：手势预览一给出尺寸就把拖到零或最大化下的编辑器的内容搬回落点，取消回到停放区；e2e 一例用真实指针覆盖拖过 600、拖到顶最大化且不写尺寸、刷新不复活、往下拖还原并保存、拉出时内容可见；临界尺寸 e2e 跟上新的高度降级。
- 验证：`test:affected --typecheck` 中 bun 1023 例过、1 例失败（`settings/commands.test.ts` 的“项目层覆盖着主题时……”，t79 之前就失败），组件测试 173 例、nb-ui 558 例全过，typecheck 为 0；另一次跑时 `settings/backend/layer-owner.test.ts` 的 50ms 合并一例超时，单独连跑 3 次都过（负载下的偶发）。变异 13 处全部被抓到（余量叶不带收起、Enter 不看 toggleable、规范化丢掉 toggleable、Splitter 的 Enter 不看 toggleable、编辑器不标 toggleable、拖成最大化仍写尺寸、最大化时边界为 0、编辑器不带最小尺寸、高度降级按偏好、紧凑不留高度、高度轴不留最小高度、存储层忽略最大化位，以及拖动中不按预览搬回内容）。受影响 e2e（外壳、视图、拖放、设置、编辑区、标题栏、Lab、Lab 场景门禁）95 例中临界尺寸一例按新规则改后通过；Lab 的 3 例等不到 Lab 根节点，是同时开着旧应用参照服务时内存紧张（可用约 4GB），停掉后场景 20 连跑 3 次都过。`lab:shot` 外壳全部场景在 free、phone 下问题 0 条。
- 手势截帧见 [evidences/gestures.webp](evidences/gestures.webp)（带样例视图的探针服务，真实指针）。
- omp 实现审查（`f0ae4278..a9d66632`）7 条：C2–C7 修（`05732fc3`、`f7a0ebbb`），C1 只写明作用范围。逐条见 [evidences/implementation-review.md](evidences/implementation-review.md)，任务说明与报告原文在 [artifacts/omp-review-1](artifacts/omp-review-1/)。其中 C7 正是开发者最初说的“拖开时面板是白的，好像没加载”：刷新后第一次拉出拖到零的面板，原来要松手视图才加载，现在在拖动中就加载。
- 收口验证：`test:affected --typecheck --since f0ae4278a` 中 bun 1026 例过、1 例失败（已知的 `settings/commands.test.ts`），组件测试 173 例、nb-ui 560 例全过，typecheck 为 0。全套 e2e 179 例中 176 过，挂的 3 例都是开发会话里等不到 Lab 就绪：单独重跑时 Lab 的主题偏好一例、设置里的 Lab 主题一例各连过 2 次，标题栏条目区一例 5 次过 4 次（w00017 worktree 上 2 次都过）；这一类在没有 t82 改动的 w00017 worktree 上同样偶发（Lab 场景 20 三次挂一次），按当前机器负载下的偶发处理。

## 下一步

交开发者验收：可以在带样例视图的探针 http://127.0.0.1:4351/?project=project 上拖面板试（临时状态与示例作品的拷贝，随会话结束）。两条分支（t82，以及之后叠在其上的 t83）何时合回 `refactor/w00017-runtime-foundation` 由开发者安排。
