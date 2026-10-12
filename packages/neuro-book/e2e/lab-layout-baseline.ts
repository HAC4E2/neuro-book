/**
 * Lab 版面门禁（docs/specs/ui/component-lab.md 验收 27，`lab-scenes.e2e.ts`）的已知问题基线：按“组件/场景”记每类问题的个数。
 * 问题写成“类型 所属组件”，不用选择器：选择器里有自动生成的 id，换个挂载顺序就变。
 *
 * 门禁对比基线多出来的失败，对比基线少了的也失败：修好一处就把这里改小或删掉，基线只会变短。
 *
 * 2026-10-12 门禁开启时记下（手机画布）：
 * - 聚焦光晕被裁：控件贴着会裁切的条或面板的边（横向滚动的标签条、`overflow: hidden` 的工具条与状态栏），键盘聚焦时环的
 *   实色部分被切成平边，逐个聚焦截图对照属实；
 * - `Collapsible`、`CollapsibleSection` 展开时的 6px：展开内容用 `margin: -6px; padding: 6px` 给里面的焦点环留余量，外框
 *   比舞台宽 6px，看不出来，只在会横向滚动的父容器里多出 6px 可滚动距离。
 * 清理在 w00017 t78：nb-ui 的标签、折叠面板标题行改内嵌焦点线，折叠内容只在动画进行中裁切；剩下的是工作台与编辑器的部件。
 */
export const LAB_LAYOUT_BASELINE: Readonly<Record<string, Readonly<Record<string, number>>>> = {
    "EditorArea/english": {"光晕被裁 EditorTabBar": 2},
    "EditorArea/live": {"光晕被裁 EditorTabBar": 2},
    "EditorArea/split": {"光晕被裁 EditorTabBar": 4},
    "EditorTabBar/many": {"光晕被裁 EditorTabBar": 18},
    "EditorTabBar/mixed": {"光晕被裁 EditorTabBar": 3},
    "EditorTabBar/single": {"光晕被裁 EditorTabBar": 1},
    "WorkbenchActivityBar/default": {"光晕被裁 IconButton": 1},
    "WorkbenchActivityBar/sidebar-hidden": {"光晕被裁 IconButton": 1},
    "WorkbenchItemStrip/editor": {"光晕被裁 Button": 1},
    "WorkbenchItemStrip/many": {"光晕被裁 Button": 2},
    "WorkbenchItemStrip/states": {"光晕被裁 Button": 2},
    "WorkbenchPanelSurface/collapsed": {"光晕被裁 IconButton": 5},
    "WorkbenchPanelSurface/default": {"光晕被裁 IconButton": 5},
    "WorkbenchPanelSurface/long-title": {"光晕被裁 IconButton": 5},
    "WorkbenchPanelSurface/side": {"光晕被裁 IconButton": 3},
    "WorkbenchShellLayout/collapsed": {"光晕被裁 Button": 1},
    "WorkbenchShellLayout/views": {"光晕被裁 FormInput": 1, "光晕被裁 IconButton": 7, "光晕被裁 WorkbenchToolPartHost": 1},
    "WorkbenchShellLayout/views-merged": {"光晕被裁 FormInput": 1, "光晕被裁 IconButton": 9, "光晕被裁 WorkbenchViewSection": 2},
    "WorkbenchStatusBar/no-project": {"光晕被裁 Button": 1},
    "WorkbenchStatusBar/project": {"光晕被裁 Button": 1},
    "WorkbenchStatusBar/unread": {"光晕被裁 Button": 1},
    "WorkbenchStatusBar/unsaved": {"光晕被裁 Button": 3},
    "WorkbenchViewContainerHost/collapsed": {"光晕被裁 IconButton": 3, "光晕被裁 WorkbenchViewSection": 3},
    "WorkbenchViewContainerHost/horizontal": {"光晕被裁 IconButton": 3, "光晕被裁 WorkbenchViewSection": 3},
    "WorkbenchViewContainerHost/vertical": {"光晕被裁 IconButton": 3, "光晕被裁 WorkbenchViewSection": 3},
    "WorkbenchViewSection/collapsed": {"光晕被裁 IconButton": 1, "光晕被裁 WorkbenchViewSection": 1},
    "WorkbenchViewSection/horizontal-collapsed": {"光晕被裁 IconButton": 1, "光晕被裁 WorkbenchViewSection": 1},
    "WorkbenchViewSection/multiple": {"光晕被裁 IconButton": 2, "光晕被裁 WorkbenchViewSection": 1},
    "WorkbenchViewSection/short": {"光晕被裁 IconButton": 2, "光晕被裁 WorkbenchViewSection": 1},
};
