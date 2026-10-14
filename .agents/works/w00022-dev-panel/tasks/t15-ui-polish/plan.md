# t15 实施计划：面板界面打磨

编码子代理 2026-10-13 写，按[设计审查](evidences/design-review.txt)（0 阻断、7 重要、10 建议，全部采纳）改过一版。阶段 1 写细，阶段 2 到 4 写轮廓。下文“审查重要 1”“审查建议 5”等指设计审查报告的编号；“omp 重要 3”“ux-b F1”等指四份体验与代码审查报告的编号。设计审查的行号以它的“勘误（行号）”一节为准。

范围与决定以本目录的 [改动方案](design.md) 为准（含开发者定的 D1 到 D5）；任务见 [README](README.md)，开发者的试用建议见 [后续清单](../../followups.md)。依据的四份审查报告在本地 `.local/agent/works/w00022-dev-panel/tasks/t15-ui-polish/reports/`（`omp-frontend-review.md`、`ux-a.md`、`ux-b.md`、`ux-c.md`），截图在同目录的 `shots/`。

执行位置：集成分支 `feat/w00022-dev-panel`（worktree `.worktree/w00022-dev-panel`），已快进到 master `8a1a2a105`。四份审查的基线是 `5cf816f1c`，此后 `packages/dev-panel/src/web/` 没有改动，报告里的行号仍然对得上。

## 计划前的核实（2026-10-13，只读）

- **四份报告的代码结论逐条按源码核对过**，结果写在阶段 1 各条的“根因”里。omp 有三处需要补充或修正：会话页的接管确认也没绑定目标，omp 没列出；文字发送有屏幕摘要挡着，只有按键完全没有保护；编辑页在途的保存回包也会写进新文件的草稿。设计审查另补出一处同类错位（页面实例随路由参数复用，见 1.9）。
- **xterm 6.0.0 的滚动条**：在 4490 的审查面板上实测（1440×900，`?pane=w4:p1`），ux-c 与 omp 说的各对一半：
  - `.xterm-viewport` 还在，是一个没有子节点的空 div。xterm.css 给了它 `overflow-y: scroll`，所以有一条 15px 的原生轨道（`offsetWidth` 1064、`clientWidth` 1049）。这就是 ux-c 量到的“恒占 15px”；
  - 真正滚动的是 xterm 自绘的 `.xterm-scrollable-element > .scrollbar.vertical`（宽 14px，不滚时带 `invisible` 类）。这是 omp 说的自绘条，颜色走 `ITheme` 的 `scrollbarSlider*`；
  - 两者都不改终端的测量：列数按 `.xterm` 的父元素量。现在 `scrollback: 0`，自绘条从不出现。

  因此阶段 2 的做法是：空 viewport 的原生轨道直接藏掉（`scrollbar-width: none`）；自绘条用 xterm 的主题色。D2 给终端加回滚之后要再实测一次，见“要先实测才能定的问题”。
- **Task 页正文右边的空白**（开发者第 2 条、ux-a S5）：按代码与截图核实成立。`app.css` 给 `.nbdev-markdown` 限了 `max-width: var(--reading-measure, 72ch)`，外面的卡片却随 `minmax(0,1fr)` 撑满。1440 宽时卡片约 740px、正文约 600px，屏幕越宽空白越多。文档页同理。阶段 3、4 改，见阶段 4 的“Task 页”。
- **产物页显示已答的内容**：不需要改服务端。`/api/artifact/...` 已经返回 `answers`（每份答复的值、时间、版本）与每题的 `answer`，`QuestionPanel` 也有折叠的“已答 N”。ux-b F4 看到空白，是因为 t11-notify/questions 的题已在后来的版本里取代，当前版本没有“已答”状态的题。界面加一段“提交过的答复”（按 `answers` 列出）就够，阶段 4 做。
- **首页按产物合并提问**：不需要改服务端。`overview.inbox` 的每条提问带 `workId`、`taskId`、`artifactId`，前端分组即可。

## 阶段 1：行为缺陷（不改外观）

omp 的阻断 1 与重要 3 到 9，加上设计审查补的“页面按路由参数重建”与新建页的模式切换，共十片（1.0 是测试环境）。阻断那一条会向错误的会话发按键，开发者正在用面板，所以这一阶段先做、先合入。只改行为，不改布局与样式；新出的提示先用现有的 `WriteNotice`、`LoadState`，阶段 3 再换成统一的反馈零件。

### 共同做法

**宿主逻辑收进组合函数。** 身份错位都出在页面里的异步状态迁移上，这些逻辑现在写在 `.vue` 的 `<script setup>` 里，测不到。改为收进 `src/web/host/` 下的普通 `.ts` 组合函数，页面只做接线：

- `host/session-console.ts`：`useSessionConsoleHost`。管会话页“当前目标”的身份、终端连接的作用域、读屏与读更早的输出、发文字、发按键、两步确认、接管小窗；
- `host/file-edit-session.ts`：`useFileEditSession`。管编辑页的路径身份、基线与草稿、保存、冲突与结果未知；
- `host/panel-data.ts`、`host/api.ts`、`host/terminal-socket.ts`：原地改。

组合函数不碰 `vue-router`、`window.matchMedia`、DOM。路由守卫、窄屏判断、模板仍在页面里；页面把 `selected`、`path` 这类响应式输入传进去。

**数据宿主要有产品里也用的收口入口**（审查重要 4）。`panel-data.ts` 是模块级单例：一条 `/ws`、订阅表、重连定时器、`started` 标志。现在重连定时器没存下来，也没有停止的办法。加 `stopPanelData()`：关掉 `/ws`、清掉重连定时器、复位 `started` 与重连计数、复位 `panelState`。外壳卸载时调它；登录失效时走同一套关连接与清定时器的逻辑（1.5）。测试在每个用例结束时也用它收口，不另加测试专用的复位导出。

**测试方法：bun test，加 Vue 真实的响应式与 `effectScope`。**

- 文件放在包的 `tests/` 下、以 `web-` 开头，例如 `tests/web-session-console.test.ts`，与现有的 `tests/terminal-input.test.ts` 一样直接导入 `src/web/host/*.ts`。
- **隔离运行**：bun test 默认所有测试文件共用一个模块注册表，`panel-data.ts` 的单例与遗留的定时器会串到别的文件（审查重要 4 用实验复现过）。包的 `test` 脚本改成 `bun test --isolate`（每个文件一份全局对象与模块注册表）。实施时先量全量耗时；明显变慢就只让 `tests/web-*.test.ts` 单独一段 `--isolate`，其余照旧。同一个文件里的用例之间，靠 `stopPanelData()` 与 `afterEach` 拆环境收口。
- 新增一个测试用的环境文件 `tests/web-env.ts`，用 `afterEach` 拆除，失败时也拆：
  - `globalThis.fetch`：记下每个请求，按用例给的表回外壳，可以挂起、延迟、回 401 或 503；
  - 假的 `WebSocket` 类：带 `CONNECTING`、`OPEN`、`CLOSING`、`CLOSED` 静态常量与 `readyState`（`terminal-socket.ts` 用 `WebSocket.OPEN` 判断能不能发）；记下实例；用例可以推消息、触发 `open` 与 `close`；
  - 最小的 `document`（`visibilityState`、`addEventListener`、给 CSRF 用的 `querySelector`）、`window`（`addEventListener`、`pagehide`）、`location`、`localStorage`。
  - **装的顺序**：vue 的 runtime-dom 在模块求值时就调 `document.createElement`，所以测试文件先静态导入 vue 与被测模块，环境只在用例里装（审查重要 4 第 3 点）。`web-env.ts` 的文件注释写明这条。
- 用例在 `effectScope().run(...)` 里调组合函数，改输入的 `ref`，`await nextTick()` 或等请求落定，再断言发出的请求与状态；结束时 `scope.stop()`、`stopPanelData()`。
- **测的是真实的那段代码**：被测的就是页面运行时调用的组合函数，以及它真实导入的 `api.ts`、`panel-data.ts`、`terminal-socket.ts`。替换掉的只有浏览器全局对象与服务端。没有测试专用的分支或导出，组合函数也不为测试加注入参数。
- **测不到的部分**：
  - 页面模板的接线：`:key` 放在哪一层、把 `readonly` 绑到编辑器、在哪里显示提示；
  - 真实 DOM、xterm 的渲染、真实的路由守卫与确认框。

  这些由浏览器验收覆盖，各条写明。审查重要 1 那类“key 放错层、连带重建插槽”的错误单元测试测不到，所以“接管中换会话 id”“同一终端换会话不重建终端”都写成了验收场景。

**浏览器验收：在 4490 上做。**
- 面板由集成分支的代码在同一个克隆上起，**必须沿用原来那份环境**，否则接管与按键的审计会写进开发者真实的 `~/.config/nbdev/audit.jsonl`：

  ```
  cd /dev/shm/nbdev-ui-review/repo && exec env -i HOME=$HOME PATH=$PATH TERM=xterm-256color LANG=en_GB.UTF-8 XDG_CONFIG_HOME=/dev/shm/nbdev-ui-review/xdg GH_CONFIG_DIR=$HOME/.config/gh HERDR_SOCKET_PATH=$HOME/.config/herdr/sessions/nbdev-ui-review/herdr.sock NBDEV_HERDR_BIN=/home/notnotype/.local/bin/herdr NBDEV_GH_BIN=/home/notnotype/.local/bin/gh NBDEV_GH_PREFIX=prox /usr/bin/bun <worktree>/packages/dev-panel/src/cli.ts panel serve --port 4490 --artifact-port 4491 > /dev/shm/nbdev-ui-review/logs/panel.log 2>&1
  ```

  用后台机制运行、记下 PID，验收完 SIGTERM 停掉。不加 `--no-build`，面板把集成分支的前端构建进 worktree 自己的 `dist/web`。登录用 review-env.md 的命令，`cli.ts` 换成 worktree 里的路径。
- Playwright 驱动本机 Chrome，去掉 `--hide-scrollbars`；同一时间只开一个浏览器，`TMPDIR` 与用户数据放 `/dev/shm`，用完删掉；脚本与截图放本地 `.local/agent/works/w00022-dev-panel/tasks/t15-ui-polish/accept/`。
- **造历史用路由的 push**（审查重要 3）：会话页选会话用的是 `router.replace`，站内也没有带 `?pane=` 的链接；从 Task 页进编辑页只造出 [Task 页, 编辑页]。所以需要“同一路由、相邻两条历史”的场景，一律经 `document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(...)` 依次 push，每步等页面就绪再继续。这只用于驱动验收。后退之后先断言 URL 与页面仍是预期的那一页，再断言要测的行为。原生确认框的 `page.on('dialog')` 要在 `goBack()` 之前挂上。
- **对命名会话 `nbdev-ui-review` 的 herdr 写调用已获同意**：再起一格假 Claude、改会话 id、往格里发按键。一律写成 `env -i HOME=$HOME PATH=$PATH TERM=xterm-256color /home/notnotype/.local/bin/herdr --session nbdev-ui-review …`。
  - 现有那格假 Claude 是 `w4:p1`，用 `/dev/shm/nbdev-ui-review/fake/`；第二格另建 `/dev/shm/nbdev-ui-review/fake2/`，屏幕上写不同的标记。
  - 让新的一格成为 Claude 会话要用 `pane report-agent … --source herdr:claude --agent claude --agent-session-id <id>`（docs/herdr.md 的“会话身份”一节），单独 `report-agent-session` 不会进 agent.list。
  - 做完把多起的那一格关掉；记录里写明用过哪几条命令。默认 herdr 只做只读调用。
