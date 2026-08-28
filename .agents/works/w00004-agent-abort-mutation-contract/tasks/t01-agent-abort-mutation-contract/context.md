# Agent abort mutation 合同恢复卡

## 当前基线

- Current Task：`w00004-agent-abort-mutation-contract/tasks/t01-agent-abort-mutation-contract`；legacy 来源为 `00159-agent-abort-mutation-contract`。
- checkout：仓库主 checkout；迁移前登记基线 `bf07359d3966900ddf9bfc4ad0031fa2b956f29d`。
- Work `issueId: null`；本地治理/实现合同，不为其单独建立远端 Issue。
- 开发者已选择方案 B：普通 abort admission 经 `withSessionMutation()`；forced-abort 是窄化同步 control-plane fence；唯一 `aborted` lifecycle 经同一 per-session write queue。
- `INVOCATION_ABORT_GRACE_MS = 150` 与 forced-abort `300ms` 上界不变。

## 当前工作树事实

- 已存在 `docs/specs/agent/session-abort.md`、ADR 0019、Reference forced-abort 例外和 Task 18 HTTP abort 黑盒合同。
- 已出现 `SessionWriteExecutor.enqueueForcedAbort()`、forced authorization/recovery、HTTP 503错误合同及对应测试候选内容。
- 上述内容说明旧“尚未写 ADR/黑盒合同”叙述已过期；不证明这些候选修改属于本 Task 的已授权执行，也不证明required验证通过。
- 本 Task保持 `blocked`，不得覆盖或回退这些用户现存改动。

## 当前权限

- 已授权：维护本 Task README/context，保存方案 B 决定与阻塞事实。
- 待确认：当前候选业务合同、源码和测试修改的执行来源，及继续补齐/验证这些允许文件的授权。
- 未授权：真实Provider、浏览器人工验收、远端Issue/Project写入、push、PR、发布、部署、数据库迁移或数据删除。

## 已有证据

- Task 147合入提交：`6a79bfd96dbefbe017bfb9f912985507d0ba1b72`，是登记基线的祖先。
- `walkthroughs/001-leader-2026-08-25_09-56-abort-contract-blocker.md`：原始冲突。
- `walkthroughs/002-leader-2026-08-25_10-50-decision-and-verification.md`：方案 B 决定与当时验证边界。
- 当时 `governance:check`、`docs:check` 通过；focused-test、regression-test、typecheck和实现级diff-check未运行。旧结果不能证明当前候选diff。

## 阻塞与下一合法动作

Leader先确认当前候选diff的任务/授权来源，并把方案 B 到Spec、ADR、Reference、黑盒合同、实现和测试的逐条映射写入新walkthrough。开发者明确授权继续修改/验证后，Tasker才能补缺口和运行required检查；未取得确认时停止，不自行推断授权或把候选实现标为完成。
