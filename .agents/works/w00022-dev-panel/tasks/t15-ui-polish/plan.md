# t15 实施计划：面板界面打磨

草案，交主 Agent 与设计审查（编码子代理 2026-10-13 写）。阶段 1 写细，阶段 2 到 4 写轮廓。

范围与决定以本目录的 [改动方案](design.md) 为准（含开发者定的 D1 到 D5）；任务见 [README](README.md)，开发者的试用建议见 [后续清单](../../followups.md)。依据的四份审查报告在本地 `.local/agent/works/w00022-dev-panel/tasks/t15-ui-polish/reports/`（`omp-frontend-review.md`、`ux-a.md`、`ux-b.md`、`ux-c.md`），截图在同目录的 `shots/`。下文的“omp 重要 3”“ux-b F1”等编号都指这几份报告。

执行位置：集成分支 `feat/w00022-dev-panel`（worktree `.worktree/w00022-dev-panel`），已快进到 master `8a1a2a105`。审查基线是 `5cf816f1c`，此后 `packages/dev-panel/src/web/` 没有改动，报告里的行号仍然对得上。

## 计划前的核实（2026-10-13，只读）

- **四份报告的代码结论逐条按源码核对过**，结果写在阶段 1 各条的“根因”里。omp 有三处需要补充或修正：会话页的接管确认也没绑定目标，omp 没列出；文字发送有屏幕摘要挡着，只有按键完全没有保护；编辑页在途的保存回包也会写进新文件的草稿。
- **xterm 6.0.0 的滚动条**：在 4490 的审查面板上实测（1440×900，`?pane=w4:p1`），ux-c 与 omp 说的各对一半：
  - `.xterm-viewport` 还在，是一个没有子节点的空 div。xterm.css 给了它 `overflow-y: scroll`，所以有一条 15px 的原生轨道（`offsetWidth` 1064、`clientWidth` 1049）。这就是 ux-c 量到的“恒占 15px”；
  - 真正滚动的是 xterm 自绘的 `.xterm-scrollable-element > .scrollbar.vertical`（宽 14px，不滚时带 `invisible` 类）。这是 omp 说的自绘条，颜色走 `ITheme` 的 `scrollbarSlider*`；
  - 两者都不改终端的测量：列数按 `.xterm` 的父元素量。现在 `scrollback: 0`，自绘条从不出现。

  因此阶段 2 的做法是：空 viewport 的原生轨道直接藏掉（`scrollbar-width: none`）；自绘条用 xterm 的主题色。D2 给终端加回滚之后要再实测一次，见“要先实测才能定的问题”。
- **Task 页正文右边的空白**（开发者第 2 条、ux-a S5）：按代码与截图核实成立。`app.css` 给 `.nbdev-markdown` 限了 `max-width: var(--reading-measure, 72ch)`，外面的卡片却随 `minmax(0,1fr)` 撑满。1440 宽时卡片约 740px、正文约 600px，屏幕越宽空白越多。文档页同理。阶段 3、4 改，见阶段 4 的“Task 页”。
- **产物页显示已答的内容**：不需要改服务端。`/api/artifact/...` 已经返回 `answers`（每份答复的值、时间、版本）与每题的 `answer`，`QuestionPanel` 也有折叠的“已答 N”。ux-b F4 看到空白，是因为 t11-notify/questions 的题已在后来的版本里取代，当前版本没有“已答”状态的题。界面加一段“提交过的答复”（按 `answers` 列出）就够，阶段 4 做。
- **首页按产物合并提问**：不需要改服务端。`overview.inbox` 的每条提问带 `workId`、`taskId`、`artifactId`，前端分组即可。

## 阶段 1：行为缺陷（不改外观）

omp 的阻断 1 与重要 3 到 9，共八条。阻断那一条会向错误的会话发按键，开发者正在用面板，所以这一阶段先做、先合入。只改行为，不改布局与样式；新出的提示先用现有的 `WriteNotice`、`LoadState`，阶段 3 再换成统一的反馈零件。

### 共同做法

**宿主逻辑收进组合函数。** 身份错位都出在页面里的异步状态迁移上，这些逻辑现在写在 `.vue` 的 `<script setup>` 里，测不到。改为收进 `src/web/host/` 下的普通 `.ts` 组合函数，页面只做接线：

- `host/session-console.ts`：`useSessionConsoleHost`。管会话页“当前目标”的身份、读屏与读更早的输出、发文字、发按键、两步确认、接管小窗；
- `host/file-edit-session.ts`：`useFileEditSession`。管编辑页的路径身份、基线与草稿、保存、冲突与结果未知；
- `host/panel-data.ts`、`host/api.ts`、`host/terminal-socket.ts`：原地改。

组合函数不碰 `vue-router`、`window.matchMedia`、DOM。路由守卫、窄屏判断、模板仍在页面里；页面把 `selected`、`path` 这类响应式输入传进去。

**测试方法：bun test，加 Vue 真实的响应式与 `effectScope`。**

- 文件放在包的 `tests/` 下，例如 `tests/web-session-console.test.ts`，与现有的 `tests/terminal-input.test.ts` 一样直接导入 `src/web/host/*.ts`。
- 新增一个测试用的环境文件 `tests/web-env.ts`，在每个用例里装上、用完拆掉：
  - `globalThis.fetch`：记下每个请求，按用例给的表回外壳，可以挂起、延迟、回 401 或 503；
  - 假的 `WebSocket` 类：记下实例；用例可以推消息、触发 `close`；
  - 最小的 `document`（`visibilityState`、`addEventListener`，以及给 CSRF 用的 `querySelector`）、`window`（`addEventListener`、`pagehide`）、`location`、`localStorage`。