- 判断“有没有发出去”看三处：假 Claude 的输入日志（`fake/tui.log`、`fake2/tui.log`）、审计（`/dev/shm/nbdev-ui-review/xdg/nbdev/audit.jsonl`）、Playwright 记下的请求。
- 要靠推送触发重取的场景，改记录里有、页面上看得见的字段：Work 的目标（README 的“目标”一节或第一段，WorkCard 与 Work 页都显示它）。只改 README 的其它正文不进记录的指纹，不会推送（审查建议 3）。

### 1.0 测试环境与数据宿主的收口入口

- `tests/web-env.ts`（见共同做法）与一条冒烟用例；
- `panel-data.ts` 加 `stopPanelData()`，存下重连定时器；外壳 `App.vue` 卸载时调用；
- 包的 `test` 脚本加 `--isolate`（按实测定是全量还是只对 `web-` 一段）。

测试：`startPanelData()` 建一条假连接，`stopPanelData()` 之后连接已关、等过最短重连间隔（1 秒）没有新连接；再 `startPanelData()` 能重新建连。

### 1.1 阻断 1：会话页的两步确认没有绑定目标

**根因（核实成立，补两处）。**
- `SessionsPage.vue` 的 `sendPrompt`、`sendKey` 在执行时才读 `selected.value`。
- 两步确认存的回调是 `() => sendKey(key, true)`、`() => sendPrompt(text, digest)`，确认那一刻发给的是“现在选中的”，`expectedSession` 也取现在的，服务端的会话核对拦不住。
- 选中目标会在确认框打开期间变：
  - 推送更新了 `sessions`，这格 pane 换了会话（`/clear`、`--resume`、`/compact`）；
  - 用浏览器后退改了 `?pane=`；
  - 这格 pane 消失了。
- `pressKey` 先 `await readScreen()` 再开确认框，这段等待里目标变了也不查；确认框显示的屏幕可能已经属于别的会话，或者是空的。
- 补充一：**按键完全没有保护**。文字那一支有屏幕摘要挡着：服务端对新目标重新判定，摘要对不上就不发。只有新目标的判定原因与屏幕末尾都恰好相同时才会误发（例如同一格 `/clear` 之后屏幕一样）。
- 补充二：**接管确认同样没绑定目标**，omp 没列出。`confirmTakeover` 也在确认时读 `selected.value.sessionKey` 与 `terminal.value`，目标换了就接管新会话。服务端回 `need_confirm` 时开的“抢过来”小窗同样现读 `terminal` 与尺寸。
- 补充三（审查建议 4）：给 A 的发送在途时切到 B，A 的回包照样把 `resetKey` 加一，清掉开发者刚给 B 打的字。
- 通知的发送（`notify-actions.ts` 的 `deliver`）在确认回调里带着 `job` 与 `target`，已经绑定，不受影响。

**改法。**
- `useSessionConsoleHost({selected, terminalAvailable})`：
  - 目标身份记为 `{paneId, terminalId, sessionKey}`；
  - `sendPrompt(target, text, confirmScreen)`、`sendKey(target, key, confirmed)` 都显式带目标；
  - 确认框存一份 `{target, kind, ...}`。`confirmRun` 先比对目标是否与当前选中一致（三项都比），不一致就不发，给一条警告：“确认框打开期间目标变了（A → B），没有发送”。
- `watch` 目标身份，一变就：
  - 关掉会话页自己的确认框与接管小窗；
  - 清掉 `lastConflict`、屏幕、更早的输出与提示；
  - 作废在途的读屏与读历史：带序号，回来时三项身份都对上才写，不再只比 `paneId`。
- `pressKey` 在 `await readScreen()` 之后先核对目标没变，再开确认框，屏幕取这次读到的。
- 接管小窗记下发起时的目标；`need_confirm` 打开的“抢过来”小窗沿用发起接管时记下的目标与尺寸；确认时目标变了就不接管、给同样的提示。
- **输入框草稿按 pane 记**（决定点 2 的终稿）：
  - 换 pane 时经 `SessionConsole` 已有的 `resetKey` 清空；
  - 同一格换会话（`/compact`、`/clear`）时保留草稿，在输入框上方给一行“这格的会话换了（A → B），发出去会发给 B”；
  - 发送的回包只在目标仍等于当前选中时才加 `resetKey`；
  - 不给 `SessionConsole` 加 key：它的插槽里是实时终端，加 key 会连带重建终端（审查重要 1）。
- 会话页的确认改用组合函数自己的 `confirm`，不再借 `notifyActions.confirm`（通知那份留给通知）；页面上的 `ScreenConfirmDialog` 显示两者中开着的那一个。服务端的 `expectedSession` 照旧保留：客户端把目标绑在打开时之后，它仍能挡住“面板还没轮询到会话已换”的窗口。

**文件与文档。**
- `src/web/host/session-console.ts`（新）、`src/web/pages/SessionsPage.vue`、`src/web/host/notify-actions.ts`（只在需要时把 `ScreenConfirm` 类型导出给会话页复用）；
- `parts/ScreenConfirmDialog.md`、`parts/TakeoverDialog.md`：写明“确认针对打开时的目标，目标变了宿主会关掉它”；`parts/SessionConsole.md`：`resetKey` 由宿主在换 pane 时加一、同一格换会话时保留草稿，以及“会话换了”那一行的 prop；
- `docs/panel.md`：“通知与会话页”的两步确认一段加上“确认绑定打开时的目标（pane、终端、会话），目标变了自动取消并提示；输入框的草稿按 pane 保留”。

**测试（`tests/web-session-console.test.ts`）。**
- 选中 A，按 Enter 开确认（假 fetch 先回 A 的屏幕）→ 把 `selected` 改成同一 pane 的会话 B → `confirmRun()`：断言没有发出 `/keys` 请求，确认框关了，有“目标变了”的提示；
- 同一流程换成另一格 pane：断言同上；
- 文字的“仍然发送”：目标变了不发；
- 读屏挂起期间目标变了：回来的屏幕不写进状态，也不开确认框；
- 接管小窗打开期间目标变了：确认不调用接管；`need_confirm` 之后目标变了：“抢过来”不发出；
- 给 A 的发送在途时换到 B：A 的回包不加 `resetKey`；同一格换会话：`resetKey` 不变，“会话换了”那一行出现；
- 正常路径：目标不变时确认照常发出，请求里的 `paneId`、`expectedSession` 是打开时的那个。

**浏览器验收。**
- 需要两格 Agent 会话 A（`w4:p1`）与 B（新起的一格）。
- 场景一（换 pane）：用路由 push 依次打开 `?pane=B`、`?pane=A`，按 Enter，确认框出现后 `page.goBack()`。先断言 URL 是 `?pane=B`、仍在会话页；再断言确认框关闭、出现“目标变了”的提示；A、B 的假 Claude 日志都没有新的 `\r`；审计没有新的 `keys` 行。
- 场景二（同一格换会话）：打开 A，按 Esc 开确认框，对 A 运行 `pane report-agent-session` 换一个会话 id，等面板的轮询发现（有浏览器连着时 500 毫秒）。断言同上。
- 场景三（接管）：开“接管键盘”小窗，同样用场景一的办法换 pane。断言没有接管：审计没有 `takeover` 行，终端仍是“观看中”。
- 场景四（草稿）：在 A 的输入框打几个字，对 A 换会话 id：字还在、出现“这格的会话换了”；再换到 B：输入框空了。

### 1.2 omp 重要 3：换终端之后零件不重新订阅

**根因（核实成立）。**
- `TerminalView`、`TerminalTextView` 只在 `onMounted` 里 `source.subscribe`，没有 `watch`。
- 页面换目标时在同一个 `watch` 回调里先置 `null` 再赋新的 `terminal`，Vue 在同一轮里合并渲染，`v-if` 两次都为真，零件实例原地复用，只换了 `source` prop。
- 结果：画面停在旧终端，输入、resize、接管却经 `terminal.value` 发给新终端。

**改法。**
- 终端连接的作用域挪进 `useSessionConsoleHost`：每建一条连接（换 `paneId + terminalId`，或 1.5 的重新登录之后重建）就把一个连接序号加一。
- 页面给 `TerminalView`、`TerminalTextView` 加 `:key="连接序号"`。key 与 `source` 对象的生命期一一对应，“`source` 在实例的一生里不变”由构造保证，不另写 `watch`（决定点 3）。同一格换会话时连接不变，终端不重建（审查重要 1）。
  - 这里的“连接身份”比 `paneId + terminalId` 多一层：1.5 的重新登录会在同一个 `paneId + terminalId` 上重建连接，只按两者加 key 的话，视图会留在已经关掉的旧连接上。
- 不给 `SessionConsole` 加 key（见 1.1）。
- 两个终端零件的 `.md` 写明合同：“`source` 在实例的一生里不变；宿主换连接时用 key 重建”。
- 顺带：`TerminalTextView.md` 的标签补上 `env:timer`（200 毫秒的节流定时器，omp 已核对过的伴生声明遗漏）。

**文件与文档。** `src/web/pages/SessionsPage.vue`、`src/web/host/session-console.ts`、`parts/TerminalView.md`、`parts/TerminalTextView.md`。`docs/panel.md` 的“网页终端”一节加一句“换选中的 pane 或重建连接时终端视图整体重建；同一格换会话不重建”。

**测试。**
- 连接序号：同一终端换会话时不变、连接不重建；换 pane 时加一，旧作用域已停（旧的假 `WebSocket` 已关）、新建一条连接。
- key 有没有绑到模板上、绑在哪一层，单元测试测不到，由浏览器验收覆盖。

**浏览器验收。**
- 两格 Agent 会话 A、B 的假屏幕写不同的标记。
- 桌面：打开 A，等 `.xterm-rows` 出现 A 的标记，用路由 push 换到 `?pane=B`，2 秒内 `.xterm-rows` 是 B 的标记、不再有 A 的。接管 B 后打一个字：B 的日志有，A 的没有。
- 接管中换会话（审查重要 1）：接管 A，对 A 运行 `pane report-agent-session` 换会话 id，等轮询之后：仍是“你已接管键盘”，`.xterm-rows` 没被清空，`document.activeElement` 仍是 xterm 的 `.xterm-helper-textarea`，再打一个字仍进 A 的日志。
- 手机（390，触屏）：在文字视图里做同样的切换，比对 `aria-label="终端的当前屏幕（文字）"` 的文字。

