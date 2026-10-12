---
schema: nbook.task/v2
taskId: t09-panel-readonly
status: active
updated: 2026-10-12
---

# 面板服务与只读视图

## 目标与范围

按 [Proposal](../../../../../docs/proposals/dev-panel.md) 第八、九节与 [实施计划的 t09 一节](../t03-design/plan.md#t09-面板服务与只读视图)：Bun 面板服务（HTTP 与 WebSocket）、两个来源、请求校验与路径守卫；Vue 3 加 Vite 的前端（先验证 nb-ui 组件能否脱离 Nuxt 使用）；首页（收件箱加每个 Work 一张卡片）、Work 与 Task 页、产物页（第二个来源的 iframe 加只读问题侧栏）、文档页、会话页（只读）、搜索；`nbdev panel serve`、`panel open`、`panel.json`。视图依据 t03 第三轮与第二轮已定的静态稿（[评审板](../t03-design/artifacts/review/index.html)）。

行为合同未变：开发工具，不改产品 Spec；工具合同写在包内文档。

## 执行位置

集成分支 `feat/w00022-dev-panel`，worktree `.worktree/w00022-dev-panel`。

## 当前状态

- 2026-10-12 开工，[plan.md](plan.md) 写成后交 opus 子代理做设计审查（[报告](evidences/design-review.txt)）：0 阻断、12 重要、8 建议，20 条全部采纳。
- 主 Agent 核实了本机另有 两个可登录账户，sshd 在运行，于是撤回“t13 之前本机不登录”：t09 就做启动令牌加一次性登录链接，设备配对留给 t13。
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
- 编码子代理按处理意见改计划并实施。

## 下一步

实施完成后主 Agent 复跑验证、在浏览器里看一遍，再交 opus 子代理做实现审查（不阻塞）。