- 用例在 `effectScope().run(...)` 里调组合函数，改输入的 `ref`，`await nextTick()` 或等请求落定，再断言发出的请求与状态；结束时 `scope.stop()`。
- **测的是真实的那段代码**：被测的就是页面运行时调用的组合函数，以及它真实导入的 `api.ts`、`panel-data.ts`、`terminal-socket.ts`。替换掉的只有浏览器全局对象与服务端。没有测试专用的分支或导出，组合函数也不为测试加注入参数。
- **测不到的部分**：
  - 页面模板的接线：`:key`、把 `readonly` 绑到编辑器、在哪里显示提示；
  - 真实 DOM、xterm 的渲染、真实的路由守卫与确认框。

  这些由浏览器验收覆盖，各条写明。
- `panel-data.ts` 是单例（一条 `/ws`、模块级的订阅表），bun 在同一个进程里跑测试文件，所以涉及推送的用例都放在同一个文件 `tests/web-panel-data.test.ts`，每个用例用完都停掉自己的 scope。

**浏览器验收：在 4490 的审查面板上做**（登录方法见本地 `reports/review-env.md`）。
- Playwright 驱动本机 Chrome，去掉 `--hide-scrollbars`；同一时间只开一个浏览器，`TMPDIR` 与用户数据放 `/dev/shm`，用完删掉；
- 脚本与截图放本地 `.local/agent/works/w00022-dev-panel/tasks/t15-ui-polish/accept/`；
- 前端产物：先在集成分支 `build:web`，不重启 4490 面板。4490 面板用的是哪份 `dist/web`、能不能换，要问主 Agent。换不了时，在同一个克隆上另起一个面板（端口 4520/4521，`--static-dir` 指集成分支的 `dist/web`），连同一个命名会话 `nbdev-ui-review`；验收完停掉；
- 有两类场景要对 herdr 命名会话 `nbdev-ui-review` 做写调用，**要主 Agent 同意**：
  - 再起一格假 Claude，用同一个 `fake-claude-tui.py`，屏幕上写不同的标记，让面板里有两格 Agent 会话；
  - 用 `pane report-agent-session` 改一格的会话 id。

  不同意时，另起一个命名会话 `nbdev-t15-accept` 与上面那个 4520 面板，复制 review-env 的做法；
- 判断“有没有发出去”看三处：假 Claude 的输入日志（`fake/tui.log`）、审计（克隆的 `xdg/nbdev/audit.jsonl`）、Playwright 记下的请求。

### 1.1 阻断 1：会话页的两步确认没有绑定目标

**根因（核实成立，补两处）。**
- `SessionsPage.vue` 的 `sendPrompt`、`sendKey` 在执行时才读 `selected.value`。
- 两步确认存的回调是 `() => sendKey(key, true)`、`() => sendPrompt(text, digest)`，确认那一刻发给的是“现在选中的”，`expectedSession` 也取现在的，服务端的会话核对拦不住。
- 选中目标会在确认框打开期间变：
  - 推送更新了 `sessions`，这格 pane 换了会话（`/clear`、`--resume`）；
  - 用浏览器后退改了 `?pane=`；
  - 这格 pane 消失了。
- `pressKey` 先 `await readScreen()` 再开确认框，这段等待里目标变了也不查；确认框显示的屏幕可能已经属于别的会话，或者是空的。
- 补充一：**按键完全没有保护**。文字那一支有屏幕摘要挡着：服务端对新目标重新判定，摘要对不上就不发。只有新目标的判定原因与屏幕末尾都恰好相同时才会误发（例如同一格 `/clear` 之后屏幕一样）。
- 补充二：**接管确认同样没绑定目标**，omp 没列出。`confirmTakeover` 也在确认时读 `selected.value.sessionKey` 与 `terminal.value`，目标换了就接管新会话。
- 通知的发送（`notify-actions.ts` 的 `deliver`）在确认回调里带着 `job` 与 `target`，已经绑定，不受影响。

**改法。**
- `useSessionConsoleHost({selected, terminal})`：
  - 目标身份记为 `{paneId, terminalId, sessionKey}`；
  - `sendPrompt(target, text, confirmScreen)`、`sendKey(target, key, confirmed)` 都显式带目标；
  - 确认框存一份 `{target, kind, ...}`。`confirmRun` 先比对目标是否与当前选中一致，不一致就不发，给一条警告：“确认框打开期间目标变了（A → B），没有发送”。
- `watch` 目标身份（三项一起比），一变就：
  - 关掉会话页自己的确认框与接管小窗；
  - 清掉 `lastConflict`、屏幕、更早的输出与提示；
  - 作废在途的读屏与读历史：带序号，回来时三项身份都对上才写，不再只比 `paneId`。
- `pressKey` 在 `await readScreen()` 之后先核对目标没变，再开确认框，屏幕取这次读到的。
- 接管小窗也记下目标；确认时目标变了就不接管、给同样的提示。
- 会话页的确认改用组合函数自己的 `confirm`，不再借 `notifyActions.confirm`（通知那份留给通知）；页面上的 `ScreenConfirmDialog` 显示两者中开着的那一个。服务端的 `expectedSession` 照旧保留。

