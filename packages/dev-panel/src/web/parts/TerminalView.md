---
标签: ["state:local", "env:timer"]
---

# TerminalView

会话的实时终端（t12）：用 xterm.js 画 herdr 终端流的帧，观看时只读，接管时把键盘原样交给会话。帧由页面经 `source` 交进来（页面管连接与心跳，见 `host/terminal-socket.ts`）；零件只画、只发意图（接管、释放、输入、尺寸）。终端块一律暗色，颜色在运行时从 nb-ui 的暗色配色读，不写字面颜色；nb-ui 没有的 ANSI 色（品红、亮色等）用 xterm.js 的缺省值。

字体：xterm 用 canvas 量字宽，canvas 不认 CSS 变量，字体串里有 `var()` 就整串作废、格宽退回 `10px sans-serif`（字被撑开、缩放失效）。所以挂载时读 `--font-mono` 的计算值拼成具体的字体串（`host/terminal-font.ts`），canvas 仍不接受时换成缺省的等宽字体；同时量出格宽与字号之比，观看时按它缩字号。

## 布局

上面一条状态条，下面是终端。

- 观看：“观看中：只读的实时画面，键盘在别处”，右边“接管键盘”（`canTakeover` 为假时不给，写原因）。字号按容器宽度、帧的列数与量出的格宽缩放，5 到 14px（手机的终端画面也尽量放下整屏），容器尺寸变了就重算；再窄就在终端框里横向滚动；高度随行数。
- 接管：“你已接管键盘：按键原样发给会话；终端按网页尺寸 C×R；切到别的标签页或离开会自动释放”，右边“释放”；下面一行小字写浏览器拦得住与拦不住的键。字号固定 13px，终端框高 70% 视口（至少 16rem），容器尺寸变了（去抖 150 毫秒）就按新的列数与行数发 `resize`。
- 点“接管键盘”时发出的 `takeover` 尺寸按接管后的样子量：框临时套上接管时的高度、字号换成 13px，量完同步改回，接上之后不必再改一次尺寸。量这个尺寸与接管中窗口变化时，都先把框的溢出藏起来：框里还是旧尺寸的画面（例如从更大的窗口“抢过来”）时会出滚动条，桌面浏览器的滚动条占位，把内容区挤掉一行几列，接上之后滚动条消失、又会 resize 一次（无头 Chrome 缺省不画滚动条，验收时要带上它才看得出）。
- 尺寸读不到时状态条加一句“尺寸不确定，可能裁切”。

## 交互

- 接管期间键盘输入原样发出（`input`）；粘贴先清洗（去掉 Esc 等控制字符、换行转 `\r`），`bracketedPaste` 为真时在 xterm 本地打开 bracketed paste，粘贴被 `\e[200~ … \e[201~` 包住（实测 Claude、omp 都开着它；帧里不带应用的终端模式）。
- Ctrl+C：有选中的文字时交给浏览器复制，不发；没有时发 `\x03`。Ctrl+W、Ctrl+T、Ctrl+N 浏览器拦不住，提示用 Alt+Backspace 删词。
- 帧里的超链接（OSC 8）只放行 `http`、`https`，点了发 `open-link`，由页面在新标签页打开。
- 不做鼠标事件（要 herdr server 0.9.2 以上）。

## 数据

```ts
interface TerminalViewProps {
    /** 帧的来源（页面的终端连接）；必填 */
    source: TerminalSource;
    /** 观看还是接管；必填、受控 */
    mode: "watch" | "control";
    /** 服务端给的尺寸（接管时是网页的尺寸）与是否读到了真实尺寸；必填 */
    cols: number;
    rows: number;
    sizeKnown: boolean;
    /** 这个 pane 的应用开着 bracketed paste（Claude、omp）；必填 */
    bracketedPaste: boolean;
    /** 能不能接管（手机上不给）；为 false 时用 `takeoverBlocked` 写原因；必填 */
    canTakeover: boolean;
    takeoverBlocked: string | null;
    /** 另一个浏览器正在接管时的说明；可选，默认 null */
    controllerNote?: string | null;
    /** 接管或释放的请求在途；可选，默认 false */
    pending?: boolean;
}
interface TerminalViewEmits {
    /** 点了“接管键盘”：按 13px 字号算出的列数与行数 */
    (event: "takeover", cols: number, rows: number): void;
    (event: "release"): void;
    /** 接管时的键盘输入；`paste` 为真表示是一次粘贴 */
    (event: "input", data: string, paste: boolean): void;
    (event: "resize", cols: number, rows: number): void;
    (event: "open-link", url: string): void;
}
```

xterm 实例是零件自己的（`state:local`），容器尺寸变了的去抖用定时器（`env:timer`），卸载时一起销毁。没有插槽与 expose。
