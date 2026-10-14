---
标签: ["state:local"]
---

# SessionConsole

会话页里一个会话的详情（t11）：屏幕末尾、输入框与按键。替开发者往这个会话里打字或按键：文字只在会话空闲时能发（不排队，也没有“工作中仍然发送”），按键在等确认时也能发（按键常用来回应确认界面）。屏幕是打开时与每次发送后各读一次的快照，不轮询（实时终端在 t12）；要确认的键（Enter、y、n、Esc、Ctrl+C、Shift+Tab）由页面先给出屏幕再确认。

## 布局

零件占满父容器剩下的高度（t15 阶段 4 第 3 批）：上面是屏幕，下面是贴底的输入区。会话的标题、状态、pane 等由页面的详情头给，零件里不再重复。

- 屏幕：`screen` 插槽（实时终端或手机的文字视图）；没有插槽时是屏幕快照，顶上一行“屏幕快照 · 读于 …”与“重读屏幕”，下面是等宽、保留空白的 `<pre>`，占满剩下的高度、超出滚动。
- 输入区（不随屏幕滚动）：`result` 插槽（投递结果）；同一格换了会话的提示；不能发时状态徽标加原因（工作中、等确认、审计不可用……）；两行输入框（最多 4000 字，字数在右边）与“发送 Ctrl+Enter”（Mac 上 ⌘+Enter），输入框里按这个组合键发送、Enter 换行、输入法组字时不发；再下面一排按键按钮（窄屏换行），要先看屏幕再发的键带“确认”标记，旁边一行小字说明。接管中输入框收起，写“直接在上面的终端里打字”。不可用时整块按钮禁用。

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
    /** 屏幕由 `screen` 插槽给（t12 的实时终端）：不显示快照、“屏幕读于”与“重读屏幕”；可选，默认 false */
    live?: boolean;
    /** 正在接管键盘（t12）：不给输入框（直接在终端里打），按钮单击即发（页面经终端连接发），按钮的 title 与 aria-label 改成接管中的说明；可选，默认 false */
    controlling?: boolean;
    /** 同一格 pane 换了会话、草稿留着时输入框上方的一行提示（发出去会发给新会话，t15）；可选，默认 null */
    sessionChange?: string | null;
}
interface SessionConsoleEmits {
    (event: "refresh"): void;
    /** 发送输入框里的文字（已去掉首尾空白之外原样） */
    (event: "prompt", text: string): void;
    /** 按了一个键：`up`、`down`、`shift+tab`、`enter`、`esc`、`ctrl+c`、`y`、`n` */
    (event: "key", key: string): void;
}
```

输入框的草稿是零件自己的（`state:local`），`resetKey` 变了清空。会话页的宿主按 pane 记草稿（t15）：换 pane 时、给同一格（pane 加终端，不管会话）发送成功后才加 `resetKey`；同一格换会话（`/compact`、`/clear`）时不加，改给 `sessionChange`。宿主不给本零件加 key：插槽里是实时终端，按会话重建本零件会连带重建终端。插槽 `screen`：替换屏幕快照（t12 放实时终端或手机的文字视图），缺省是快照的 `<pre>`；插槽 `result`：输入区最上面，放投递结果（会话页放 `WriteResult`），贴在输入框旁边，发完不用往上找。没有 expose。

## 不支持

- 不排队、不在会话工作时发文字；`blocked` 时只给按键。
- 不发任意键名：只有上面八个按钮。y、n 能不能回答 Claude 的确认界面还没有核实（docs/herdr.md）。
