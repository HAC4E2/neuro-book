# packages 目录规则

- Monorepo 包按逻辑 Module 管理；包说明负责人、稳定合同、依赖方向、模块验证和产品集成验证。
- 当前保留 `neuro-book-manager`、`owned-process`、`file-snapshot-cache`；根应用最终目标是普通 `packages/neuro-book` 包，本轮不物理搬移。
- 包不得反向依赖 Nuxt 页面、根应用特例或 root-only runtime；`desktop/electron` 继续保持独立安装图，除非另有设计决策。
- 许可证、公开包名、版本、exports 和发布合同变化必须先记录为跨 Module 决策，再修改消费者。
- 包测试读取 [`../docs/testing/README.md`](../docs/testing/README.md) 并使用统一的 Vitest 临时根。
