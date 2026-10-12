---
schema: nbook.task/v2
taskId: t83-legacy-parity-dnd-titlebar
---

# 拖放与标题栏对照旧应用

## 目标与范围

开发者 2026-10-12 手动审查 t79 时提出，选择另开 Task，先调研出差距清单再定设计。未开工。

- **移动视图与容器**（开发者认为最严重）：旧应用有落点区域指示和动画，新应用不如它完善。已知：新应用的落点判定是从旧应用移植的（半区并入、插入线、空区域整区、键盘拖放，见 [`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 外壳三），落点预览也用同一个 nb-ui `DropFeedbackOverlay`；组件文档写明“没有放下动画”（`WorkbenchDragFeedback.md`）。其余差距要在浏览器里把两边同样的拖动逐个对比才能确定。旧应用入口：`packages/neuro-book-legacy/app/utils/workbench/workbench-drop.ts`、`app/composables/useWorkbenchDrag.ts`、`useWorkbenchDrop.ts`、`app/components/workbench/WorkbenchDragOverlay.vue`、`WorkbenchDropOverlay.vue`。
- **标题栏宽度自适应**：新标题栏有三档（至少 960px 完整菜单栏；600–959px 四组收进一个“菜单”按钮；不足 600px 再收起品牌文字、搜索只留图标）。旧应用（`app/components/desktop-title-bar/`）是两档带回差（800px 收、840px 展），另用容器查询把项目切换与命令中心逐级缩窄（860px、660px），紧凑菜单按组嵌套。开发者认为旧的更完善，具体差在哪个宽度与场景待调研时一起对比。
- **多级菜单**：nb-ui `Menubar`、`Dropdown` 都支持任意层级子菜单（`children`），现在的菜单模型（`titlebar/menu-model.ts`）没有用到，紧凑档按组分节而不是嵌套；旧应用用了多级菜单。

不含：菜单浮层的圆角与阴影（归 t79）。

## 下一步

开工时并排运行新旧应用，逐项录下拖放与标题栏在各宽度下的表现，列出差距清单交开发者定范围，再出设计稿与计划。