**文件与文档。**
- `src/web/host/session-console.ts`（新）、`src/web/pages/SessionsPage.vue`、`src/web/host/notify-actions.ts`（只在需要时把 `ScreenConfirm` 类型导出给会话页复用）；
- `parts/ScreenConfirmDialog.md`、`parts/TakeoverDialog.md`：写明“确认针对打开时的目标，目标变了宿主会关掉它”；
- `docs/panel.md`：“通知与会话页”的两步确认一段加上“确认绑定打开时的目标（pane、终端、会话），目标变了自动取消并提示”。

**测试（`tests/web-session-console.test.ts`）。**
- 选中 A，按 Enter 开确认（假 fetch 先回 A 的屏幕）→ 把 `selected` 改成同一 pane 的会话 B → `confirmRun()`：断言没有发出 `/keys` 请求，确认框关了，有“目标变了”的提示；
- 同一流程换成改 `?pane=` 对应的另一格：断言同上；
- 文字的“仍然发送”：目标变了不发；
- 读屏挂起期间目标变了：回来的屏幕不写进状态，也不开确认框；
- 接管小窗打开期间目标变了：确认不调用 `terminal.takeover`；
- 正常路径：目标不变时确认照常发出，请求里的 `paneId`、`expectedSession` 是打开时的那个。

**浏览器验收。**
- 需要两格 Agent 会话 A 与 B（见共同做法）。
- 场景一（换 pane）：先打开 B（`?pane=B`），再从列表打开 A，按 Enter，确认框出现后执行 `page.goBack()` 回到 B。断言：确认框关闭、出现提示；A、B 的假 Claude 日志都没有新的 `\r`；审计没有新的 `keys` 行。
- 场景二（同一格换会话）：打开 A，按 Esc 开确认框，对 A 运行 `pane report-agent-session` 换一个会话 id，等面板的轮询发现（有浏览器连着时 500 毫秒）。断言同上。
- 场景三（接管）：开“接管键盘”小窗，同样换 pane 或换会话。断言没有接管：审计没有 `takeover` 行，终端仍是“观看中”。
- 改 herdr 不被同意时，场景二用场景一的换 pane 代替，并在记录里写明“同一格换会话只由 L3 覆盖”。

### 1.2 omp 重要 3：换终端之后零件不重新订阅

**根因（核实成立，补一处）。**
- `TerminalView`、`TerminalTextView` 只在 `onMounted` 里 `source.subscribe`，没有 `watch`。
- 页面换目标时在同一个 `watch` 回调里先置 `null` 再赋新的 `terminal`，Vue 在同一轮里合并渲染，`v-if` 两次都为真，零件实例原地复用，只换了 `source` prop。
- 结果：画面停在旧终端，输入、resize、接管却经 `terminal.value` 发给新终端。
- 补充：`SessionConsole` 也没有身份 key，输入框里给 A 写了一半的文字会留给 B（`resetKey` 只在发送成功时加一）。

**改法。**
- 页面给 `TerminalView`、`TerminalTextView` 加 `:key`，值是终端身份（`paneId + terminalId`），换终端就整体重建：重新订阅，新的 xterm 实例从空屏开始；
- 给 `SessionConsole` 加会话身份 key（`paneId + sessionKey`），换会话就丢掉旧草稿，见决定点 2；
- 身份 key 的计算放在 `useSessionConsoleHost` 里导出，页面只绑定；
- 两个终端零件的 `.md` 写明合同：“`source` 在实例的一生里不变；宿主换终端时用 key 重建”。是否另加一个 `watch(source)`、违反合同时 `console.error` 一次，见决定点 3，推荐不加；
- 顺带：`TerminalTextView.md` 的标签补上 `env:timer`（200 毫秒的节流定时器，omp 已核对过的伴生声明遗漏）。

**文件与文档。** `src/web/pages/SessionsPage.vue`、`src/web/host/session-console.ts`、`parts/TerminalView.md`、`parts/TerminalTextView.md`、`parts/SessionConsole.md`。`docs/panel.md` 的“网页终端”一节加一句“换选中的会话时终端与输入框整体重建”。

**测试。**
- L3 只覆盖身份 key 的计算：同一终端换会话时，终端 key 不变、会话 key 变；换 pane 时两者都变。
- key 有没有绑到模板上，单元测试测不到，由浏览器验收覆盖。

**浏览器验收。**
- 两格 Agent 会话 A、B 的假屏幕写不同的标记。
- 桌面：打开 A，等 `.xterm-rows` 出现 A 的标记，在列表里点 B 的“屏幕与输入”，2 秒内 `.xterm-rows` 是 B 的标记、不再有 A 的。接管 B 后打一个字：B 的日志有，A 的没有。
- 手机（390，触屏）：在文字视图里做同样的切换，比对 `aria-label="终端的当前屏幕（文字）"` 的文字。
- 草稿：在 A 的输入框里打几个字，切到 B，输入框是空的。

### 1.3 omp 重要 4：编辑页换文件之后草稿不换

**根因（核实成立，补一处）。**
- 改 `?path=` 经 `onBeforeRouteUpdate` 确认之后，`useResource` 先把 `data` 置 `null` 再取新文件。
- `watch(file.data)` 遇到 `dirty` 就返回；新文件到达时 `draft` 仍不等于旧的 `base.text`，`dirty` 仍为真，于是 `base`、`draft` 一直是 A 的。
- `mismatch`、`uncommitted`、`notice` 也不清。
- 补充：在途的保存回包会写进新文件的状态。`save()` 成功后无条件用回包改写 `base`、`draft`；A 的保存还没回来时切到 B（`onBeforeRouteUpdate` 拦得住 dirty 的情形，拦不住“刚点了保存”的情形），A 的回包就落到 B 上。

