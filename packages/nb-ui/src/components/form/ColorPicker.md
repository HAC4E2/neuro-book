---
标签: [state:local, state:inject, env:portal]
---

# ColorPicker

`ColorPicker` 是一个显示当前颜色的触发器，点开是取色面板：在饱和度与明度面上拖、在色相条上拖、直接输入颜色值，或点预设色。它适合需要任意取色的地方；只从几种推荐色里挑时用 `ColorSwatches`，它的“自定义”打开的也是这块面板。

## 布局

触发器：一个小色块加小写的颜色值，控件档的圆角、描边与底色；缺省 `md` 高度，另有紧凑的 `sm`。

面板在触发器下方弹出，宽 216px，从上到下：

- 饱和度与明度面（140px 高）：横向从白到当前色相的纯色，纵向往下变黑；圆形滑块显示当前颜色。
- 色相条：一条彩虹渐变，圆形滑块。
- 一行：当前颜色的小方块，加颜色值输入框。
- 预设色板（`swatches` 非空时）：六列小方块，分隔线隔开；当前颜色等于某个预设色时它带选中环。

两个滑块都是白边加一圈细影，落在任何颜色上都看得见。面板与 `FormSelect` 的下拉同一种浮层面（材质、阴影、圆角与层级）。

## 交互

- 拖动面或色相条、用方向键移动滑块（键盘聚焦在滑块上时）都会立即发出新颜色；面板不关闭。
- 颜色值输入框接受十六进制、`rgb()`、`hsl()` 等写法，回车或失焦时生效；写错时恢复为当前颜色。
- 发出的值总是不带透明度的小写 `#rrggbb`，即使输入了带透明度的值。
- 明度或饱和度压到 0 时（黑、白、灰）面板记住原来的色相，再抬起来颜色不会跳到红色。
- 点预设色发出它；点当前已选的预设色不发事件。
- 点面板外面或按 Escape 关闭，焦点回到触发器。没有“完成”按钮。
- `disabled` 时触发器是禁用的按钮，打不开面板；`readonly` 时能打开查看，但拖动、输入与预设都不改值。

## 数据

```ts
interface ColorPickerProps {
    /** 当前颜色（CSS 颜色字符串）；受控，默认 undefined */
    modelValue?: string;
    /** modelValue 缺省时显示的颜色；默认 "#3b82f6"，不是组件内部会更新的初值 */
    defaultValue?: string;
    /** 禁用：打不开面板；默认 false */
    disabled?: boolean;
    /** 只读：能看不能改；默认 false */
    readonly?: boolean;
    /** 预设颜色；默认十二个常用色；传空数组不显示色板 */
    swatches?: string[];
    /** 触发器尺寸；默认 "md" */
    size?: "sm" | "md";
}

interface ColorPickerEmits {
    /** 取了新颜色：小写 #rrggbb。父组件应更新 modelValue */
    (event: "update:modelValue", value: string): void;
}
```

没有插槽与 expose。未声明的 attrs 按 Vue 默认继承到根（reka 的 `PopoverRoot`，不渲染元素），不要依赖它透传到触发器；触发器带 `data-color-picker-trigger`，面板带 `data-color-panel`。

## 不支持

不支持透明度、不支持吸管取屏幕颜色、不记最近用过的颜色。放在 `Dialog` 里时面板跟随窗口的浮层层级。
