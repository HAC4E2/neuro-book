---
schema: nbook.task/v2
taskId: t12-web-terminal
status: done
updated: 2026-10-13
---

# herdr 网页终端

## 目标与范围

按 [Proposal](../../../../../docs/proposals/dev-panel.md) 第七节与 [实施计划的 t12 一节](../t03-design/plan.md#t12-herdr-网页终端)：

- xterm.js 渲染 herdr 的终端帧，每个浏览器连接对应一个 `herdr terminal session observe` 子进程；
- 接管键盘（`control --takeover`、resize、`terminal.input`、release），离开、切后台、断线时交还控制权；
- 按键按钮；手机上以纯文本视图（`agent.read --source recent-unwrapped`）加输入框为主；
- 接管前的提示与审计。

不做鼠标事件，也不在面板里启动新会话。跨设备访问在 t13；开发者 2026-10-13 定别的设备登录后与本机权限相同。

行为合同未变：开发工具，不改产品 Spec；工具合同写在包内文档。

## 执行位置

集成分支 `feat/w00022-dev-panel`，worktree `.worktree/w00022-dev-panel`。

## 需要开发者参与

- 在真实 pane 上接管一次键盘（验收）。在那之前，不对默认 herdr 里的任何真实 pane 接管或输入。

## 当前状态

- 2026-10-13 经 `nbdev task new` 新建。编码子代理写 [plan.md](plan.md)，已交 opus 子代理做设计审查。
- 2026-10-13 开发者同意：S0 对默认 herdr 里一格空闲的真实 pane 起一次只读的 observe，只核对 0.9.1 能不能出帧；不改尺寸、不输入，屏幕内容会经过编码子代理的进程。

- 2026-10-13 设计审查（[报告](evidences/design-review.txt)）：0 阻断、2 重要、17 建议，主 Agent 定为全部采纳。
  - I1：`pane.layout` 的矩形含边框，推不出真实列数；尺寸改从 pane 的 pty 读（`pane.process_info` 找到 shell 的 `/proc/<pid>/fd/0` 再 `stty -F`），读不到就不改回。
  - I2：默认 server 跑的 0.9.1 二进制可以从它的进程复制出来，放在命名会话里当 server 验证。审查已验证 observe、control、resize、争抢与 release 都可用。所以 S0 不再对真实 pane 起 observe，开发者先前的同意不再需要用上。二进制已复制到本地 `.local/agent/works/w00022-dev-panel/tasks/t12-web-terminal/herdr-0.9.1/herdr`（不入库，默认 server 一重启就拿不到了）。
  - 建议里改动较大的：
    - 普通 shell pane 的接管推迟到 t14（S8）；
    - systemd 单元加 `KillMode=mixed`（S3）；
    - 子进程与互斥按 terminal id（S5）；
    - 接管握手加时限（S7）；
    - 切到后台时观看也停（S9）；
    - 为 t13 预留：终端连接记下登录会话（S10）。

- 2026-10-13 实施完成（集成分支 `3f474ce4..305c3f1d4`，8 个提交，已 push）：S1 终端流适配、S2 终端中枢与 `/ws/terminal`、S3 前端（xterm 观看与接管、手机文字视图、omp 的更早输出）、S4 文档、S5 L4。各片提交、浏览器验收 22 项与偏离处理意见的地方见 [plan.md](plan.md) 的“实施进度”。
- S0：
  - 真实 Claude 2.1.296 与 omp 都开着 bracketed paste，取样时没有任何模型调用；
  - 读 pty 得到的尺寸与 `stty size` 一致；
  - 复制出来的 0.9.1 当 server 时两条流可用，行为与 0.9.3 相同。
- 主 Agent 复跑：
  - 通过的有：包测试 279 个（含 L4，server 用 0.9.3 与 0.9.1 各一组）、typecheck、`build:web`、根上三个测试文件 177 个、`dev-panel-records` 在 Node 下退出码 0、`governance:check`、`docs:check`。
  - 没有残留的 observe 子进程，herdr 只剩 `default`。
- 主 Agent 看截图发现一处：xterm 画面里的中文与数字字距被拉开（“标 记 5 2 6 4 2”），手机文字视图正常，交实现审查看。
- 未验证：真实输入法（fcitx5）、在真实 Claude 上接管、浏览器吞掉的 Ctrl+W、Ctrl+T、Ctrl+N，以及 herdr TUI 那边的重排观感。这些留给开发者在场的五步。

- 2026-10-13 实现审查（[报告](evidences/impl-review.txt)）：0 阻断、2 重要、6 建议；设计审查 19 条里 15 条已落实，4 条部分落实。后端在命名会话里用真实 herdr 实测，以下都成立：子进程收口、控制权释放与尺寸改回、与 t11 的互斥、`/ws/terminal` 升级前的校验、背压。主 Agent 定为全部采纳。
  - 重要：
    - 字距被拉开：交给 xterm 的 `fontFamily` 里有 `var(--font-mono)`，canvas 不认 CSS 变量，退回 `10px sans-serif` 量格宽。连带后果是接管时算出的列数少了约四分之一。
    - 接管中窗口变窄到 768 以下时，换成文字视图，“释放”按钮没了，服务端却仍在接管。
  - 另外：常驻服务现装的单元没有 `KillMode=mixed`，停服务时尺寸不改回。合入后必须重装单元。

- 实现审查的修正（集成分支 `305c3f1d..72799b957`，8 个提交，已 push）逐条见 [plan.md](plan.md) 的“实现审查的修正”：
  - 字体串不再含 CSS 变量，接管列数从 122 变成 165；
  - 接管中窗口变窄时仍留在终端视图；
  - 接管尺寸按接管后的容器算，只 resize 一次；
  - 握手中关连接、observe 第一行就结束这两种情况的处理；
  - 审计的设备从连接上取；
  - 补测试，含面板层 L4。
- 主 Agent 复跑：包测试 288 个（含 0.9.3 与 0.9.1 两组 L4）、typecheck、`build:web`、根上三个测试文件 177 个、`dev-panel-records` 在 Node 下退出码 0、`governance:check`、`docs:check` 都通过。看截图，字距已正常。

- 2026-10-13 开发者授权后，集成分支 `72799b957` 本地合入 `master`（合并提交 `a9d2fac84`，在服务脚本的合并 `66cc4d85d` 之后，没有 PR、没有 push master）。合并后复跑：包测试 286 个（L4 在 `72799b957` 上跑过，这次跳过）、typecheck、`build:web`、根上三个测试文件 177 个、`governance:check`、`docs:check` 都通过。
- 重装常驻服务：单元多了 `KillMode=mixed` 与 `NBDEV_HERDR_BIN`。第一次重启时前端构建失败，原因是主工作区的 `node_modules` 没有 t12 新加的 `@xterm` 依赖，面板用了旧产物。在主工作区按已提交的 `bun.lock` 运行 `bun install --frozen-lockfile` 后 `service:restart`，构建与预热都正常。以后合入改了依赖的提交，要先在主工作区装依赖再重启服务。

- 2026-10-13 五步验收通过（开发者在场，pane `w1:p1D`，审计里有对应的三组记录）：
  - 接管 3 次，都接上了，只有这一格从 69×241 改成 46×187，别的 pane 没动；
  - 3 次的输入分别是 7、13、4 次，都没有回车或粘贴，会话里也没有多出提交；
  - 切到别的标签页时，3 次都以 `hidden` 释放，0.3 秒内改回 69×241；
  - 接管用的子进程都已退出。
- 已知问题（观感小问题，后续看）：第三次接管时这一格先变成 45×186，0.5 秒后才变成 46×187，接管后仍会再改一次尺寸，与“只改一次”不完全一致。
- 之前看到全部 10 格一起变成 29×81 那次，审计里没有对应的接管，判断是 herdr 窗口自己变了大小，与面板无关。

## 下一步

无。