**改法。**
- `useFileEditSession(path)`：
  - 内部用 `useResource` 取 `/api/files?path=`；
  - 状态带一个“会话代号”，`path` 变了就加一，同时清空 `base`、`draft`、`mismatch`、`uncommitted`、`notice`；
  - 新文件到达且代号对得上时建立基线；
  - `save()`、`loadMismatch()`、`checkAfterUnknown()` 开始时记下代号与路径，回来时代号变了就丢弃回包。只丢状态更新，写入本身照样发生；
- “未保存不让走”仍由页面的路由守卫保证，组合函数只负责“允许离开之后不留旧状态”。

**文件与文档。** `src/web/host/file-edit-session.ts`（新）、`src/web/pages/EditPage.vue`；`docs/panel.md` 的“编辑页的未保存改动”加一句“换文件之后编辑器、基线与提示都换成新文件的；旧文件在途的保存回来时不再改写编辑器”。

**测试（`tests/web-file-edit.test.ts`）。**
- A 载入后把草稿改成“A 改了”，路径改成 B，B 到达：`base` 与 `draft` 都是 B 的，`mismatch`、`notice` 为空；
- A 的保存挂起时路径改成 B，再放行保存回包：`draft` 仍是 B 的，没有“已保存”的提示；
- 同一个文件重取（`file.reload()`）且有未保存的改动时，草稿不被覆盖（保留原来的保护）。

**浏览器验收（克隆里的两份 README，写入只进克隆）。**
- 用 SPA 导航依次打开 `/edit?path=B`、`/edit?path=A`：经 Task 页的“编辑 README”链接进入，或用 `__vue_app__` 上的路由 `push`，只用于驱动验收；
- 在 A 里打字，执行 `page.goBack()`，接受原生确认框；
- 断言：编辑框是 B 的原文，标题路径是 B，没有“未保存”徽标。

### 1.4 omp 重要 5：保存期间继续输入，成功回包会盖掉

**根因（核实成立）。** `FileEditor` 的 `readonly` 只看 `blocked`。保存在途时可以继续打字，成功后无条件 `draft = 回包文本`，新打的字丢掉，`dirty` 变假，离开也不再提示。

**改法。**
- 保存在途时编辑器只读（`readonly = blocked !== null || saving`），页面上的保存入口防重入（已有 `write.pending`）。不做“边保存边改”的合并，见决定点 4；
- 回包改写 `draft` 之前，再核对一次 `draft` 仍等于提交的文本：只读之下这条恒成立，留作保护，不另开分支。

**文件与文档。** `src/web/host/file-edit-session.ts`、`src/web/pages/EditPage.vue`；`parts/FileEditor.md` 的 `readonly` 说明加“保存在途时宿主也会置只读”；`docs/panel.md` 同一段加“保存在途时编辑器只读”。

**测试。**
- 保存挂起时 `saving` 为真，组合函数给出的只读为真；
- 挂起期间直接改 `draft`（模拟绕过只读）再放行：草稿不被回包覆盖，`dirty` 仍为真；
- 正常保存后草稿换成服务端写下的文本（README 的 `updated` 被改过的情形）。

**浏览器验收。**
- 用 `page.route` 把这次 `PUT /api/files` 延迟 3 秒再放行，模拟在等写锁；
- 点保存后立即往编辑框打字：断言打不进去（`textarea` 有 `readonly`），3 秒后显示“已保存”，编辑框是服务端文本。

### 1.5 omp 重要 6：写请求遇到 401 不进入全局的“要重新登录”

**根因（核实成立，补一处）。**
- 只有 `useResource`、`SearchPage` 的流式搜索、两处重连探测把 401 转成 `panelState.unauthorized`；
- `sendJson`、`useWrite` 与页面里直接的 `getJson`（读屏、读历史、编辑页取当前版本）都只给局部错误；
- 新建页的预览 401 被当成“预览问题”，不挡提交；
- 应用级的 `/ws` 重连定时器没有保存，没有停止入口。
- 补充：外壳在 `unauthorized` 时用 `v-if` 换掉整个界面，`RouterView` 被卸载。编辑页的草稿、答复表单里填了一半的答案会随之丢掉。改成写请求也触发之后，这条路径会更常走到，见决定点 1。

**改法。**
- `api.ts`：
  - 加一个认证失效的事件出口，例如 `onAuthLost(listener)`；
  - `readEnvelope` 与 `streamLines` 遇到 HTTP 401 就触发它，同时照常抛 `ApiError`，让调用方的局部说明仍然成立；
  - 只看状态码，不看文案。
- `panel-data.ts` 订阅这个事件：
  - 置 `unauthorized`；
  - 关掉 `/ws`，取消已排的重连定时器（把定时器存下来），之后推送不再触发重取；
  - 删掉 `useResource`、`probeBeforeReconnect` 里各自的 401 分支，改走同一个出口。
- `SearchPage`、`terminal-socket.ts` 的 401 分支同样改走这里。`terminal-socket` 收到全局失效时停止重连。
- 外壳怎么呈现失效，按决定点 1 定：推荐改成盖在页面上的阻挡层，不卸载 `RouterView`。

**文件与文档。** `src/web/host/api.ts`、`host/panel-data.ts`、`host/terminal-socket.ts`、`pages/SearchPage.vue`、`App.vue`（只在采纳决定点 1 时改）；`docs/panel.md` 的“数据宿主”一句改成“任何 `/api/*` 请求回 401（读、写、预览、探测、流式搜索）都进入登录失效状态，停止推送与重连”，并写明失效时的界面。