### 1.9 页面按路由参数重建（审查重要 2）与新建页的模式切换（审查建议 9）

排在 1.2 之后、1.3 之前。

**根因（审查用实验核实）。**
- `App.vue` 的 `RouterView` 没有 key。Work、Task、产物三个带参数的路由在参数变化时复用同一个页面实例，只换 props。
- `useStatusChange` 的提示、待确认、上一次的请求挂在实例上，换参数时不清；端点与 `expectedHash` 在发送时现读。在 Task A 上改状态遇到等锁超时，提示带“重试”；开发者点去 Task B，再点“重试”，就以 B 的端点与 B 的哈希发出 A 上选的状态，在 master 上提交。
- 产物页同理：答复的“重试”现读 `data.value`，换到另一个产物后按 B 的版本发出 A 的答案。
- 新建页：提交在途时还能切“新建 Work / 新建 Task”，回包与“结果未知”的确认都按切换后的模式清表，清错表、留下已经提交过的那张，有领第二个号的风险。

**改法。**
- 外壳给 `RouterView` 里的页面加 key：`<RouterView v-slot="{Component, route}">` 里给 `<component>` 加 `:key`，取路由名加 params，**不含查询参数**（否则会话页的 `?pane=`、编辑页的 `?path=` 一变就整页重挂）。编辑页的 `?path=` 仍由 1.3 的组合函数处理。key 的拼法写成一个纯函数 `pageKey(route)`，放在 `host/routes.ts`。
- 新建页：提交在途时禁用模式切换；`submit` 开始时记下模式，回包与 `confirmUnknown` 都用记下的模式。

**文件与文档。** `src/web/App.vue`、`src/web/host/routes.ts`、`src/web/pages/NewPage.vue`；`docs/panel.md` 的“前端”一节加“页面按路由名与路径参数重建实例，查询参数变化不重建”。

**测试。**
- `pageKey`：同名不同 params 不等；只差 query 相等；params 的键序不影响。
- 页面按 key 重建的接线由浏览器验收覆盖；新建页的逻辑在 `.vue` 里，同样由浏览器验收覆盖。

**浏览器验收。**
- Task 页：用 `page.route` 把这次 `POST …/status` 改成 409 `lock_timeout`，出现带“重试”的提示后点左栏到同一 Work 的另一个 Task：提示不在、没有“重试”。
- 新建页：用 `page.route` 把新建 Work 的 `POST` 延迟 3 秒，期间模式切换是禁用的；放行后清掉的是 Work 表。

### 1.3 omp 重要 4：编辑页换文件之后草稿不换

**根因（核实成立，补一处）。**
- 改 `?path=` 经 `onBeforeRouteUpdate` 确认之后，`useResource` 先把 `data` 置 `null` 再取新文件。
- `watch(file.data)` 遇到 `dirty` 就返回；新文件到达时 `draft` 仍不等于旧的 `base.text`，`dirty` 仍为真，于是 `base`、`draft` 一直是 A 的。
- `mismatch`、`uncommitted`、`notice` 也不清。
- 补充（按审查建议 1 更正）：保存在途时 `base` 还没换，`dirty` 为真，两个路由守卫都会弹“有未保存的改动，离开会丢掉”。开发者点“确定离开”以为丢掉了，这次保存其实照常在 master 上提交；A 的回包回来时又会写进新文件 B 的状态。

**改法。**
- `useFileEditSession(path)`：
  - 内部用 `useResource` 取 `/api/files?path=`；
  - 状态带一个“会话代号”，`path` 变了就加一，同时清空 `base`、`draft`、`mismatch`、`uncommitted`、`notice`；
  - 新文件到达且代号对得上时建立基线；
  - `save()`、`loadMismatch()`、`checkAfterUnknown()` 开始时记下代号与路径，回来时代号变了就丢弃回包。只丢状态更新，写入本身照样发生。
- 保存在途时离开的处理见 1.4。“未保存不让走”仍由页面的路由守卫保证，组合函数只负责“允许离开之后不留旧状态”。

**文件与文档。** `src/web/host/file-edit-session.ts`（新）、`src/web/pages/EditPage.vue`；`docs/panel.md` 的“编辑页的未保存改动”加一句“换文件之后编辑器、基线与提示都换成新文件的；旧文件在途的回包不再改写编辑器”。

**测试（`tests/web-file-edit.test.ts`）。**
- A 载入后把草稿改成“A 改了”，路径改成 B，B 到达：`base` 与 `draft` 都是 B 的，`mismatch`、`notice` 为空；
- `loadMismatch` 挂起时路径改成 B，再放行：B 的状态不受影响；
- 同一个文件重取（`file.reload()`）且有未保存的改动时，草稿不被覆盖（保留原来的保护）。

**浏览器验收（克隆里的两份 README，写入只进克隆）。**
- 用路由 push 依次打开 `/edit?path=B`、`/edit?path=A`，在 A 里打字；
- 先挂上 `page.on('dialog')` 接受原生确认框，再 `page.goBack()`；
- 先断言 URL 是 B、仍在编辑页；再断言编辑框是 B 的原文，标题路径是 B，没有“未保存”徽标。

### 1.4 omp 重要 5：保存期间继续输入，成功回包会盖掉

**根因（核实成立）。** `FileEditor` 的 `readonly` 只看 `blocked`。保存在途时可以继续打字，成功后无条件 `draft = 回包文本`，新打的字丢掉，`dirty` 变假，离开也不再提示。

**改法。**
- 保存在途时编辑器只读（`readonly = blocked !== null || saving`），页面上的保存入口防重入（已有 `write.pending`）。不做“边保存边改”的合并（决定点 4）。
- 保存在途时**拒绝站内离开**（审查建议 1，主 Agent 定）：两个路由守卫在 `saving` 时直接返回 `false`，不弹框，给一行提示“正在保存，等它完成再离开”（等锁最长 30 秒）。关标签页与刷新仍走 `beforeunload`。
- 回包改写 `draft` 之前，再核对一次 `draft` 仍等于提交的文本：只读之下这条恒成立，留作保护，不另开分支。

**文件与文档。** `src/web/host/file-edit-session.ts`、`src/web/pages/EditPage.vue`；`parts/FileEditor.md` 的 `readonly` 说明加“保存在途时宿主也会置只读”；`docs/panel.md` 同一段加“保存在途时编辑器只读，站内离开被拒绝并提示”。

**测试。**
- 保存挂起时 `saving` 为真，组合函数给出的只读为真；
- 挂起期间直接改 `draft`（模拟绕过只读）再放行：草稿不被回包覆盖，`dirty` 仍为真；
- 保存挂起时路径改成 B（页面守卫在实际产品里会拒绝，这里直接改 `path` 模拟绕过）：A 的回包不写进 B 的状态，没有“已保存”的提示；
- 正常保存后草稿换成服务端写下的文本（README 的 `updated` 被改过的情形）。

**浏览器验收。**
- 用 `page.route` 把这次 `PUT /api/files` 延迟 3 秒再放行，模拟在等写锁；
- 点保存后，用 `focus` 加 `keyboard.type` 打几个字（不用 `fill`：它会一直等元素可编辑直到超时）：断言值没变、`textarea` 带 `readonly`；
- 同一个延迟期间点一次左栏：断言没有离开、出现“正在保存”的提示；
- 3 秒后显示“已保存”，编辑框是服务端文本，可以再打字。

### 1.5 omp 重要 6：写请求遇到 401 不进入全局的“要重新登录”

**根因（核实成立，补一处）。**
- 只有 `useResource`、`SearchPage` 的流式搜索、两处重连探测把 401 转成 `panelState.unauthorized`；
- `sendJson`、`useWrite` 与页面里直接的 `getJson`（读屏、读历史、编辑页取当前版本）都只给局部错误；
- 新建页的预览 401 被当成“预览问题”，不挡提交；
- 应用级的 `/ws` 重连定时器没有保存，没有停止入口（1.0 补上）。
- 补充：外壳在 `unauthorized` 时用 `v-if` 换掉整个界面，`RouterView` 被卸载。编辑页的草稿、答复表单里填了一半的答案会随之丢掉。改成写请求也触发之后，这条路径会更常走到。

**改法（决定点 1 的终稿：阻挡层，页面不卸载，恢复路径补全，见审查重要 5）。**
- `api.ts`：
  - 加一个认证失效的事件出口，例如 `onAuthLost(listener)`；
  - `readEnvelope` 与 `streamLines` **先按 `response.status` 判断 401**，再解析 JSON（回应不是 JSON 的 401 也算），触发事件，同时照常抛 `ApiError`，让调用方的局部说明仍然成立；
  - 只看状态码，不看文案。
- `panel-data.ts` 把认证当成一个有“代”的状态：
  - 失效：`unauthorized` 置真，关掉 `/ws`、取消重连定时器（与 `stopPanelData()` 同一套），推送不再触发重取；`useResource` 在 `unauthorized` 时不发请求，`reload()` 与补取都直接返回，于是 checkout 页每 10 秒的轮询这类自带定时器也停止打 401；
  - 重新登录：外壳的“我已重新登录”重探 `/api/meta`，通过就 `authEpoch` 加一、`unauthorized` 置假、重新连 `/ws`，并**显式全部重取**（不依赖 `hello` 的判定：同一个服务实例里失效再重登，`hello` 不会触发全部重取）；
  - 删掉 `useResource`、`probeBeforeReconnect` 里各自的 401 分支，改走同一个出口。
- `SearchPage`、`terminal-socket.ts` 的 401 分支同样改走这里。`terminal-socket` 收到全局失效时停止重连。
- 会话页：终端连接作用域的 `watch` 键带上 `authEpoch`，重新登录之后自动重建连接、只恢复观看（不自动重新接管）。
- 外壳：`unauthorized` 时页面保持挂载，盖一层阻挡交互的提示，写“登录已失效：在终端运行 nbdev panel open，用新链接登录（同一个浏览器里别的标签页也行），再点‘我已重新登录’”。

**文件与文档。** `src/web/host/api.ts`、`host/panel-data.ts`、`host/terminal-socket.ts`、`host/session-console.ts`、`pages/SearchPage.vue`、`App.vue`；`docs/panel.md`：
- “登录”与“数据宿主”两处改成“任何 `/api/*` 请求回 401（读、写、预览、探测、流式搜索）都进入登录失效状态：停止推送、重连与取数，页面保持挂载、盖一层提示；重新登录后点‘我已重新登录’，全部重取、会话页的终端重连（只恢复观看）”；
- “网页终端”的“连接与消息”加“重新登录后重建连接”。

