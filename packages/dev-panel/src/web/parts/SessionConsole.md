---
标签: ["state:local"]
---

# SessionConsole

会话页里一个会话的详情（t11）：屏幕末尾、输入框与按键。替开发者往这个会话里打字或按键：文字只在会话空闲时能发（不排队，也没有“工作中仍然发送”），按键在等确认时也能发（按键常用来回应确认界面）。屏幕是打开时与每次发送后各读一次的快照，不轮询（实时终端在 t12）；要确认的键（Enter、y、n、Esc、Ctrl+C、Shift+Tab）由页面先给出屏幕再确认。

## 布局

上面是一行会话信息（短名、pane、状态）与“重读屏幕”按钮；中间是屏幕末尾（等宽、保留空白，最多约 24 行高，超出滚动）；下面是输入框（4 行，最多 4000 字，字数在右下）与“发送”，再下面是一排按键按钮（窄屏换行）。不可用时整块按钮禁用，并在输入框上方写原因。

## 数据

```ts
interface SessionConsoleProps {
    /** 这个会话：会话键、pane、Agent、herdr 状态；必填 */
    session: {sessionKey: string; paneId: string; agent: string | null; status: string};
    /** 屏幕末尾；必填，null 时写“还没读到屏幕” */
    screen: string | null;
    /** 屏幕读到的时刻（ISO）；必填，可为 null */
    screenAt: string | null;
    /** 整块不可用的原因（审计没初始化、herdr 不可用）；必填，null 表示可用 */
    disabledReason: string | null;
    /** 有请求在途（读屏、发文字、发按键）；必填 */
    pending: boolean;
    /** 变了就清空输入框（发送成功后页面加一）；必填 */
    resetKey: number;
}
interface SessionConsoleEmits {
    (event: "refresh"): void;
    /** 发送输入框里的文字（已去掉首尾空白之外原样） */
    (event: "prompt", text: string): void;
    /** 按了一个键：`up`、`down`、`shift+tab`、`enter`、`esc`、`ctrl+c`、`y`、`n` */
    (event: "key", key: string): void;
}
```

输入框的草稿是零件自己的（`state:local`），`resetKey` 变了清空。没有插槽与 expose。

## 不支持

- 不排队、不在会话工作时发文字；`blocked` 时只给按键。
- 不发任意键名：只有上面八个按钮。y、n 能不能回答 Claude 的确认界面还没有核实（docs/herdr.md）。