**测试（`tests/web-panel-data.test.ts` 与 `tests/web-api.test.ts`）。**
- 假 fetch 对 `sendJson` 回一个合法的 401 外壳，经 `useWrite` 处理：`panelState.unauthorized` 为真，`useWrite` 仍拿到局部的失败；
- 失效之后假 `WebSocket` 已经 `close`，等过重连的最短间隔（1 秒）没有新建连接；
- 再推一条消息，订阅了的资源不再发请求；
- 流式搜索的 401 同样触发。

**浏览器验收。**
- 登录后打开新建页，填一点表单，然后 `context.clearCookies()`；
- 触发一次预览（改一个字段）或一次状态切换：断言出现登录失效的界面；
- 按决定点 1 的结论，或者整个界面换成提示，或者阻挡层盖在页面上、表单里的字还在；
- 推送连接已断开：Playwright 记下 `/ws` 的 close，之后没有新的 `/ws` 握手。

### 1.6 omp 重要 7：连续推送时慢资源一直被中止

**根因（核实成立）。**
- 每次推送都直接 `load(true)`，开头 `controller?.abort()` 中止在途的请求，没有在途合并，推送间隔短于请求耗时就永远收不到数据；
- 外壳与首页各取一次 `/api/overview`，外壳与会话页各取一次 `/api/meta`、`/api/notify`；
- 服务端 `records` 或 `sessions` 变了会接着重算 `activity`，一次改动常带来两条相邻的推送。

**改法。**
- `useResource` 改为单飞：
  - 在途时再来推送或 `reload()`，只记一个 `dirty`，不中止；
  - 在途的请求结束（成功或失败）后，`dirty` 为真就再取一次，最多补一次；
  - 只有 `path` 变了、或 scope 销毁时才中止；`path` 变了立即重取，不等在途的请求。
- 保留“只接受最后一次请求、revision 不回退”的判断。
- 同一个地址在不同组件之间共用请求，本阶段不做，见决定点 5。

**文件与文档。** `src/web/host/panel-data.ts`；`docs/panel.md` 的“数据宿主”加“同一个资源的重取单飞：在途时再有变化只记一笔，结束后至多再取一次；只有地址变了才中止”。

**测试。**
- 假 fetch 每次 80 毫秒才回，假 `WebSocket` 在 600 毫秒里每 30 毫秒推一条 `records` 变化：
  - 被中止的请求数为 0；
  - 推送期间至少接受 3 次数据；
  - 推送停下后恰好再取一次，最后的数据对应最后一次推送之后的状态。
- `path` 变了：在途的请求被中止，新地址立即取；旧地址的回包不写进 `data`。
- 失败之后有 `dirty` 也照样补取一次。

**浏览器验收。**
- 用 `page.route` 把 `/api/overview` 延迟 1.5 秒；
- 同时在克隆里每 300 毫秒改一次某个 Work 的 README 正文：只进克隆，不提交也会让 `records` 变；
- 10 秒内：Playwright 记下的 `/api/overview` 请求里被中止的为 0，首页的数据至少换过 3 次（看页面上一个随改动变化的文字）；
- 停止改动后 2 秒内页面是最后一次改动的内容。

### 1.7 omp 重要 8：已有数据时重取失败，界面不提示

**根因（核实成立）。**
- `useResource` 在 `keepData` 时失败只设 `error`、保留 `data`；
- 订阅推送的 10 个页面都只在 `!data` 时显示 `LoadState`，所以这种状态完全不显示。这 10 个页面是首页、Work、Task、产物列表、产物、文档（树与正文两份资源）、会话、在跑、checkout、GitHub；
- 外壳顶栏的“数据 N 分钟前”只看 `meta.parts.records.at`，不代表当前页面这次刷新成功；`meta.parts.<块>.error`（后台重算失败）从不显示。

**改法。**
- `useResource` 加两项：`receivedAt`（最近一次接受数据的时刻）；`stale`（`data` 与 `error` 同时存在）。
- 新零件 `StaleNotice`（带同名 `.md`）：一行紧凑的提示，写“显示的是 N 前读到的内容；这次重取失败：<原因>”，加一个“重试”。
  - 404 写“已经找不到了（可能被删或改了名）”，不给重试，给“回到上一级”的链接（链接由页面给）。
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
- Work 页先正常显示；用 `page.route` 让之后的 `/api/work/...` 回 503，再在克隆里改一下这个 Work 的 README，触发推送重取；
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
- 再用 SPA 导航打开 `?pane=w4:p1`，让终端在“后台”建起来；
- 改回 `visible` 并派发事件：断言 3 秒内终端出画面（`.xterm-rows` 有假 Claude 的标记）。

### 切片、验证与合入

- 一条一个提交：
  - 1.0 测试环境 `tests/web-env.ts`（带一条冒烟用例）；
  - 1.1；1.2；1.3 与 1.4 共用新的组合函数，分两个提交，1.3 在前；1.5；1.6；1.7；1.8。
- 每个提交都过包的 `typecheck`、`build:web` 与相关测试；阶段末跑全量，按 `docs/testing/README.md` 的验证门禁。
- 浏览器验收在阶段末统一做一遍（八条），截图与日志放本地 `accept/`。
- 合入：阶段 1 单独合入 `master`。合入后要重启常驻服务，重启前先问开发者（D5）。
- 禁止清单照旧：
  - 不按错误文案分支；没有静默的 `catch`；
  - 不为过测试放宽断言，不加测试专用的分支或导出；
  - 不删任务之外的代码；不跨包深导入。