**测试（`tests/web-panel-data.test.ts` 与 `tests/web-api.test.ts`）。**
- 假 fetch 对 `sendJson` 回一个合法的 401 外壳，经 `useWrite` 处理：`panelState.unauthorized` 为真，`useWrite` 仍拿到局部的失败；不是 JSON 的 401 同样触发；
- 失效之后假 `WebSocket` 已经 `close`，等过重连的最短间隔（1 秒）没有新建连接；再推一条消息，订阅了的资源不再发请求；`reload()` 不发请求；
- 同一实例里失效再重新登录：每个订阅了的资源各重取一次，新建了一条 `/ws`，`authEpoch` 加一；
- 会话页的终端作用域在 `authEpoch` 变化后重建（连接序号加一、新建一条终端连接）；
- 流式搜索的 401 同样触发。

**浏览器验收。**
- 打开编辑页打几个字，另一个标签页开会话页并接上终端，然后 `context.clearCookies()`；
- 在编辑页触发一次保存或在新建页触发一次预览：断言出现阻挡层，编辑框里的字还在；
- 推送连接已断开：Playwright 记下 `/ws` 的 close，之后没有新的 `/ws` 握手；checkout 页开着时 20 秒内没有新的 `/api/checkouts` 请求；
- 用 `nbdev panel open --print` 的链接在新标签页登录，回到原标签页点“我已重新登录”：阻挡层消失，编辑框里的字还在、可以保存；会话页的终端重新出画面。

### 1.6 omp 重要 7：连续推送时慢资源一直被中止

**根因（核实成立）。**
- 每次推送都直接 `load(true)`，开头 `controller?.abort()` 中止在途的请求，没有在途合并，推送间隔短于请求耗时就永远收不到数据；
- 外壳与首页各取一次 `/api/overview`；外壳订阅全部四块的 `/api/meta`，Work、Task、文档、编辑、产物、新建、会话七个页面各另有一份 `/api/meta`；
- 服务端 `records` 或 `sessions` 变了会接着重算 `activity`，一次改动常带来两条相邻的推送。

**改法。**
- `useResource` 只把**推送触发的重取**改为单飞（审查建议 2）：
  - 在途时再来推送，只记一个 `dirty`，不中止；
  - 在途的请求结束（成功或失败）后，`dirty` 为真就再取一次，最多补一次；
  - `unauthorized` 时不补取（1.5）。
- 显式 `reload()` 保持现在的“中止在途、立即重取”：调用点都在写入之后、重试按钮与 checkout 页 10 秒一次的轮询，要的是“比这次写入新的数据”，不能合并进写入之前发出的在途请求（编辑页最明显）。
- `path` 变了：中止在途、复位 `dirty`、立即重取；scope 销毁时中止。
- 保留“只接受最后一次请求、revision 不回退”的判断。
- 同一个地址在不同组件之间共用请求，本阶段不做（决定点 5）。

**文件与文档。** `src/web/host/panel-data.ts`；`docs/panel.md` 的“数据宿主”加“推送触发的重取单飞：在途时再有变化只记一笔，结束后至多再取一次；显式重取与地址变化照旧中止在途的请求”。

**测试。**
- 假 fetch 每次 80 毫秒才回，假 `WebSocket` 在 600 毫秒里每 30 毫秒推一条 `records` 变化：
  - 被中止的请求数为 0；
  - 推送期间至少接受 3 次数据；
  - 推送停下后恰好再取一次，最后的数据对应最后一次推送之后的状态。
- 在途请求挂起时调 `reload()`：旧请求被中止，旧回包不写进 `data`。
- `path` 变了：在途的请求被中止，新地址立即取；旧地址的回包不写进 `data`；之后不补取旧地址。
- 失败之后有 `dirty` 也照样补取一次。
- 单飞在途时来了 `hello`（实例变了）：旧实例的回包被接受（实例不同不算回退），随后补取一次拿到新实例的数据（审查重要 4 第 4 点）。

**浏览器验收。**
- 用 `page.route` 把 `/api/overview` 延迟 2 秒；
- 同时在克隆里每 700 毫秒改一次某个 Work 的目标（README 的“目标”一节）：只进克隆，不提交也会让 `records` 变；间隔大于 `records` 重算的去抖，小于请求耗时；
- 15 秒内：Playwright 记下的 `/api/overview` 请求里被中止的为 0，首页那张 Work 卡片的目标至少换过 3 次；
- 停止改动后 4 秒内卡片是最后一次改动的内容。

### 1.7 omp 重要 8：已有数据时重取失败，界面不提示

**根因（核实成立）。**
- `useResource` 在 `keepData` 时失败只设 `error`、保留 `data`；
- 订阅推送的 10 个页面都只在 `!data` 时显示 `LoadState`，所以这种状态完全不显示。这 10 个页面是首页、Work、Task、产物列表、产物、文档（树与正文两份资源）、会话、在跑、checkout、GitHub；
- 外壳顶栏的“数据 N 分钟前”只看 `meta.parts.records.at`，不代表当前页面这次刷新成功；`meta.parts.<块>.error`（后台重算失败）从不显示。

**改法。**
- `useResource` 加两项：`receivedAt`（最近一次接受数据的时刻）；`stale`（`data` 与 `error` 同时存在）。
- 新零件 `StaleNotice`（带同名 `.md`）：一行紧凑的提示，写“显示的是 N 前读到的内容；这次重取失败：<原因>”，加一个“重试”。
  - 404 写“已经找不到了（可能被删或改了名）”，不给重试，给“回到上一级”的链接（链接由页面给，决定点 6）。
- 这 10 个页面在标题下面放 `StaleNotice v-if="resource.stale"`。
  - 一页有几份资源时只显示主资源。
  - 编辑页不显示：它不订阅推送，只在保存时重取。
- 外壳：`meta.parts` 里有 `error` 的块，在顶栏下面给一行提示，写“后台重算 <块> 失败，显示的是上一份：<原因>”。阶段 2 再改成横幅。

**文件与文档。** `src/web/host/panel-data.ts`、`parts/StaleNotice.vue` 与 `.md`（新）、上面 10 个页面、`App.vue`；`docs/panel.md` 的“数据宿主”加“已有数据时重取失败：保留旧数据，页面写明是上次读到的并给重试；后台重算失败在顶栏写明”，“零件”列表加 `StaleNotice`。

**测试。**
- 先成功、再 503：`data` 保留，`error.status` 为 503，`stale` 为真，`receivedAt` 是第一次的时刻；
- 再成功：`stale` 为假；
- 首次就失败：`stale` 为假，仍由 `LoadState` 处理。

**浏览器验收。**
- Work 页先正常显示；用 `page.route` 让之后的 `/api/work/...` 回 503，再在克隆里改这个 Work 的目标，触发推送重取；
- 断言出现“显示的是上次读到的内容”与“重试”；
- 撤掉拦截后点“重试”，提示消失。
- 404 的情形：拦截改回 404，断言没有“重试”、有“回到上一级”。

### 1.8 omp 重要 9：后台标签页里第一次建终端，回到前台不会连上

**根因（核实成立）。**
- `connect()` 在 `document.visibilityState === "hidden"` 时直接返回，`status` 停在初始的 `"connecting"`；
- `visibilitychange` 回到前台时只在 `status === "paused"` 时连接，于是一直停在“连接中”；
- 正常的切后台走 `paused`，所以平常用不出这个问题。

**改法。**
- `connect()` 因为页面在后台而不连时，把 `status` 置为 `"paused"`。回到前台由现有的 `paused` 分支恢复，只恢复观看。
- 不改终止码不重连、`disposed` 不连接这两条合同。

**文件与文档。** `src/web/host/terminal-socket.ts`；`docs/panel.md` 的“连接与消息”加“在后台打开会话详情时先记为暂停，回到前台才连”。

**测试（`tests/web-terminal-socket.test.ts`）。**
- 假 `document` 初始 `hidden`，在 scope 里建 `useTerminalSocket`：没有新建 `WebSocket`，`status` 为 `paused`；
- 改为 `visible` 并派发 `visibilitychange`：新建了一条连接；
- 同样的流程在 scope 停掉之后：不连接；
- 回归：已连上时切后台再回来，照旧只恢复观看。

**浏览器验收。** 这是模拟：Playwright 不能真的把标签页放到后台而不失去控制，所以只能这样做，记录里写明。
- 在首页用 `page.evaluate` 把 `document.visibilityState` 改成 `hidden`（`Object.defineProperty`）并派发 `visibilitychange`；
- 再用路由 push 打开 `?pane=w4:p1`，让终端在“后台”建起来；
- 改回 `visible` 并派发事件：断言 3 秒内终端出画面（`.xterm-rows` 有假 Claude 的标记）。

### 切片、验证与合入

- 一片一个提交，次序：1.0、1.1、1.2、1.9、1.3、1.4、1.5、1.6、1.7、1.8。1.3 与 1.4 共用新的组合函数，1.3 在前。
- 每个提交都过包的 `typecheck`、`build:web` 与相关测试。阶段末按包的 `AGENTS.md` 的完成门禁跑全量：
  - 包里 `typecheck`、全量 `test`、`build:web`；
  - 根目录 `bun x vitest run --config scripts/vitest.config.ts scripts/ci/dev-panel-records.test.ts`；
  - 改到包内文档（`docs/panel.md`、零件的 `.md`）所以还要跑 `bun run governance:check` 与 `bun run docs:check`。
- 浏览器验收在阶段末统一做一遍（十片），截图与日志放本地 `accept/`。
- 合入：阶段 1 单独合入 `master`。合入后要重启常驻服务，重启前先问开发者（D5）。
- 禁止清单照旧：
  - 不按错误文案分支；没有静默的 `catch`；
  - 不为过测试放宽断言，不加测试专用的分支或导出；
  - 不删任务之外的代码；不跨包深导入。

## 阶段 2：外壳（轮廓）

