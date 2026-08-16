# nb-ui 项目状态

> 收编快照：S2 `00149-monorepo-workspace-consolidation`。来源 checkout 的 HEAD 为 `6296c693e21751c984f3ac8bdefbb899d0244cf9`，来源分支为 `refactor/t146-reka-tailwind-base`。本页记录收编时可确认的快照状态，不替代项目规范或 Task。

## 当前状态

- `@notnotype/nb-ui` 已作为自治包收编到 `packages/nb-ui`。
- 包保留源 package name、版本、scripts、exports、依赖语义，并设置 `private: true`。
- 许可证边界保持 `PolyForm-Noncommercial-1.0.0`；未将仓库根许可证套用于本包。
- 组件、主题、配色、token、playground、README 和项目文档均按 S0 import manifest 迁入。
- `dist/nb-ui.css` 是项目约定的提交型构建产物，但本次 S2 导入按计划排除源快照中的该文件；迁入源码后的重建由后续集成步骤负责。

## 治理入口

- 项目规则：[`AGENTS.md`](AGENTS.md)
- 项目文档：[`docs/README.md`](docs/README.md)
- 项目 Task：[`.agents/tasks/README.md`](.agents/tasks/README.md)
- 仓库共享规则：[`../../AGENTS.md`](../../AGENTS.md)

## 验证边界

本次收编未运行 `build:css`、测试、typecheck、playground 浏览器验收、build、formatter 或项目级验证命令。原 checkout 保持只读；导入文件的来源字节与 manifest hash 在复制前后复核。后续验证应按项目 `AGENTS.md` 与根迁移计划执行。

## 来源与范围

S0 manifest 位于系统临时目录的 `nb-ui.json`，列出 131 个候选条目：130 个 manifest included 条目和 1 个明确排除条目。`.gitignore` 与根 `bun.lock` 是 manifest included 记录但按本次导入约束不复制；源 `.gitignore` 规则不在目标包形成第二套 ignore 治理。