## 阶段 2：外壳（轮廓）

| 片 | 内容 | 依赖 | 验收要点 |
|---|---|---|---|
| 2a 滚动条与滚动权 | `app.css` 一处声明细滚动条（`scrollbar-width: thin`，颜色由 `--text-muted` 派生，悬停加深，明暗跟主题）；`html` 不预留滚动条槽位；左栏的 Work 区、`main`、文档页两栏 `scrollbar-gutter: stable`；路由元信息声明“铺满”（文档、会话）或“流式”，外壳据此决定 `main` 滚不滚；xterm 的空 `.xterm-viewport` 藏掉原生轨道，自绘条用 `ITheme.scrollbarSlider*`（`host/terminal-theme.ts`）。同步 `docs/panel.md`“前端”一节的“一页一个竖向滚动者”约定 | 无 | 去掉 `--hide-scrollbars` 截图：窗口右缘没有 15px 空带；同屏最多一条竖条加局部横条；短长数据切换时 `main` 的内容宽度不跳；接管终端的列数与改之前一致（只藏 viewport 的轨道） |
| 2b 导航零件 | 抽出 `parts/PanelNav.vue` 与 `.md`，桌面左栏与手机抽屉共用；上段固定（首页与收件箱、新建、资料、现场与计数），下段是可滚的 Work 树；按路由自动展开所属 Work、高亮当前项、滚进可视区；被截断的标题悬停显示全文；Work 树按 D4 只列进行中的与 30 天内更新过的未标 Work，其余收进“更多”。导航条目来自面板自己的小描述表，路由仍显式声明 | 2a（左栏的滚动所有者） | 900 高时首屏看得到“现场”；Task 页左栏高亮当前 Task；抽屉里有 Task 层且与桌面一致；Tab 次数明显减少 |
| 2c 可调宽度 | nb-ui `Splitter`：左栏 `sizing: fixed`、右侧 `weight`；D4 的默认 300px、最小 200px、最大取 480px 与视口 40% 中较小的；拖到最小以下收起，另给收起按钮；宽度经 `host/prefs.ts` 在 `gesture-end` 时写一次，渲染前同步读；拖动期间屏蔽产物页 iframe 的指针事件；窄屏用抽屉，断点切换时 `RouterView` 不重挂 | 2b | 鼠标、键盘（方向键、Home、End、Esc 取消）都能调；刷新后恢复；窗口变窄时夹住、变宽时恢复用户要的宽度；断点来回切换时编辑草稿与终端不丢 |
| 2d 顶栏 | 搜索框限宽，加 `/` 与 Ctrl+K 聚焦；正常状态（herdr、推送、数据新旧）合成一个状态点，点开看详情；“代码已更新”“前端构建失败”“审计未开启”与阶段 1 的后台重算失败，改成顶栏下的一条横幅；“通知要处理”保持醒目 | 2a | 1920 宽时搜索框不拉满；正常时顶栏只剩搜索、状态点、通知、明暗；异常时横幅出现 |
| 2e 可访问性小项 | “跳到主内容”；路由切换后焦点放到页标题；`document.title` 写成“页面名 · nbdev”；焦点环用 nb-ui 的焦点令牌；承载信息的灰字（表头、编号、元信息）改用 `--text-secondary` | 2b（导航结构定了再做跳转与焦点） | 第一次 Tab 出现“跳到主内容”；标签页标题随页变；亮色下表头对比度不低于 4.5:1 |

先后：2a → 2b → 2c；2d、2e 在 2b 之后，可以并行。

风险：
- **原子类的层序**：nb-ui 的原子类不分层，面板的也不分层，靠加载顺序取胜（omp 建议 6）。新加的面板语义类一律 `nbdev-` 前缀，不给整份 nb-ui 的 CSS 包 `@layer`。
- **`Splitter` 的布局**：它“铺满父级并裁切溢出”，与外壳现在的 grid 怎么组合要先试（见下一节）。
- 宽度偏好要在渲染前读到，否则刷新时先 300px 再跳到存下的宽度。
- 2a 把主应用 `app.vue` 末尾那份细滚动条的配方搬过来时，只用标准属性。Chrome 121 以后设了标准属性，`::-webkit-scrollbar` 就被忽略；thin 实际是 10 到 11px，不是 6px（ux-c 实测）。

## 阶段 3：页面骨架与共用零件（轮廓）

| 片 | 内容 | 依赖 | 验收要点 |
|---|---|---|---|
| 3a 语义类 | `app.css` 加少量 `nbdev-` 语义类：字号五档（页标题、区标题、正文、说明、标注）、区块间距、面层（`nbdev-surface`），替换散落的内联 `style` 与重复的 `bg-subtle` 提示块 | 阶段 2 | 各页字号与间距只剩五档、三档；内联 `style` 的条数明显下降（`grep` 计数前后对比） |
| 3b `PageShell` | 面包屑、标题、状态、右上操作槽，内容宽度分三档（阅读、列表、满铺），14 个页面都套；文档页、编辑页补页头。阅读档的卡片宽度跟着正文的阅读宽度走，修掉 Task 页、文档页正文右边的空白 | 3a | 各页标题的顶边位置一致；Task 页、文档页卡片右边不再空一片；首页之外的页面都有可回上一级的面包屑 |
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

按页切片，每页一个或几个提交，彼此基本独立；涉及服务端的单列在后面。

