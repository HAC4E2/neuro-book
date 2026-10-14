---
标签: []
别名: ["品牌字标", "NeuroBook 标志"]
---

# NeuroBookLockup

NeuroBook 的标志 + 字标横排（品牌成品，来源见同目录 `README.md`）。用在书房的标题栏、以后的关于页与启动页。

## 布局

一个行内块，高度默认 `1em`，使用方用 `height` 或 `font-size` 定大小，宽度按成品比例（约 5.7 : 1）跟随。成品 SVG 作为 CSS 遮罩、以 `currentColor` 填色：放在什么颜色的文字旁就是什么颜色，深色主题下自然反白。

## 数据

没有 props 与事件；根节点带 `role="img"` 与 `aria-label="NeuroBook"`。

## 不支持

不提供彩色版（赤红底块的应用图标版）；需要时另加组件，不在这里加 prop。
