# w00022 后续建议与推迟事项

开发者试用 nbdev 与面板时提的建议，以及实现中推迟的事项，先记在这里，到时候集中处理：逐条定做不做，要做的并进现有 Task 或新建 Task，处理后在条目里写明去向。

## 试用建议

| 日期 | 来源 | 建议 | 备注 | 去向 |
|---|---|---|---|---|
| 2026-10-13 | 开发者用 w00005 试 nbdev 时，转述那边 Agent 的建议 | `nbdev work new` 的输出带了一大段与这次新建无关的旧撞号（两个不同的 w00007，分布在多个 worktree 里）。只在撞号涉及这次领的号时才报，其余的放到 `nbdev status` 里 | 现在写命令的 `data.conflicts` 与 `number_conflicts` 警告列出全部撞号（[命令行合同](../../../packages/dev-panel/docs/cli.md)）；`work new`、`task new`、`registry import` 都这样。w00007 那组要等别的会话的分支合入 `master` 后才消失 | 待定 |

## 推迟事项

| 事项 | 出处 | 去向 |
|---|---|---|
| 普通 shell pane 的接管 | t12 设计审查 S8；t14 计划决定点 13 评估后继续推迟 | 待定 |
| `nbdev dev start --port` | t14 计划 S12：nbdev 先不分配也不传端口 | 待定 |
| 产物页内就地答复（页面里填，外壳里提交） | t10 原 S4，见[待确认清单](pending-confirmations.md) | 待定 |
| 跨设备访问（Tailscale） | t13，开发者 2026-10-13 定先不做 | 搁置 |
| 存量撞号 `w00003/t05` | nbdev 撞号检查，不在本 Work 范围 | 待定 |