- **首页**（ux-b F5、ux-a S7、开发者第 4 条）：
  - 第一屏是“等我”：待答的提问按产物合并（前端分组即可）、要处理的通知、异常；
  - 撞号写明原因与去哪里处理；
  - Work 排序：有事等我的在前，其次进行中，再按最近更新；卡片改紧凑。
  - 验收：同一产物的三道题合成一行“uxq：3 道待答”；撞号能点到说明。
- **Work 页**（开发者第 1 条、ux-b F10、ux-a R6）：
  - Task 行可以就地展开，展开后是当前情况、下一步、产物、证据、谁在动；
  - 标题列加宽、单行截断；“当前情况”按行内 Markdown 渲染；为 0 的计数淡化。
  - 展开的数据从哪来见决定点 9：现在的 Work 接口里每个 Task 只有摘要。
- **Task 页**（开发者第 2、3 条）：
  - 状态只显示一处；正文卡片按阅读宽度（3b）；
  - 产物、证据、文档在侧边速览面板里打开（D1，`?peek=`，能后退、能分享，中键照样开新标签页）。
  - 速览面板显示哪些内容，见决定点 10。
- **产物页**（ux-b F4、F12）：
  - 分“待答、已答（只读回看答案、时间、版本）、已取代”三段，已答按接口已有的 `answers` 列出；
  - 新加的题标“新”；提交栏固定在底部，写明“已改几题、还有几道必答”；
  - 成功提示写答了什么，不只给提交号。
- **会话页**（ux-b F3、F13）：
  - 桌面改成左列表、右详情两栏，选中项高亮；终端定高，输入框、按键行、投递结果紧贴终端；
  - 写明发送快捷键；
  - 接管时给一个固定的退出组合键（见决定点 11），写在提示条上；
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
| D2 观看任意 pane，并能往回翻 | `/api/sessions` 把本仓库里没有 Agent 会话的 pane 也列出来（现在只作为“无主的运行”的 pane 号出现），会话页给“只读观看”入口；`/ws/terminal` 放开对 Agent 会话的要求，只允许观看，接管与发消息仍只对 Agent 会话；“往回翻”沿用现在给 omp 的“更早的输出”，读 1000 行做成文字面板：非 Agent 的 pane 读 `pane.read`（要加进 herdr 方法白名单，只读），Claude 仍不给（备用屏，读多于可见行会滚动它的界面） | 先实测 `terminal session observe` 对非 Agent 的 pane 能不能用，以及 0.9.1 与 0.9.3 上 `pane.read` 的参数与副作用；白名单变化要同步 `docs/herdr.md` 与 `tests/delivery.test.ts` 钉住的清单；审计照记观看 |
| checkout 的未跟踪计数与文件清单 | `status --porcelain` 由 `-uno` 改为分开计数：已跟踪改动、未跟踪（`-unormal`，未跟踪的目录算一条）；新接口 `GET /api/checkouts/:key/files`，列出暂存、工作区、未跟踪三段，条数上限；10 秒缓存照旧 | 未跟踪扫描在大 worktree 上可能慢：先对真实的 15 个 checkout 量耗时（t14 冷算 104 到 210 毫秒是 `-uno` 的数）；超过阈值的给“未算”而不是挡住整页 |
| 文档与 master 的差异视图 | 新接口 `GET /api/docs/diff?checkout=&path=`：在那个 checkout 里对 `master` 求这一个文件的差异（含工作区未提交的改动），返回统一差异文本，前端用现有的 `DiffView`；新增与删除的文件给整份 | 基线是 `master` 这个引用还是主工作区，见决定点 12；路径走现有的路径守卫 |
| 产物页显示已答的内容 | 核实后**不需要改服务端**：`answers` 已在接口里（见“计划前的核实”） | 无 |
| 首页按产物合并提问 | 核实后**不需要改服务端**：前端按 `artifactId` 分组 | 若要“按 Work 显示待我答的个数”，`overview.works` 里已有计数，也不需要 |

## 要先实测才能定的问题

1. **xterm 的自绘滚动条**：D2 给终端加回滚之后，`ITheme.scrollbarSlider*` 的配色在明暗两套终端配色下是否可见、是否干扰选择。藏掉空 `.xterm-viewport` 的原生轨道之后，列数是否与现在一致。轨道本身已在计划前实测过。
2. **`Splitter` 放进外壳**：
   - 它铺满父级并裁切溢出，能不能直接当外壳 grid 的一格，还是要整体替换 grid；
   - 窄屏时保留同一个 `Splitter`（左栏宽 0、sash 0、禁用），导航改由抽屉显示，`RouterView` 是否始终是同一个实例。验法：在编辑页打几个字、在会话页接上终端，把窗口在 1280 与 390 之间来回改，草稿与终端连接都还在；
   - 它的 `collapse` 配置能否表达 D4 的“拖到最小以下就收起”。
3. **编辑页的站内确认框**：`onBeforeRouteLeave` 返回 Promise 时，面板自己的确认框能否接管（nb-ui `Dialog` 的焦点与 Esc）；浏览器后退（popstate）场景下 vue-router 4 取消导航后地址栏是否复原。
4. **Task 页正文右边的空白**：已按代码与截图核实，是卡片宽度与 72ch 阅读宽度不一致（见“计划前的核实”）。3b 做完后在 1280、1440、1920 三个宽度截图确认。
5. **未跟踪文件扫描的耗时**：见服务端改动。
6. **D2 的 observe 与 `pane.read`**：见服务端改动。

## 决定点

凡是方案没写死、会改变产品行为的，列推荐与备选，由主 Agent 定或转开发者。

