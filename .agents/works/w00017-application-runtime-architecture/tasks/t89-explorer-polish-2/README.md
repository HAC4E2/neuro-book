---
schema: nbook.task/v2
taskId: t89-explorer-polish-2
status: active
updated: 2026-10-14
---

# 资源管理器打磨（二）：内联输入、行样式与滚动条

## 目标与范围

t86 验收时开发者新提的三条：新建与改名的内联输入框样式；选中与悬停的行样式（右端被裁、关闭编辑器后的选中态）；滚动条半透明、只在鼠标进入时显示，视图标题的动作随鼠标显示。之后开发者又报了两个 bug：侧栏从收起状态往外拉时活动栏与侧栏要等松手才相连；视图标题的“移动到”菜单被资源管理器选中的行盖住。

执行位置：`.worktree/w00017-t89-explorer-polish-2`，分支 `feat/w00017-t89-explorer-polish-2`。VS Code 的做法（sonnet 子代理读 1.141.1 源码）：[vscode-research.md](vscode-research.md)。

合同：[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md)、[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md)；滚动条按评审结果改 [nb-ui 开发规范](../../../../../packages/nb-ui/docs/ui-development-spec.md) 的滚动条一条。

## 当前状态

- 2026-10-14 已修三个 bug（分支上，各带 e2e，均做过去掉修复后测试失败的核对）：
  - 行的选中与悬停底色右端被滚动条槽位裁掉：行左右各让 6px 又是 100% 宽，改为宽度由左右两边定（`c7cf1b6a0`）。
  - 侧栏从零拉出时活动栏与侧栏松手才相连：相连按已落账的宽度判断，改为拖动中已拉出的部件按有宽度算；`ui/workbench-shell.md` 输出 38 补一句（`4b57e56b1`）。
  - “移动到”菜单被选中的行盖住：t86 给行容器的 `z-index: 1` 越出了树，树改为自成层叠上下文（`5c22c4ec1`）。
- 评审板第一轮（[review](artifacts/review/index.html) v1）：输入框样式、选中与关掉文件之后、悬停滚动条与标题动作的范围三道题，等开发者答。

## 下一步

等评审板的答复，定了以后写计划与 Spec，再实施。