| 片 | 内容 | 依赖 | 验收要点 |
|---|---|---|---|
| 2a 滚动条与滚动权 | `app.css` 一处声明细滚动条（`scrollbar-width: thin`，颜色由 `--text-muted` 派生，悬停加深，明暗跟主题）；`html` 不预留滚动条槽位；左栏的 Work 区、`main`、文档页两栏 `scrollbar-gutter: stable`；路由元信息声明“铺满”或“流式”，外壳据此决定 `main` 滚不滚。这一片只把文档页声明为“铺满”：会话页现在是一长列纵向堆叠，靠 `main` 滚动，它的“铺满”挪到阶段 4 改两栏的那一片（审查建议 6）。xterm 的空 `.xterm-viewport` 藏掉原生轨道，自绘条用 `ITheme.scrollbarSlider*`（`host/terminal-theme.ts`）。同步 `docs/panel.md`“前端”一节的“一页一个竖向滚动者”约定 | 无 | 去掉 `--hide-scrollbars` 截图：窗口右缘没有 15px 空带；同屏最多一条竖条加局部横条；短长数据切换时 `main` 的内容宽度不跳；接管终端的列数与改之前一致（只藏 viewport 的轨道）；会话页仍能滚到底 |
| 2b 导航零件 | 抽出 `parts/PanelNav.vue` 与 `.md`，桌面左栏与手机抽屉共用；上段固定（首页与收件箱、新建、资料、现场与计数），下段是可滚的 Work 树；按路由自动展开所属 Work、高亮当前项、滚进可视区；被截断的标题悬停显示全文；Work 树按 D4 只列进行中的与 30 天内更新过的未标 Work，其余收进“更多”。导航条目来自面板自己的小描述表，路由仍显式声明 | 2a（左栏的滚动所有者） | 900 高时首屏看得到“现场”；Task 页左栏高亮当前 Task；抽屉里有 Task 层且与桌面一致；Tab 次数明显减少 |
| 2c 可调宽度 | nb-ui `Splitter`（`@notnotype/nb-ui/components` 公开入口），见下面的接线细节；D4 的默认 300px、最小 200px、最大取 480px 与视口 40% 中较小的；拖到最小以下收起，另给收起按钮（决定点 8：完全收起，顶栏左侧给展开按钮）；窄屏用抽屉（断点见决定点 7），断点切换时 `RouterView` 不重挂 | 2b | 鼠标、键盘（方向键、Home、End、Esc 取消）都能调；刷新后恢复；窗口变窄时夹住、变宽时恢复用户要的宽度；拖到 360px 后等 20 秒（跨过外壳一次时钟重渲染）宽度不变；断点来回切换时编辑草稿与终端不丢 |
| 2d 顶栏 | 搜索框限宽，加 `/` 与 Ctrl+K 聚焦：焦点在可编辑元素上（输入框、`textarea`、`contenteditable`、xterm 的 `.xterm-helper-textarea`）时不处理，也不在捕获阶段 `preventDefault`（审查建议 6）；正常状态（herdr、推送、数据新旧）合成一个状态点，点开看详情；“代码已更新”“前端构建失败”“审计未开启”与阶段 1 的后台重算失败，改成顶栏下的一条横幅；“通知要处理”保持醒目 | 2a | 1920 宽时搜索框不拉满；正常时顶栏只剩搜索、状态点、通知、明暗；异常时横幅出现；接管中按 Ctrl+K 与 `/`：终端日志收到、搜索框没有获得焦点；编辑页的 `textarea` 里能打 `/` |
| 2e 可访问性小项 | “跳到主内容”；**只在路由名或 params 变化时**把焦点放到页标题，查询参数变化（会话页选会话、文档页选文档、以后的 `?peek=`）不移焦点（审查建议 6）；`document.title` 写成“页面名 · nbdev”；焦点环用 nb-ui 的焦点令牌；承载信息的灰字（表头、编号、元信息）改用 `--text-secondary` | 2b（导航结构定了再做跳转与焦点） | 第一次 Tab 出现“跳到主内容”；标签页标题随页变；在文档树里连续选几份文档，焦点留在树里；亮色下表头对比度不低于 4.5:1 |

先后：2a → 2b → 2c；2d、2e 在 2b 之后，可以并行。

**2c 接 `Splitter` 的接线细节**（审查建议 5）：
- 外壳现在的 grid 整体换掉，不是把 `Splitter` 塞进 grid 的一格：它的根与每块面板都裁切溢出，`main` 的滚动放在右侧面板里面的一层上，正合“一页一个竖向滚动者”；
- `panels` 用 `computed` 生成，不写模板里的字面量数组：未受控时 `panels` 换了一个对象，`Splitter` 就按 `defaultSizePx` 重新分配，而外壳每 15 秒因为时钟重渲染一次，字面量数组会每 15 秒把左栏弹回默认值；
- 左栏的 `defaultSizePx` 绑“用户要的宽度”这份 ref：从 `host/prefs.ts` 同步读（渲染前读到，免得刷新时先 300px 再跳），`gesture-end` 时更新这份 ref 再写 prefs；`maxSizePx` 取 `min(480, 视口 40%)`。这样重新分配是幂等的，窗口变窄时夹住、变宽时恢复；
- “收起”由宿主持有，经 `panels[].collapse.collapsed` 输入，`gesture-end` 的 `collapsed` 映射要回写，否则吸附收起之后下一次重新分配又展开；类型写成 `NonNullable<SplitterPanelConfig["collapse"]>`，不去导 nb-ui 内部的 `grid-types`；不碰 `useSashGesture`；
- 窄屏沿用同一个 `Splitter`、面板 id 不变（它按 id 用 `v-for` 渲染面板，插槽内容不重挂），只把 `sashSizes` 改为 0、左栏 `collapsed`、`disabled`，导航改由抽屉显示；
- iframe 的指针屏蔽不是必须（nb-ui 的手势在根上 `setPointerCapture`），保留也无害。

**两个断点各管什么**（决定点 7）：抽屉的断点从 `md`（768）改到 `lg`（1024），管“左栏是并排还是抽屉”。会话页的“手机”判定（`(max-width: 767px), (pointer: coarse)`）管“给不给接管、默认文字视图还是终端画面”，保持不变；不跟着改到 1024，否则 768 到 1024 宽的桌面窗口会失去接管。

风险：
- **原子类的层序**：nb-ui 的原子类不分层，面板的也不分层，靠加载顺序取胜（omp 建议 6）。新加的面板语义类一律 `nbdev-` 前缀，不给整份 nb-ui 的 CSS 包 `@layer`。
- 2a 把主应用 `app.vue` 末尾那份细滚动条的配方搬过来时，只用标准属性。Chrome 121 以后设了标准属性，`::-webkit-scrollbar` 就被忽略；thin 实际是 10 到 11px，不是 6px（ux-c 实测）。

## 阶段 3：页面骨架与共用零件（轮廓）

| 片 | 内容 | 依赖 | 验收要点 |
|---|---|---|---|
| 3a 语义类 | `app.css` 加少量 `nbdev-` 语义类：字号五档（页标题、区标题、正文、说明、标注）、区块间距、面层（`nbdev-surface`），替换散落的内联 `style` 与重复的 `bg-subtle` 提示块 | 阶段 2 | 各页字号与间距只剩五档、三档；内联 `style` 的条数明显下降（`grep` 计数前后对比） |
| 3b `PageShell` | 面包屑、标题、状态、右上操作槽，内容宽度分三档（阅读、列表、满铺），14 个页面都套；文档页、编辑页补页头。阅读档的卡片宽度跟着正文的阅读宽度走，修掉 Task 页、文档页正文右边的空白。阅读档的宽度怎么算，取决于速览面板是推开正文还是浮在上面（已定，见决定点 17：内容区宽于约 1100px 时并排，阅读档按推开之后的宽度算） | 3a、决定点 17 | 各页标题的顶边位置一致；Task 页、文档页卡片右边不再空一片；首页之外的页面都有可回上一级的面包屑 |
| 3c 反馈零件 | 结果（成功、失败、冲突、结果未知）与附注（警告）分两层：结果颜色只由结果决定、位置固定、不推动内容；附注缩进、可折叠；字段错误只报一次并锚到字段（含新建页提交期的 `details.field`，omp 建议 4）。替换 `WriteNotice` 的用法，阶段 1 的提示一并换过来 | 3a | 新建成功不再是橙色；编辑页的错误不再重复三遍、不推动编辑器 |
| 3d `LoadState` | 骨架屏变体（卡片、表格、详情）；把阶段 1 的 `StaleNotice` 收进来作为“旧数据”变体；404 与网络错误分开，404 给“回到上一级” | 3a、阶段 1 的 1.7 | 加载时左栏与主区不跳；对不存在的 Work 显示“找不到”和上一级链接，不给“重试” |
| 3e 截断零件 | 截断，悬停看全文，点击复制；长 id、路径、分支名都用它；数字用等宽数字 | 3a | checkout 页路径不再需要横向滚动才看得全；左栏与表格里的长标题能看全文 |
| 3f 两级操作 | 主要操作用 `Button`，次要操作用带文字的 ghost 按钮，不再用 11px 的灰字当按钮 | 3b | Work、Task、文档、会话页的入口都是按钮形态 |
| 3g 临时框收敛 | 现场页整页是临时内容，改为分区标题旁一个“临时”小徽标；虚线框只留给混在持久页里的临时片段（Task 页的“谁在动”）；会话页的“无主的运行”只留一个去“在跑”的入口 | 3b | 会话、在跑页不再整页虚线框 |

先后：3a → 3b，其余在 3b 之后可以并行；3c 要在阶段 4 的写入类页面之前。

风险：
- 14 个页面同时换骨架，改动面大，按页分提交，每个提交单独截图对比；
- 不要建通用页面框架或 `useApp` 那样的万能宿主（omp 建议 2、3），只做页头、分节与资源状态这几样。

## 阶段 4：逐页改进（轮廓）

按页切片，每页一个或几个提交，彼此基本独立；涉及服务端的单列在后面，**先于对应的前端片单独提交**，审查时能单独看安全面（审查建议 10）。

- **首页**（ux-b F5、ux-a S7、开发者第 4 条）：
  - 第一屏是“等我”：待答的提问按产物合并（前端分组即可）、要处理的通知、异常；
  - 撞号写明原因与去哪里处理；
  - Work 排序：有事等我的在前，其次进行中，再按最近更新；卡片改紧凑。
  - 验收：同一产物的三道题合成一行“uxq：3 道待答”；撞号能点到说明。
- **Work 页**（开发者第 1 条、ux-b F10、ux-a R6）：
  - Task 行可以就地展开，展开后是当前情况、下一步、产物、证据、谁在动；
  - 展开时按需取这个 Task 的接口（决定点 9）。Task 接口每次要跑一次 `git log` 与执行 checkout 的判定，展开的行又各是一份订阅推送的资源，所以**同时最多展开 3 行**，展开第 4 行时收起最早的那行；
  - 标题列加宽、单行截断；“当前情况”按行内 Markdown 渲染；为 0 的计数淡化。
- **Task 页**（开发者第 2、3 条）：
  - 状态只显示一处；正文卡片按阅读宽度（3b）；
  - 产物、证据、文档在侧边速览面板里打开（D1，`?peek=`，能后退、能分享，中键照样开新标签页）。面板里显示什么、怎么摆，见决定点 10 的终稿：
    - 文档与证据显示渲染后的内容；
    - 产物显示页面本身：沙箱 iframe，`sandbox` 与产物页相同；外加状态行（产物接口已有的 `state`、待答题数与版本）和“去答复”“打开完整页”，不放答复表单；
    - iframe 连同“页面是当前版本”那行说明抽成零件 `parts/ArtifactFrame.vue` 与同名 `.md`，产物页与速览面板共用（审查建议 8）：不给 `allow-same-origin`、亮色垫白底这几项理由都在它的 `.md` 里；
    - 打开速览时焦点放在面板标题，有可见的关闭按钮（iframe 里按 Esc 不会冒泡到面板外，不能只靠 Esc 关闭）；
    - 布局见决定点 10。