1. **登录失效时界面怎么呈现**（1.5）。现在 `v-if` 换掉整个界面，页面卸载，编辑草稿与填了一半的答复都会丢；写请求也触发之后会更常走到。
   - 推荐：页面保持挂载，盖一层阻挡交互的提示，写“登录已失效：在终端运行 nbdev panel open，用新链接登录（同一个浏览器里其它标签页也行），再点‘我已重新登录’”。点了就重探 `/api/meta`，通过就撤掉阻挡层、重连推送；草稿还在，可以再保存。
   - 备选：维持现在整页替换，合同不变，接受丢草稿。
2. **会话输入框的草稿随目标切换**（1.2）。
   - 推荐：换会话就清空（按身份 key 重建）。给 A 写的话不该留给 B。
   - 备选：按会话分别记住草稿（页面持有一个按会话键的草稿表），切回来还在。
3. **终端零件是否另加防御性的 `watch(source)`**（1.2）。
   - 推荐不加：合同写明“source 不变、换终端用 key 重建”，验收覆盖。
   - 备选：加一个只报错的 `watch`，违反合同时 `console.error` 一次，便于以后改页面的人发现。
4. **保存在途时编辑器只读**（1.4）。
   - 推荐只读：锁等待最长 30 秒，期间不能打字。
   - 备选：允许继续打字，回包只更新基线；草稿仍等于提交的文本时才换成服务端文本。行为更顺，但状态更复杂，测试面也更大。
5. **同一地址在不同组件之间共用请求**（1.6）。
   - 推荐本阶段不做：只做每个资源自己的单飞。外壳与首页重复取 `/api/overview`、外壳与会话页重复取 `meta`、`notify`，开销小。
   - 备选：只对 `meta`、`overview`、`notify` 三个地址共用在途请求与结果。
6. **重取遇到 404 时**（1.7）。
   - 推荐：保留旧数据，提示“已经找不到了”，给“回到上一级”、不给重试。
   - 备选：清掉旧数据，整页换成“找不到”。
7. **窄屏抽屉的断点**（阶段 2）。现在 `md`（768）就出左栏；ux-c 建议改到 `lg`（1024），因为 768 到 1024 之间左栏 300px 会把内容压到 470 到 720px，Task 表放不下。
   - 推荐改到 `lg`。
   - 备选：保持 `md`，768 到 1024 之间默认把左栏收起。
8. **左栏收起后的样子**（D4 的“收起”）。
   - 推荐完全收起，顶栏左侧给一个展开按钮。
   - 备选：收成 48px 的图标栏（ux-a 的建议），等于第三种导航形态，维护成本高。
9. **Work 页就地展开 Task 的数据**（阶段 4）。
   - 推荐：展开时按需取这个 Task 的接口（Task 页已用的那个），不加大 Work 接口。
   - 备选：Work 接口直接带上每个 Task 的下一步、产物、证据的摘要，一次取齐，但 Work 页每次推送都要多传。
10. **速览面板显示什么**（D1）。
    - 推荐：文档与证据显示渲染后的内容；产物显示标题、状态、待答题数与“打开完整页”，不在面板里放 iframe 与答复表单（答复仍在产物页）。
    - 备选：产物也在面板里显示 iframe 与表单。窄宽下难用，表单状态与产物页重复。
11. **接管时退出键盘的组合键**（阶段 4，ux-b F13）。浏览器会拦下 Ctrl+W、Ctrl+T、Ctrl+N。
    - 推荐 `Ctrl+]`：telnet 的习惯，终端程序很少用。
    - 备选：`Ctrl+Shift+Esc` 会被操作系统占用，不推荐；双击 Esc 会与 Claude 的 Esc 冲突。
12. **文档差异的基线**（阶段 4 服务端）。
    - 推荐：`master` 这个引用，与文档树标“改动”的口径一致（要核对文档树现在的口径）。
    - 备选：主工作区的当前文件，包括它没提交的改动。
13. **是否引入组件挂载测试**（全阶段）。
    - 推荐不引入：根目录有 `happy-dom` 与 `@vue/test-utils`，但不在本包依赖里；要在 bun 里编译 `.vue` 还得加 loader。本计划用“组合函数加浏览器验收”。
    - 备选：本包加这两个开发依赖与一个 bun 的 `.vue` loader，给 `PanelNav`、`TerminalView` 这类零件写挂载测试。

## 风险

- **阶段 1 改的是正在用的面板的核心路径**（发按键、接管、写入）：每条都有 L3 加浏览器验收，合入前在 4490 上完整走一遍；合入后重启常驻服务要先问开发者。
- **浏览器验收依赖 herdr 写调用**：两格 Agent 会话、改会话 id，要主 Agent 同意；不同意时自建命名会话，或者把“同一格换会话”只留给 L3，记录里写明。
- **模块级单例**：`panel-data.ts` 的单例让测试互相影响，涉及推送的用例都放在一个文件里，每个用例停掉自己的 scope。
- **阶段 2、3 改动面大**：每片单独截图对比明暗、390 与 1440；不把信息排序的调整混进外壳改动。
- **主应用与 nb-ui**：本 Task 不改 nb-ui 与主应用（D3）。滚动条收进 nb-ui 已记在后续清单。

## 实施进度（编码子代理随做随记）

- 2026-10-13：计划写完，交主 Agent 与设计审查。
  - 计划前只读核对了源码。
  - 在 4490 的审查面板上只读实测了一次 xterm 的滚动条结构：登录后打开 `?pane=w4:p1`，没有发消息、没有按键；用一个浏览器，用完已关。
  - 没有改代码，没有提交。
