# app 目录规则

修改 `app/**` 前读取 [`../docs/standards/code/common.md`](../docs/standards/code/common.md)、[`../docs/standards/code/languages/typescript.md`](../docs/standards/code/languages/typescript.md) 和 [`../docs/standards/code/frontend.md`](../docs/standards/code/frontend.md)。完成标准以 `frontend.md` 为准；本文件只补充 NeuroBook 前端的具体组件和主题入口。

- 这是 NeuroBook 当前根应用的前端目录；本轮不把它物理搬到 `packages/neuro-book`。

## 前端规范

- 通用组件优先复用 `app/components/common`：`NotificationViewport`、`Dialog`、`DialogWindow`、`Tooltip` 和 `form/FormColorField`。
- Novel IDE 普通界面颜色只消费 `app/utils/theme/README.md` 登记的主题变量，不新增 Tailwind 调色板或 `dark:` 变体；新增组件变量前确认现有变量无法表达，并同步登记到主题文档和 8 套内置主题。
- 状态色使用 `warning`（草稿/待审/未保存）、`success`（完成/已同步）、`danger`（错误/删除/冲突）、`info`（运行中/引用/说明）和 `accent`（选中/当前/主操作）。内容、编辑器和 chip 分类色是例外，不按状态色重写。
- World Engine 的 `--we-*` 只在 `app/styles/theme-vars.css` 的 `.world-engine-workbench-theme` 中映射；真实 Dialog 和 preview 使用该 class，不在局部样式反向覆盖全局变量。
- `ReferenceChip.vue` 只输出类别语义 class，外观统一在 `app/styles/reference-chips.css`；不要在 TipTap 或业务组件重复定义。
- 前端 API 错误使用 `resolveApiErrorMessage(error, fallback)`；跨入口、后台动作和完成后 Dialog 会关闭的反馈使用 `useNotification()`，当前表单可恢复的错误使用局部 `error` state。
- 可调整面板统一使用 `app/composables/useResizablePanel.ts`，尺寸由宿主保存，组件通过 `update:width` / `update:height` 回传。
- 用户可见文案面向第一次使用 NeuroBook 的普通作者，不出现内部类名、文件名、Task 或 Phase 编号。