- **产物页**（ux-b F4、F12）：
  - 分“待答、已答（只读回看答案、时间、版本）、已取代”三段，已答按接口已有的 `answers` 列出；
  - 新加的题标“新”；提交栏固定在底部，写明“已改几题、还有几道必答”；
  - 成功提示写答了什么，不只给提交号；
  - iframe 换成 `ArtifactFrame`。
- **会话页**（ux-b F3、F13）：
  - 桌面改成左列表、右详情两栏，选中项高亮；终端定高，输入框、按键行、投递结果紧贴终端；这一片同时在路由元信息里把会话页声明为“铺满”（从 2a 挪过来）；
  - 写明发送快捷键；
  - 接管时给一个固定的退出组合键 `Ctrl+]`（决定点 11），写在提示条上，“释放”按钮仍是主要入口；实施时在假 Claude 与 omp 的 pane 上各按一次，确认不被吞掉、也不触发别的动作；
  - D2 的任意 pane 观看见下面的服务端改动。
- **现场三页**：
  - “无主的运行”在会话页只留入口（3g）；
  - checkout 整行可点（去它的 Task、文档）；
  - 落后、有改动、有服务在跑用同一种“需要注意”的颜色；
  - 未跟踪计数见下面的服务端改动。
- **文档页**：
  - 加“渲染 / 与 master 的差异”切换（服务端改动见下）；
  - “只看有差异的”与所选 checkout 写进网址；
  - 手机上把文档树收进抽屉。
- **编辑页**（ux-b F8）：
  - 面包屑能回到 Task；
  - 底部固定操作栏：保存并提交、放弃，支持 Ctrl+S；
  - 站内离开用面板自己的确认框，不用 `window.confirm`；路由守卫要等异步确认，改法要先试（见下一节）。
- **搜索**（ux-b F9）：
  - 记录类的命中放第一屏，按相关度排（标题命中先于正文命中）；
  - 文件命中高亮关键词；
  - `.agents/tasks` 的历史默认折叠。

### 要改服务端的几处

| 项 | 范围 | 风险与先决 |
|---|---|---|
| D2 观看任意 pane，并能往回翻 | `/api/sessions` 把本仓库里没有 Agent 会话的 pane 也列出来（现在只作为“无主的运行”的 pane 号出现），会话页给“只读观看”入口；`/ws/terminal` 的 `open` 放开对 Agent 会话的要求，只允许观看。**接管的服务端闸门要显式写**（审查重要 6）：现在挡住非 Agent pane 的只有 `open` 那一行，`takeover` 只比 `keyOf(pane) !== message.expectedSession`，没有会话的 pane 是 `null` 对 `null`，会放行。改为 `takeover` 先要求 `pane.agent !== null`、`keyOf(pane) !== null`、`typeof message.expectedSession === "string"`，否则回 `error`（例如 `not_allowed`），不关连接、照常观看；`input`、`key`、`resize` 本来就要求已在控制中。`/api/sessions/:pane/prompt`、`/keys` 的 `agent.get` 核对本来就要求有会话，补测试钉住“非 Agent 的 pane 回拒”。“往回翻”沿用现在给 omp 的“更早的输出”，读 1000 行做成文字面板：非 Agent 的 pane 读 `pane.read`（要加进 herdr 方法白名单，只读）；前台程序在备用屏时（vim、less、htop、带 TUI 的开发服务）**不给往回翻，只给当前屏**，Claude 也一样不给（审查建议 7）。**观看非 Agent 的 pane、读它的历史都不写审计**，与现行“观看不写审计”的合同一致（主 Agent 定）。 | 先实测：`terminal session observe` 对非 Agent 的 pane 能不能用；0.9.1 与 0.9.3 上 `pane.read` 的参数与副作用，实测矩阵加一格跑 vim 或 less 的 pane；怎么判断前台程序在备用屏。白名单变化同步 `docs/herdr.md` 与 `tests/delivery.test.ts` 钉住的清单。`panel-terminal` 的 L3 加：对非 Agent 的 pane 能观看；`takeover`（`expectedSession` 为 `null`、空串、伪造串）一律被拒；审计里没有 `takeover` 行 |
| checkout 的未跟踪计数与文件清单 | `status --porcelain` 由 `-uno` 改为分开计数：已跟踪改动、未跟踪（`-unormal`，未跟踪的目录算一条）；新接口 `GET /api/checkouts/:key/files`，列出暂存、工作区、未跟踪三段，条数上限；10 秒缓存照旧；沿用 `readOnly`（`--no-optional-locks`） | 未跟踪扫描在大 worktree 上可能慢：先对真实的 15 个 checkout 量耗时（t14 冷算 104 到 210 毫秒是 `-uno` 的数）。`checkoutsView` 现在等全部 checkout 算完才回，所以超时要**每个 checkout 各自计**，超时的那个给“未算”，不拖住整页 |
| 文档与 master 的差异视图 | 新接口 `GET /api/docs/diff?checkout=&path=`，**与文档树标“改动”同口径**（决定点 12 的终稿，审查重要 7）：分支改的文件，差异取“合并基点 → 工作区”（`git diff <merge-base master HEAD> -- <path>`，含未提交改动）；未跟踪的新文件整份当新增；`master_only` 的文件整份显示 master 的版本，写明“分支分出之后 master 新增的”；需要的话另给一个“与 master 当前比”的次要切换，不作缺省。前端用现有的 `DiffView` | 白名单不能照抄 `/api/docs/file` 的（删去的文件、`master_only` 的文件在这个 checkout 的文档树里不存在，会 404）：取“这个 checkout 的文档树 ∪ 这个 checkout 的 changes 列出的路径 ∪ 记录里的文档”，路径照常过现有的路径守卫；git 参数用 `--` 隔开路径，只读调用带 `--no-optional-locks` |
| 产物页显示已答的内容 | 核实后**不需要改服务端**：`answers` 已在接口里（见“计划前的核实”） | 无 |
| 首页按产物合并提问 | 核实后**不需要改服务端**：前端按 `artifactId` 分组 | 若要“按 Work 显示待我答的个数”，`overview.works` 里已有计数，也不需要 |

## 要先实测才能定的问题

1. **xterm 的自绘滚动条**：D2 给终端加回滚之后，`ITheme.scrollbarSlider*` 的配色在明暗两套终端配色下是否可见、是否干扰选择。藏掉空 `.xterm-viewport` 的原生轨道之后，列数是否与现在一致。轨道本身已在计划前实测过。
2. **`Splitter` 放进外壳**（接线细节见 2c）：
   - 窄屏时保留同一个 `Splitter`（`sashSizes` 0、左栏收起、禁用），导航改由抽屉显示，`RouterView` 是否始终是同一个实例。验法：在编辑页打几个字、在会话页接上终端，把窗口在 1280 与 390 之间来回改，草稿与终端连接都还在；
   - 它的 `collapse` 配置能否表达 D4 的“拖到最小以下就收起”；
   - 拖到 360px 后等 20 秒，宽度不被外壳的时钟重渲染冲回默认值。
3. **编辑页的站内确认框**：`onBeforeRouteLeave` 返回 Promise 时，面板自己的确认框能否接管（nb-ui `Dialog` 的焦点与 Esc）；浏览器后退（popstate）场景下 vue-router 5 取消导航后地址栏是否复原。
4. **Task 页正文右边的空白**：已按代码与截图核实，是卡片宽度与 72ch 阅读宽度不一致（见“计划前的核实”）。3b 做完后在 1280、1440、1920 三个宽度截图确认。
5. **未跟踪文件扫描的耗时**：见服务端改动。
6. **D2 的 observe、`pane.read` 与备用屏**：见服务端改动。

## 决定点

### 终稿（主 Agent 2026-10-13 定）

1. **登录失效时**：页面保持挂载，盖一层阻挡交互的提示；恢复路径补全（重新登录后全部重取、会话页终端重连、失效期间不取数，checkout 页的轮询这类定时器随之停下）。见 1.5。
2. **会话输入框的草稿按 pane 记**：同一格换会话（`/compact`、`/clear`）时保留，并提示“会话换了”；切到别的 pane 才清空。清空用已有的 `resetKey`，不给 `SessionConsole` 加 key；终端按连接身份加 key；发给 A 的回包不清给 B 打的草稿。见 1.1、1.2。
3. **终端零件不加防御性的 `watch(source)`**：key 取连接序号，构造上保证 `source` 不变。
4. **保存在途时编辑器只读**，不做边保存边改。
5. **同一地址在不同组件之间共用请求**：本阶段不做，只做每个资源自己的单飞。
6. **重取遇到 404**：保留旧数据，提示“已经找不到了”，给“回到上一级”、不给重试。
7. **抽屉的断点改到 `lg`**；会话页的“手机”判定不变。见阶段 2。
8. **左栏收起时完全隐藏**，顶栏左侧给展开按钮，不做 48px 的图标栏。
9. **Work 页就地展开 Task 时按需取 Task 接口**，同时最多展开 3 行。见阶段 4。
10. **速览面板显示产物页面本身**（沙箱 iframe，与产物页共用 `ArtifactFrame` 零件），加状态行与“去答复”“打开完整页”，不放答复表单。面板的布局见第 17 条。
11. **接管时退出键盘用 `Ctrl+]`**，“释放”按钮仍是主要入口。
12. **文档差异的基线与文档树同口径**：合并基点到工作区（三点 diff），删去的与 `master_only` 的文件都能显示。见服务端改动。
13. **不引入组件挂载测试**：接线错误靠浏览器验收覆盖，“接管中换会话 id”“同一终端换会话不重建终端”已写成验收场景。
14. **页面按路由名与 params 重建实例，不含查询参数**。见 1.9。
15. **保存在途时拒绝站内离开**，提示“正在保存，等它完成”。见 1.4。
16. **观看非 Agent 的 pane、读它的历史不写审计**。见服务端改动。
17. **速览面板的布局**（开发者 2026-10-14 定，按编码子代理的推荐）：内容区（不含左栏）宽于约 1100px 时并排、推开正文；窄于它时浮在正文上（不推开，正文下面加一层半透明遮罩，点遮罩关闭）；手机上整屏。用内容区宽度而不是视口宽度判断，左栏拖宽时自动从并排切到浮层。审查建议 10 的背景：左栏默认 300、最大 480（D4），1280 宽时再推出一个 480 左右的面板，Task 页正文只剩约 500px，比阅读宽度还窄。

## 风险

