---
schema: nbook.task/v2
taskId: t09-panel-readonly
status: done
updated: 2026-10-13
---

# 面板服务与只读视图

## 目标与范围

按 [Proposal](../../../../../docs/proposals/dev-panel.md) 第八、九节与 [实施计划的 t09 一节](../t03-design/plan.md#t09-面板服务与只读视图)：Bun 面板服务（HTTP 与 WebSocket）、两个来源、请求校验与路径守卫；Vue 3 加 Vite 的前端（先验证 nb-ui 组件能否脱离 Nuxt 使用）；首页（收件箱加每个 Work 一张卡片）、Work 与 Task 页、产物页（第二个来源的 iframe 加只读问题侧栏）、文档页、会话页（只读）、搜索；`nbdev panel serve`、`panel open`、`panel.json`。视图依据 t03 第三轮与第二轮已定的静态稿（[评审板](../t03-design/artifacts/review/index.html)）。

行为合同未变：开发工具，不改产品 Spec；工具合同写在包内文档。

## 执行位置

集成分支 `feat/w00022-dev-panel`，worktree `.worktree/w00022-dev-panel`。

## 当前状态

- 2026-10-12 开工，[plan.md](plan.md) 写成后交 opus 子代理做设计审查（[报告](evidences/design-review.txt)）：0 阻断、12 重要、8 建议，20 条全部采纳。
- 主 Agent 核实了本机另有两个可登录账户，sshd 在运行，于是撤回“t13 之前本机不登录”：t09 就做启动令牌加一次性登录链接，设备配对留给 t13。
- 其余要点：
  - 文件接口改为白名单；
  - 所有接口要求同源；
  - 搜索单飞、可取消、单独的 Git 环境；
  - Task 的“执行 checkout”；
  - 产物来源加随机前缀；
  - 面板原子类不分层；
  - 构建加锁并原子替换；
  - 场景 5、6 的测法。
- 另并入一条 t07 遗留问题：对别的仓库的操作不写 pane 标签。
- 2026-10-13 实施完成，集成分支 `cde9f5c6..fe4358d4`，已 push。各片提交、验收与测量见 [plan.md 的实施进度](plan.md#实施进度编码子代理随做随记)，与 Proposal、稿子的出入见同文件“与 Proposal、实施计划的不一致”第 8 到 14 条。
- 主 Agent 复跑：包测试 168 个、typecheck（含 `vue-tsc`）、`build:web`、根上三个测试文件 175 个、`governance:check`、`docs:check` 都通过。
- 主 Agent 在真实仓库上起面板，用 curl 核对：
  - 没登录的 `/api/*` 回 401；登录链接换到 `HttpOnly; SameSite=Strict` 的 cookie，票据第二次用回 403；
  - 跨站（`Sec-Fetch-Site: cross-site`）、带 `X-Forwarded-For`、没有 CSRF 头的 POST、`/ws` 不带或带外站 `Origin` 都回 403，伪造 `Host` 回 421；
  - `/api/docs/file` 对 `.env`、`.git/config`、`package.json`、`../../etc/passwd` 都回 404，对 `AGENTS.md` 回 200；
  - 产物来源前缀错、穿越、不在 `.agents/works/` 下都回 404；两个端口只绑 `127.0.0.1`；
  - SIGTERM 后删了 `panel.json` 与锁。
- 与文档不符的一处：未编码的 `..` 与 `%2e%2e` 在进处理函数之前就被 Bun 按 URL 规范折叠掉了，所以 `/../../etc/passwd` 回的是单页回退的 200（`index.html`），不是 `docs/panel.md` 写的 400。没有泄露文件，交实现审查定怎么写。
- 未验证：真实会话上会不会推送 `pane.agent_status_changed`（靠快照加 500 毫秒轮询也能工作）；SIGHUP 的收口；`xdg-open` 真的打开浏览器；Chrome 以外的浏览器。

- 2026-10-13 实现审查（[报告](evidences/impl-review.txt)）：0 阻断、4 重要、9 建议，主 Agent 定为全部采纳。
  - 用原始套接字试了二十来种路径写法，都绕不过段检查；`..` 被折叠只是文档写错。
  - 重要的四条：
    - `/api/docs/file` 没走 realpath 守卫，仓库里的符号链接能带出 `.env`；
    - 面板重启后，页面停在“正在重连”，不提示重新登录；
    - herdr 不可用时重试链越积越多，订阅连上就断时退避不增长；
    - 一次性登录票据经 `xdg-open` 的命令行参数传递，本机其他账户能从 `/proc` 读到并抢先兑换。
  - 建议第 7 条（写请求没过登录检查）与 t10 设计审查第 1 条是同一处。
- 2026-10-13 开发者授权后，集成分支 `16cfb817e` 本地合入 `master`（合并提交 `7e837bd80`，没有 PR、没有 push master）；合并提交上复跑包测试 173 个、typecheck、`build:web`、根上三个测试文件 175 个、`governance:check`、`docs:check` 都通过。

## 下一步

无。已合入 `master`，标为 `done`。
