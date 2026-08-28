---
schema: nbook.task/v2
taskId: t02-sensitive-history-recovery
role: tasker
---

# 敏感历史恢复

## 目标

把 `origin/master` 之后三个未推送提交中的来源逐字内容替换为脱敏研究产物，同时保全其它本地成果；最终本地 `master` 只包含四个以 `origin/master` 为首 parent 的审查提交。

## 事故与边界

- 事故旧 tip 为 `8be1aaffcb4f13d3b156ea2a4f9650fd779e30cc`，基线为 `5dcb778385fd9e6e36015d931b4e6bfea2fe1c96`；已知敏感 blobs 为 `4ce447b21d3a4caf3f4297a5b74d93836b211ac1` 与 `09bd38aecf1a8fa9f576f0ddf9f59fbedf58233d`。
- 所有 Git 子进程使用参数数组并注入 `-c maintenance.auto=false -c gc.auto=0`；对象、ref、reflog、index、linked worktree、alternate 与 promisor 清单只写系统 Temp，正文不进入审计文件。
- 执行前四项保全基线固定为：`.omp/RULES.md` SHA-256 `3b26cf6e75e95c7899a6119d7a8aa5d207a1c4adb1a86ae9ad25a4a8651ccd93`、`WATCHDOG.md` `f24800e78547574735980b5fda273a2a6dde033637df3dc21d48ec0928dde0bd`、`SliderFixture.vue` `6a3ef32ac2e3a3ec6c4e0559e8621247ca3f6f94934b155855fd31b157e2ec07`、`packages/nb-ui/dist/nb-ui.css` `8582cf3b7d8117c10d51a8c36f9429d4c004f8c0f59e6c156a98c8cf8f92d840`。保留前三项语义；CSS 只作执行前字节证据，后续必须从 canonical source 重建。
- 不创建 branch/worktree，不切换主工作区，不 stash，不执行 `git reset --hard` 或 `git clean`，不写远端。

## 执行

1. 在任何新对象写入前记录完整对象宇宙、unreachable 集合、事故闭包、所有 roots 与对象图；缺对象、alternate 无法隔离或独立 root 引用敏感对象时停止。
2. 首个临时 governance checkpoint 精确提交 5 个治理路径、执行前 dirty 的 `SliderFixture.vue`，以及从当前未修复 FormCheckbox source 连续构建两次且字节/SHA-256 一致的 canonical `nb-ui.css`；消息为 `chore: harden local history recovery governance`，parent 为 `8be1aaffcb4f13d3b156ea2a4f9650fd779e30cc`，并使真实工作树/index clean。后续只新增 `fix(nb-ui): restore scoped form control styles`、`fix(agent): close session abort durability contract`、`docs(research): retain redacted novel understanding spike` 三个临时提交；research tip 才是 `oldTempTip`。最终 clean 历史中两个 nb-ui 路径仍只归 nb-ui owner。再用 alternate index 与 `commit-tree` 从 `origin/master` 构造四个 detached clean commits，两个最终 tree 必须相同。
3. Governance checkpoint 前验证保全差异：`.omp/RULES.md` 必须仍含执行前用户新增的“可质疑规则”，且相对执行前基线只允许第 8 行出现已批准的严格历史例外替换，不把结果 hash 当验收；`WATCHDOG.md` 与 `SliderFixture.vue` 必须仍分别为 `f24800e78547574735980b5fda273a2a6dde033637df3dc21d48ec0928dde0bd`、`6a3ef32ac2e3a3ec6c4e0559e8621247ca3f6f94934b155855fd31b157e2ec07`。checkpoint CSS 必须由本次当前-source双构建证明可重建，即使 hash 恰等于执行前 `8582cf3b7d8117c10d51a8c36f9429d4c004f8c0f59e6c156a98c8cf8f92d840` 也允许。checkpoint 后工作树/index必须 clean。第二个临时 nb-ui commit 必须在 source 修复后再次双构建，以字节/SHA-256一致的新 CSS 覆盖 checkpoint 版本，并证明新 hash 不等于 checkpoint hash；最终 clean 历史不得保留 checkpoint CSS blob。
4. 每次 commit/amend 后重新计算精确敏感删除闭包 `D`：除敏感 blob/tree/旧事故提交外，所有以事故旧 tip 或 D commit 为祖先的临时提交、被 amend 替代的 checkpoint 提交和最终 `oldTempTip` 都进入 D，不得由 keep ref保护。需保护的 `A-D` 逐对象证明传递可达闭包与 D 无交集；演练 CAS、raw reflog 与条件恢复 ref，展示完整清单后取得开发者一次性授权。
5. 授权后原子创建列出的保护 refs，以 old/new OID CAS 替换本地 `master`，精准删除本事故 ORIG_HEAD、事故 reflog 项及 `oldTempTip→newTip` clean-transition 项，并只运行一次已授权 gc；transition 完整行仅存系统 Temp 审计，当前 branch ref 保持 newTip。

## 停止条件

- `origin/master`、当前 branch、预期 OID 或执行前保全文件发生未分类变化。
- linked worktree、private ref/reflog/index、alternate、promisor 或独立 root 引用敏感闭包且当前授权不能处理。
- 待删除对象无法证明属于本事故，任一 keep target 的 commit parent/tree、tree child或tag target传递闭包与 D相交，旧/当前临时 commit被误列为保护对象，或出现第三类未分类对象。
- CAS 后校验失败时只按已展示条件创建 recovery ref并停止；不删除 ORIG_HEAD/reflog，不运行 gc。

## 验证

- `git rev-list --parents origin/master..master` 恰为四个线性提交，首 parent 为 `origin/master`，最终 tree 与旧临时 tip tree 相同。
- 研究候选 tree 的来源连续 8 字重合为零；工作树/index clean，保全文件语义存在。
- gc前 D（包括旧事故 commits、所有 amend被替代 checkpoint、当前四个临时 commits和 `oldTempTip`）全部不可达且无 root，主 raw reflog不含 D的任何 old/new OID；`A-D` 全部由传递闭包与 D不相交的持久 root或逐对象 keep ref保护。gc后 D不可读、`A-D`可读且 `git fsck --full --strict`成功。

远端写入、真实 Provider、发布、部署、浏览器人工验收与其它数据删除不在本 Task 授权内。