- **阶段 1 改的是正在用的面板的核心路径**（发按键、接管、写入、登录）：每条都有 L3 加浏览器验收，合入前在 4490 上完整走一遍；合入后重启常驻服务要先问开发者。
- **测试的模块单例与定时器**：靠 `--isolate` 与产品里也用的 `stopPanelData()` 收口；不加测试专用的复位导出。
- **阶段 2、3 改动面大**：每片单独截图对比明暗、390 与 1440；不把信息排序的调整混进外壳改动。
- **主应用与 nb-ui**：本 Task 不改 nb-ui 与主应用（D3）。滚动条收进 nb-ui 已记在后续清单。

## 实施进度（编码子代理随做随记）

- 2026-10-13：计划写完，交主 Agent 与设计审查。
  - 计划前只读核对了源码。
  - 在 4490 的审查面板上只读实测了一次 xterm 的滚动条结构：登录后打开 `?pane=w4:p1`，没有发消息、没有按键；用一个浏览器，用完已关。
  - 没有改代码，没有提交。
- 2026-10-13：按设计审查改计划（全部采纳），加 1.0 与 1.9，决定点改成终稿。
- 2026-10-13：阶段 1 做完，在集成分支 `feat/w00022-dev-panel` 上，未 push。
  - 提交（`8a1a2a105..16734c6fa`，11 个）：`d5a0fd49a` 1.0、`a918d37a0` 1.1、`6911c1ee3` 1.2、`e6f6b86a8` 1.9、`7b32a6015` 1.3、`afed56cfa` 1.4、`fa30380e5` 1.5、`d81c92103` 1.6、`32145078a` 1.7、`a29c645be` 1.8，以及验收发现问题后的修正 `16734c6fa`（见下）。
  - 门禁（在 `a29c645be` 上跑）：
    - 包的 `typecheck`、`build:web` 通过；全量 `test` 369 过、0 失败、0 跳过，用时 6 分 29 秒，含 herdr L4 与 `--isolate` 下的前端宿主测试；
    - 根目录 `dev-panel-records` 在 Node 下 5 过；`governance:check`、`docs:check` 没有错误，警告都是存量，或是 worktree 里的记录比 master 旧，与本阶段无关；
    - `git diff --check` 干净。
    - `16734c6fa` 只改 `NewPage.vue`，补跑了 `typecheck`、`build:web` 与 `git diff --check`。
  - 浏览器验收：在 4490 上用集成分支的代码起面板，40 条全部通过。会话 A 是 `w4:p1`，B 是另起的 `w5:p1`，两格都是假 Claude，屏幕上分别写着 AAA 与 BBB。
    - 1.1：四个场景都过。按 Enter 开确认后 goBack 到 B；按 Esc 开确认后在同一格换会话；开着接管小窗时 goBack。三种情况下确认框或小窗都自己关了，有“目标变了，没有发送”的提示；A、B 的假 Claude 日志没有新字节，审计没有新的 `keys` 或 `takeover` 行。草稿在同一格换会话时保留，并提示“这格的会话换了”；换到 B 时清空。
    - 1.2：桌面上换到 B，2 秒内终端只剩 B 的画面。接管 B 后打的字进了 B 的日志，没进 A 的。接管 A 时换会话 id：仍是“你已接管键盘”，画面没被清空，焦点仍在 xterm，再打的字仍进 A 的日志。390 触屏的文字视图同样在 2 秒内换成 B 的画面。
    - 1.9：Task 页注入 409 `lock_timeout`，出现带“重试”的提示后，从左栏去同一 Work 的另一个 Task，提示与“重试”都不在了。新建页把新建 Work 的 POST 挂起，期间“新建 Task”是禁用的，点了也不切换；放行后清空的是 Work 表，Task 表里预先填的标题还在。这一条用的是假回包，没有写仓库。
    - 1.3：在 A 里打字后 goBack，原生确认框问了一次。之后地址是 B、仍在编辑页，编辑框是 B 的原文，没有“未保存”。
    - 1.4：把 PUT 延迟 3 秒。期间编辑框带 `readonly`，打字不改变内容；点左栏不离开页面，提示“正在保存”。保存完成后编辑框是服务端的文本（`updated` 已经改过），可以继续打字。
    - 1.5：`clearCookies` 后在编辑页保存，出现阻挡层，打的字还在。`/ws` 关闭，之后没有再握手。会话页与 checkout 页随后也进入失效状态，checkout 页 20 秒内没有再请求 `/api/checkouts`。在新标签页登录后，回到各页点“我已重新登录”：阻挡层消失，编辑页的字还在、能保存，会话页的终端重新出画面。
    - 1.6：`/api/overview` 延迟 2 秒，每 700 毫秒改一次克隆里 w00022 的目标。15 秒里请求 18 次、中止 0 次，卡片换过 7 个版本；停下后 4 秒内卡片显示最后一版。
    - 1.7：Work 页注入 503 后，出现“显示的是刚刚读到的内容；这次重取失败：……”与“重试”，原来的数据还在；撤掉拦截点“重试”，提示消失。注入 404 后，提示没有“重试”，只有“回到首页”，点了回到首页。
    - 1.8：用 `defineProperty` 把页面置为后台，再打开会话详情：没有建终端连接。改回前台后 3 秒内终端出画面。
    - 证据在本地 `.local/agent/works/w00022-dev-panel/tasks/t15-ui-polish/accept/`：
      - 脚本 `accept.ts`；
      - 最终一轮的结果 `results.txt`，前几轮（含失败）的结果 `results-attempts.txt`；
      - 20 张截图；
      - 两次起面板的日志 `panel-run1.log`、`panel-run2.log`，以及 `run-full.log`。
    - 控制台只有两类报错：注入的 409、503、404，与 1.5 里预期的 401。
  - 验收发现并修正的问题：新建页的模式锁实际没有生效。nb-ui 的 `SegmentedControl` 没有整体的 `disabled`，`:disabled` 落到了根节点上，提交在途时仍能切到“新建 Task”。改为提交在途时按选项禁用另一项（`16734c6fa`），重跑通过。这层接线在 `.vue` 里，单元测试测不到。
  - 偏离计划的地方：
    - 终端零件的 key 用这一条连接的序号（`host.connection`），没有用 paneId 加 terminalId：1.5 重新登录后，同一个终端也要重建连接；
    - `StaleNotice` 在首页、Work、Task 三页放在页面最上方，因为这三页的标题在数据块里面；其余页面放在标题下面。文档页的树与正文各放一条，两份都算主资源；
    - 1.7 顺带改了服务端 `state.ts`：重算从失败恢复时，即使内容没变也推一次。否则顶栏“后台重算失败”那一行要等别的变化才会消失；
    - 1.8 顺带改了测试环境：`useWebEnv(teardown)` 在拆环境之前收口。bun 按注册顺序跑 afterEach，写在 `useWebEnv()` 之后的 afterEach 会在环境拆掉之后才跑，停 scope 时已经碰不到 `document`；
    - 包的 `AGENTS.md` 没有改。建议回写“`bun test` 带 `--isolate`；前端宿主测试 `tests/web-*.ts` 用 `tsconfig.web-tests.json` 单独做类型检查”，要开发者批准后再写。
  - 没有验证到的地方：
    - 顶栏“后台重算某一块失败”那一行没有在浏览器里看过：造不出真实的重算失败，只有代码与类型检查；
    - 1.8 的后台是模拟出来的，原因见计划；
    - `StaleNotice` 里的“N 分钟前”只在重新渲染时更新，不会随时间自己走（未处理）。
  - 验收环境的收尾：
    - 4490 的面板已经 SIGTERM，浏览器已关，`/dev/shm/nbdev-t15-tmp` 与 cookie 文件已删；
    - herdr 命名会话 `nbdev-ui-review` 里另起的工作区 `w5`（格 `w5:p1`，假 Claude，文件在 `/dev/shm/nbdev-ui-review/fake2/`）留着。要关时运行 `herdr --session nbdev-ui-review workspace close w5`；
    - `w4:p1` 的会话 id 已改回 `71f9ae69-…`，屏幕文件已还原；
    - 克隆里多了 4 个“面板编辑 t16 README”提交，来自两轮 1.4 与 1.5 的保存；克隆的工作区是干净的。
  - 验收时踩到的坑：
    - herdr 换会话 id 要带比这一格已有值大的 `--seq`，否则静默丢弃；还要带 `--session-start-source clear`。herdr 不为这种变化推事件，面板靠有浏览器连着时的 500 毫秒轮询发现；
    - 有一轮在没有浏览器连着时改了会话 id，页面在面板第一次轮询之前读到了旧 id。读屏回 409 `session_changed`，“目标变了”的提示被这条覆盖。服务端的核对挡住了这次按键，没有发出去。
- 2026-10-13：阶段 1 实现审查（`.local/agent/works/w00022-dev-panel/tasks/t15-ui-polish/reports/impl-review-phase1.md`）的结论是 0 阻断、0 重要、5 条建议，可以合入。主 Agent 五条都采纳，合入前在集成分支上改完，一条一个提交，未 push：
  - 建议 1（`39149be2a`）：`readScreen` 把这一次读屏的结果交回调用方。按键的确认框读到了就用这一屏；没读到也照开（Esc、Ctrl+C 常在会话失控时用，不能因为读屏偶发失败就按不下去），说明里写出没读到的原因，以及框里是多久以前读到的画面。补了两条用例：没读到时写明旧画面，读到时用这一屏。
  - 建议 2（`1d3cfdb4c`）：发文字成功后按格（pane 加终端）清草稿，不按会话。发的是 `/clear`、回包前这格换了会话时，照样清空输入框并收起“会话换了”的提示。补了一条用例。
  - 建议 3（`152b46453`）：给 A 的文字判定不可投时已经换了目标，不再问“仍然发送”，提示“没有发出去”，带 A 的 pane 号；换了格时附上原文，因为输入框已经清空。补了一条用例。
  - 建议 4（`b00d23a6e`）：新建页切换模式时收起带“重试”的失败提示，“重试”不会提交另一张表。接线在 `NewPage.vue` 里，单元测试测不到，只跑了 `typecheck` 与 `build:web`。
  - 建议 5（`a4413f392`）：重新登录时面板连不上，原因直接用原文，不再重复“连不上面板”的前缀。补了一条用例。
  - 文档同步：`docs/panel.md` 的会话页一段与外壳一段，`parts/SessionConsole.md` 的 `resetKey` 说明。
  - 验证：包的 `typecheck`、`build:web` 通过，`tests/web-*.test.ts` 6 个文件 37 过、0 失败，`git diff --check` 干净。按主 Agent 的要求，没有再跑全量测试，也没有再做浏览器验收。日志在 `.local/agent/works/w00022-dev-panel/tasks/t15-ui-polish/accept/gate-review-fixes.log`。
