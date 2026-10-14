---
schema: nbook.task/v2
taskId: t90-spec-promotion
status: active
updated: 2026-10-14
---

# w00017 收尾：已实现的 Spec 晋升

## 目标与范围

按 sonnet 对照报告晋升 9 份已实现但仍为 planned 的 Spec：files-explorer、files、folder-kinds、editor、views、ui/workbench-shell 整份晋升（views 输出 7 标 planned）；resources、browser-host 把未实现的条目标 planned 后晋升；plugin-channel 去掉过时的保留理由、HTTP 路由贡献一节移交后晋升。plugin-manifest 保持 planned，归第三方插件 Work。开发者 2026-10-14 批准。

合同：行为合同未变，只改成熟度、实现合同与证据；对照报告见 [evidences/spec-review.md](evidences/spec-review.md)（sonnet 子代理逐条对照代码与测试）。

执行位置：`.worktree/w00017-t90-spec-promotion`，分支 `docs/w00017-t90-spec-promotion`。

## 当前状态

2026-10-14 开发者批准对照报告的方案并同意 push master（已推送到 `31625acc1`）。晋升交 sonnet 子代理在 worktree 里改，主 Agent 审 diff 后合入。
- 2026-10-14 完成：9 份晋升 `implemented`（files-explorer、files、folder-kinds、editor、views、ui/workbench-shell 整份；resources、browser-host 未实现的条目原地标 planned；plugin-channel 删去过时的保留理由），注册表同步；三份 Spec 里“待开发者追认”的批准依据改为已追认。与计划不同的一处：plugin-channel 末节的逐路由 HTTP 路由声明没有挪进 `runtime/server-host.md`——已实现的 `http.routes` 是整块挂载 Hono 应用的粗粒度模型，两者不是同一设计，挪进已实现的 Spec 会写进不存在的行为——改挪到同为 planned 的 `runtime/api-docs.md`，注明实现时要在两种模型间选。另：files 的已知限制按对照结果写成“Linux 实测、macOS/Windows 按代码分支但未在新应用上实测”（原文的 Windows 本机验证属于旧应用 t25）。
- 合入：master 快进到合并提交 `4d382ba33`；`docs:check`、`governance:check` 0 失败、0 新警告。待清理：`.worktree/w00017-t90-spec-promotion`、分支 `docs/w00017-t90-spec-promotion`。

## 下一步

无。
