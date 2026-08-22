# packages 目录规则

- Monorepo 包按逻辑 Module 管理；包说明负责人、稳定合同、依赖方向、模块验证和产品集成验证。
- 当前 workspace 包包括 `neuro-book`、`neuro-book-manager`、`owned-process`、`file-snapshot-cache`、`neuro-book-contracts`、`neuro-book-test-support` 以及六个自治收编包 `nb-history`、`nb-workflow`、`nb-memory`、`nb-ui`、`neuro-agent-harness`、`llmlint`；主应用已位于 `packages/neuro-book`。
- 所有 `packages/*` 默认继承 monorepo 根 Rule/Skill/Role、临时根、安全和 Git 规则。包可用自己的 `AGENTS.md`、`docs/`、`.agents/tasks/` 和 `PROJECT-STATUS.md` 覆盖项目专属行为，但不得复制根治理正文；只要建立任一包级治理资产，就必须由 `AGENTS.md` 引用 `../../AGENTS.md`。
- 六个自治包必须各自维护 `.agents/tasks`、`docs`、`PROJECT-STATUS.md` 和项目专属 `AGENTS.md`；跨包、根安装图、共享 CI/发布/安全/Git 的事项归根 Task，包内 Task ID 只在本包唯一。
- `packages/neuro-book/.agents/tasks/` 只承载根 ownership manifest 登记的 91 个应用 Task；稳定 Task 名未登记时仍解析到根 `.agents/tasks/`，不允许候选 root fallback。
- `packages/*/.agent/` 与 `packages/*/.local/` 是被忽略且不得跟踪的包级运行态；`.agent/tasks`（单数）不是治理入口。`packages/*/.worktree/` 只允许迁移期间短暂存在，checkpoint 前必须清理。
- 包不得反向依赖 Nuxt 页面、主应用特例或 root-only runtime；跨包依赖使用 workspace package 名与声明版本，主应用只能消费领域包，领域包不得依赖 `@notnotype/neuro-book`。
- 许可证、公开包名、版本、exports 和发布合同变化必须先记录为跨 Module 决策，再修改消费者。
- 包测试使用统一的 Vitest 临时根，不创建仓库 `.agent/tmp/`。
