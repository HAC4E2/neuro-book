---
标签: [state:local]
别名: ["设置的通用控件", "Settings Control"]
---

# SettingsControl

设置窗口通用列表里的一个控件（[`settings/settings-window.md`](../../../../../../../docs/specs/settings/settings-window.md) 输出 9）：按窗口替配置项选好的控件描述（`setting-controls.ts` 的 `SettingControl`）画开关、分段、下拉、数字框、单行输入，或只读显示画不了的值。它放在 [`SettingsRow`](../../../../ui/settings/SettingsRow.md) 的插槽里，值与停用由行给出，改值交给设置窗口去写。

和直接用 nb-ui 控件的区别：宽度按控件种类固定（下拉 220px、数字框 120px、单行输入 320px，都不超过行宽；分段按选项名给足宽度，开关原样）；输入类控件编辑时保留草稿，离开或回车才提交，提交的值没被接受时回到传入的值。

## 布局

单个控件，`inline-flex`，宽度见上；只读显示另起一行占满（由行的宽排法给），一行“只能在设置文件里改”的说明加等宽字体的值摘要，长值换行。分段控件的宽度按最长的选项名估出来再乘以段数，各段等宽（nb-ui 的分段控件宽度随内容时会截断长选项，见 w00017 t81），估的是 `--text-xs` 的字宽，汉字按一个字宽、拉丁字母按约六成。

## 交互

- 开关、分段、下拉：选了就发 `update:modelValue`。
- 数字框、单行输入：输入只改草稿；失去焦点（焦点离开整个控件，点步进按钮不算）或按回车时，草稿与传入的值不同才发 `update:modelValue`；数字框里能解析成有限数的发数字，不能解析的原样发出文字，空白不发、回到传入的值。传入的值变了（写入结算、别处改了）草稿跟着换。
- 停用：控件不响应；只读显示没有可操作的东西。
- 可访问名称：开关与分段用 `label`；输入框与下拉的触发器用 `id` 与行里的标题关联。

## 数据

```ts
import type {DisplayLocale} from "nbook/shared/localized-text";
import type {SettingControl} from "../setting-controls";

type Props = {
    /** 控件描述；必填。 */
    control: SettingControl;
    /** 当前显示的值（层里的值或正在写入的值）；受控。 */
    modelValue: unknown;
    /** 缺省 false。 */
    disabled?: boolean;
    /** 能与标签关联的控件的 id；缺省不设。 */
    id?: string;
    /** 可访问名称（配置项标题）；必填。 */
    label: string;
    locale: DisplayLocale;
};

type Emits = {
    /** 要写入的新值。 */
    (event: "update:modelValue", value: unknown): void;
};
```

没有 slots、expose；attrs 落在根上，根带 `data-settings-control`（控件种类）。

## 不支持

- 多行文本、JSON、列表的编辑：画不了的类型只读显示。
- 单位后缀、带候选的输入。
- 校验与报错：值不合 schema 由写入路径拒绝，设置窗口发通知。