- 2026-10-14：阶段 1 合入 `master`，开发者授权。
  - 在临时 worktree 里 `merge --no-ff`，得到合并提交 `81ddd9b68`（集成分支 `a4413f392`）；主工作区 `merge --ff-only` 快进过去。
  - 合并提交的 `packages/`、`scripts/` 与依赖清单和集成分支完全相同，全量 `test` 在集成分支的 `a4413f392` 上跑：374 过、0 失败。
  - 依赖没有变，服务单元也没有变，只做了 `service:restart`；4400 回 200，前端构建与预热完成。
  - 临时 worktree `.worktree/w00022-merge` 与审查 worktree `.worktree/w00022-t15-review` 已删除。没有 push。
- 2026-10-14：按主 Agent 的转告，把“还要定的”速览面板布局移进终稿，记为第 17 条（开发者已定，按推荐）；阶段 3 表格里 3b 的依赖改指第 17 条。包的 `AGENTS.md` 不回写 `--isolate` 那两条（开发者定）。
- 2026-10-14：阶段 2（外壳）做完，在集成分支 `feat/w00022-dev-panel` 上，未 push。
  - 提交（`f6a42d536..71cb539cb`，5 个，一片一个）：`8ac8211c4` 2a、`d8a44b6a8` 2b、`dab6003ba` 2c、`9383499ae` 2d、`71cb539cb` 2e。
  - 动手前的实测（脚本与输出在 `.local/agent/works/w00022-dev-panel/tasks/t15-ui-polish/accept/phase2/` 的 `probe1-xterm.ts`、`probe1.txt`、`probe2-splitter.ts`、`probe2.txt`）：
    - 第 1 条（xterm 的滚动条）：在会话页（1440×900，`w4:p1`）给空的 `.xterm-viewport` 加上 `scrollbar-width: none`，前后接管提议都是 163×32，列数不变；viewport 的 `offsetWidth − clientWidth` 从 15 变成 0。同一页另起一个带 1000 行回滚的探针终端（同一套暗色 token）：
      - 自绘滑块在暗色终端上看得见，悬停会加深；
      - 主题色写成 `color-mix()` 时 xterm 静默丢掉、退回缺省色（前景色的 20%），写成 8 位十六进制才生效；
      - 自绘条宽 14px，盖在终端右缘：按面板现在的算法（父元素宽度除以格宽，不减滚动条）量出的最后一列有一半在滑块下面，在最后一列上按下拖动选不中文字。现在 `scrollback: 0`，不受影响；阶段 4 给终端加回滚（D2）时，量列数要先减掉 14px。已写进 `TerminalView.md`。
    - 第 2 条（`Splitter` 放进外壳）：用原型（未提交）在 1280 宽量：
      - 窄屏沿用同一个 `Splitter`（sash 0、左栏收起、禁用）：编辑页在 390 与 1280 之间来回改两次，textarea 还是同一个元素、草稿在；会话页来回改两次，`/ws/terminal` 只握手一次；
      - `collapse` 能表达“拖到最小以下就收起”：最小 200、阈值 80 时拖到 x=100 收起（宽 0，读屏器读“已收起”），从收起处往外拖到 260 又展开；
      - 拖到 360 等 20 秒仍是 360；窗口 1100 时夹到 440，回到 1280 恢复 480；键盘方向键每步 10px，Esc 取消，Home、End 到上下限。
  - 门禁（在 `71cb539cb` 上跑）：包的 `typecheck`、`build:web` 通过；全量 `test` 380 过、0 失败、0 跳过，用时 6 分 25 秒，含 herdr L4 与前端宿主测试；`git diff --check f6a42d536..HEAD` 干净。另外跑了 `docs:check`、`governance:check`，没有错误，也没有与 dev-panel 有关的警告。
  - 浏览器验收：在 4490 上用集成分支的代码起面板，审查环境沿用，验收脚本是 `accept/phase2/accept.ts`。最终一轮在 `71cb539cb` 的构建上把 2a 到 2e 连着跑完，48 条全过，控制台没有错误与警告。证据在 `accept/phase2/final/`：`results-all.txt`、38 张截图（每片明暗两套、390 与 1440；左栏另有 1280、1920）、面板日志与门禁日志。
    - 2a：
      - 窗口右缘没有空带（`innerWidth` 与 `clientWidth` 都是 1440）；首页、会话页的内容区各只有 main 一条竖向滚动条；
      - 长页（首页）与短页（在跑，不溢出）切换时，main 的内容宽度都是 1182；
      - 文档页 main 不滚，树与正文各自滚；390 宽时上下堆叠，由页面的根滚，没有横向溢出；
      - 会话页能滚到底；终端的空 viewport 不再画原生轨道；同一页里放回原生轨道再量，接管提议的列数相同（166×32）。
    - 2b：
      - 900 高时首屏看得到“现场”（GitHub 那一行底边在 360px）；
      - Task 页左栏高亮当前 Task，并且滚进了 Work 树的可视区，所属 Work 那一行是淡高亮；
      - 左栏 Tab 停靠点从约 53 个降到 10 个；Tab 进 Work 树时停在当前那一行，方向键上移、左键回到所属 Work；
      - 被截断的标题悬停显示全文；390 的抽屉里有 Task 层，当前 Task 的高亮与桌面一致。
    - 2c：
      - 缺省 300，分隔线的可读名是“调整 导航 与 正文 的宽度”；鼠标拖到 360、等 20 秒不变；
      - 方向键每步 10px、Esc 取消、Home 到 200、End 到 480；刷新后恢复 420；
      - 窗口 1030 时夹到 412，回到 1440 恢复 420；
      - 拖到最小以内收起，顶栏出现“展开左栏”，点了恢复 420；“收起左栏”收起之后刷新仍收起；
      - 在 1440、1280、800、390 之间来回改窗口：编辑页的 textarea 不重挂、草稿在，会话页终端只握手一次；
      - 390 时左栏宽 0、分隔线不可聚焦，顶栏是“打开导航”。
    - 2d：
      - 1920 宽时搜索框 576px；正常时顶栏只有搜索、通知、状态点、明暗四个控件，没有横幅；点状态点看到推送、herdr、数据三行；
      - 页面上按 `/` 与 Ctrl+K 都聚焦搜索框；
      - 改写 `/api/meta` 的回应造出异常时，四条横幅（代码已更新、构建失败、审计未开启、后台重算失败）都出现；herdr 不可用时状态点变黄、写出原因；
      - 接管中按 Ctrl+K 与 `/`：假 Claude 的日志收到 `\x0b` 与 `/`，焦点仍在 xterm；
      - 编辑页的 textarea 里能打 `/`；390 宽时顶栏不横向溢出。
    - 2e：
      - 第一次 Tab 是“跳到主内容”（出现在左上角），按下去焦点到页标题；
      - 从左栏换到 Task 页，焦点到新页面的标题，标签页标题从“开发者项目面板与本地／入库边界 · nbdev”变成“面板界面打磨 · nbdev”；
      - 亮色下表头对比度 6.02:1；在文档树里连续选三份文档，焦点一直留在树里；文档页的标签页标题带文件名；
      - 键盘聚焦左栏条目时有 2px 的焦点环；390 宽时第一次 Tab 也是“跳到主内容”。
  - 验收中发现并当场修掉的问题（都在对应片的提交里）：
    - 2b：当前行滚进可视区时先找到的是所属 Work 那一行，Task 行还在树外。改为先找当前页那一行。
    - 2e：
      - 打开面板时，路由从没有名字的起始位置第一次解析，也被当成换页，焦点被放到了页标题，第一次 Tab 不是“跳到主内容”。改为第一次解析不算换页；
      - 等标题出现的那 5 秒里，开发者点进了文档树，标题出现时又把焦点抢走。改为焦点已经挪到别处就不抢。
  - 偏离计划的地方：
    - 2a：
      - 改完之后，接管时的整体列数比改之前多 3 列（163 变 166）：`html` 不再预留 15px 槽位、main 的滚动条变细，内容区宽了 19px，这是预期的。计划的验收点“接管终端的列数与改之前一致”针对的是只藏 viewport 轨道这一项，所以改成同一页里放回轨道再量、两次相同；
      - 终端滑块的颜色拼成 8 位十六进制，新增 `host/terminal-colors.ts` 与 L1 测试。
    - 2b：
      - Work 树用 roving tabindex：展开按钮不进 Tab 顺序，键盘用左右键展开、收起；
      - 状态写坏的 Work 也收进“更多”；当前 Work 在“更多”里时，“更多”自动展开；
      - 截断提示用 nb-ui 的 `Tooltip`，只给真的被截断的行；
      - 品牌行保留为去首页的链接。
    - 2c：
      - 面板 id 用“导航”“正文”：`Splitter` 拿 id 拼分隔线的可读名；
      - “收起左栏”放在 `PanelNav` 新加的 `actions` 插槽里；收起与展开的阈值都是 80px，正文最小 360px。
    - 2d：
      - 状态点用 nb-ui 的 `Popover`；搜索框的快捷键写在占位文字里，并加了 `aria-keyshortcuts`；
      - “审计未开启”按计划改成常驻横幅：审计没初始化的机器上，这条会一直在，太吵的话可以改成可关掉；
      - 决定点 11 的 Ctrl+] 在阶段 4 做，2d 的快捷键不处理它。
    - 2e：
      - 换页时 main 回到顶上：main 在各页之间是同一个元素，以前上一页的滚动位置会带到下一页（从代码推断，没在改之前实测）；
      - 灰字改色挑了 33 处承载信息的（编号、元信息、计数、小节名、对话框里的标签），空状态、占位、“未标”、提示语不动；
      - 两张 nb-ui `Table` 加了 `nbdev-table`，表头改色。
  - 没有验证到的地方：
    - 只在 Chrome 上看了滚动条，Firefox、Safari 与 Windows 的经典滚动条没看；
    - 推送断开时状态点的样子没在浏览器里造（只造了 herdr 不可用）；
    - 1024 断点的边界（1023 与 1024）没有单独测，测的是 800、1030、1100；
    - 手机上从抽屉里点导航之后，焦点会不会到页标题没有验证：Reka 关抽屉时会把焦点还给“打开导航”，可能先于外壳挪焦点，那样外壳就不抢了；
    - 等页标题出现的路径只在 Task 页与文档页走过。
  - 与本阶段无关的观察：文档页渲染仓库根的 `README.md` 时，外站的徽章图片被面板的 CSP 拦下，控制台报错（`img-src` 只许本源与产物来源）。验收脚本改用别的文档绕开；要不要在 Markdown 改写时去掉外站图片，留给阶段 4 的文档页。
  - 验收环境的收尾：4490 的面板已经 SIGTERM，浏览器已关，`/dev/shm/nbdev-t15-tmp` 已删，克隆的工作区是干净的（阶段 2 没有写入）。herdr 命名会话里的 `w4:p1`、`w5:p1` 没动，会话 id 还是 `71f9ae69-…` 与 `bbbb0002-…`。
