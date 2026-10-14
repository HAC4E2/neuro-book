---
标签: [env:timer]
别名: ["看板娘", "心情猫"]
---

# NeuroBookMood

看板娘（品牌标志里那只读书的猫）的心情组件，包一层品牌成品导出的原生自定义元素 `<neurobook-mood>`（来源见同目录 `README.md`）。十一种心情各有循环动画，换心情时播切换动画，空闲时跟着鼠标看；系统设了减少动画时都不动。

## 布局

元素是一个正方形的赤红底块（`variant="tile"`，默认）或透明底（`variant="dark"`，放深色背景上）；大小由使用方用 `width` 给，宽高相等。

## 数据

```ts
type Props = {
    state: "focus" | "think" | "write" | "done" | "ask" | "error" | "idle" | "sleep" | "idea" | "shy" | "shy_more";
    variant?: "tile" | "dark";
    /** 停掉循环动画。 */
    paused?: boolean;
};
```

没有事件。

## 状态与边界

环境没有 Web Animations API（`Element.prototype.animate`、`getAnimations`；基线浏览器都有，happy-dom 这类测试环境没有）时不挂成品元素，画一个不动的标志（赤红底块上的猫；`dark` 变体为象牙色），带 `data-mood` 记当前状态。

## 隐藏通道理由

`env:timer`：循环动画与空闲时跟随鼠标由成品里的脚本用自己的计时器驱动，Lab 里的检查器看不到它的内部状态；成品脚本不要手改，改动画去品牌工具里改再导出。
