# packages 目录规则

- Monorepo 包按逻辑 Module 管理；包说明负责人、稳定合同、依赖方向、模块验证和产品集成验证。
- 当前保留 `neuro-book-manager`、`owned-process`、`file-snapshot-cache`；自治收编包为 `nb-history`、`nb-workflow`、`nb-memory`、`nb-ui`、`neuro-agent-harness`、`llmlint`。根应用最终目标是普通 `packages/neuro-book` 包，本轮不物理搬移。
- 六个自治包必须各自维护 `.agents/tasks`、`docs`、`PROJECT-STATUS.md` 和项目专属 `AGENTS.md`；项目规则引用本文件上级的根共享 `../../AGENTS.md`，不复制根规则。
- 内部包不得建立第二套 `.agents/tasks`、`docs` 或 `PROJECT-STATUS.md`；共享 Task、docs、status 仍归根。
- 包不得反向依赖 Nuxt 页面、根应用特例或 root-only runtime；`desktop/electron` 继续保持独立安装图，除非另有设计决策。
- 许可证、公开包名、版本、exports 和发布合同变化必须先记录为跨 Module 决策，再修改消费者。
- 包测试使用统一的 Vitest 临时根，不创建仓库 `.agent/tmp/`。
