# Monorepo Module 边界与迁移规范

## 目的

NeuroBook 以一个 monorepo 维护应用、共享合同、Product Runtime、Desktop 和可独立发布的包。`Module` 是逻辑所有权和依赖边界，不等于当前目录，也不要求每个 Module 立即成为 npm 包。

主应用当前已位于 `packages/neuro-book`；根只保留 workspace 编排、治理、产品、桌面和发布宿主入口。六个自治项目已收编到对应 `packages/*`，各自保留项目 docs、Task、状态和专属 `AGENTS.md`，默认继承根治理规则。

## 当前布局与目标布局

| 边界 | 当前真相源 | 当前入口或消费方 | 当前状态 |
| --- | --- | --- | --- |
| 根应用 | `packages/neuro-book/package.json`、`packages/neuro-book/app/`、`packages/neuro-book/server/`、`packages/neuro-book/shared/`、`packages/neuro-book/nuxt.config.ts` | `bun --cwd packages/neuro-book ...`、Nuxt、根脚本和 Vitest | 已迁入 `packages/neuro-book`；根不再承载应用源码 |
| Source Dev | `scripts/cli/source-dev.ts` 与 `scripts/cli/` | 根 `package.json` 的 Source Dev 入口 | 继续作为宿主适配层，指向应用包公开入口 |
| Agent Runtime | `packages/neuro-book/server/agent/`、相关 DTO 和稳定 `reference/agent/` | Agent API、Harness、Profile runtime | 保持应用逻辑 Module；跨包能力从公开 workspace 入口消费 |
| Project / Workspace | `packages/neuro-book/server/workspace-files/`、Project SQLite、Workspace 文件协议 | Project API、文件工具、Workspace CLI | 由 Project Workspace Module 持有数据和授权；不由 UI 或脚本直接拼路径 |
| World Engine | `packages/neuro-book/world-engine/` 与 `reference/world-engine/` | Plot、Agent tools、写作流程 | 保持独立领域 Module；Product runtime 通过显式 runtime island 消费 |
| Product Runtime / Release | `packages/neuro-book/server/runtime/`、根 `scripts/build/`、`scripts/deploy/`、`scripts/release/` | Product、Portable、Container、Release | 共享验证和发布入口保持单一 owner；脚本只做宿主适配 |
| Workspace 自治包 | `packages/nb-history/`、`nb-workflow/`、`nb-memory/`、`nb-ui/`、`neuro-agent-harness/`、`llmlint/` | 各包公开 exports、包内测试和应用消费者 | 各包独立 owner；包级治理资产覆盖专属行为，不复制根治理正文 |
| Manager | `packages/neuro-book-manager/` | `@notnotype/neuro-book-manager`、`neuro-book` bin | 独立包；不得反向依赖 Nuxt 页面或主应用特例 |
| Desktop Envelope | `desktop/`、共享 Desktop Contract、Manager adapter | Electron/Tauri、Desktop Contract | 保持独立安装图；跨语言重复只有在合同漂移证据出现后才抽取 |

所有 `packages/*` 默认继承根 Rule/Skill/Role、临时根、安全和 Git 规则。包可以建立自己的 `AGENTS.md`、`docs/`、`.agents/tasks/` 和 `PROJECT-STATUS.md`，但 `AGENTS.md` 必须引用 `../../AGENTS.md`；`.agent/.local` 必须被忽略且不得跟踪，`.worktree` 只允许迁移期间短暂存在并在 checkpoint 前清理。linked worktree 统一位于主 checkout 的 `/.worktree/` 下，主 checkout 是唯一目录外例外。

根 `tsconfig.json` 和应用包配置中的 `nbook/*` alias 指向 `packages/neuro-book`；它是应用源码的绝对导入约定，不等于可供其他包深导入的内部路径。跨包依赖必须通过 workspace package 名和声明版本进入公开入口。

## Module 必须声明的合同

每个新 Module 或迁移中的 Module 在 Task/设计记录中至少声明：

1. **Owner**：谁拥有实现、持久化真相源、删除语义和失败恢复。
2. **Interface**：调用方能使用的类型、命令或 DTO；不把内部实现类型当作公开合同。
3. **依赖方向**：允许的运行时依赖、type-only 依赖、禁止的反向依赖和宿主 adapter。
4. **数据边界**：文件、SQLite、JSON、缓存、编译 artifact 和运行临时目录分别由谁创建、验证、清理。
5. **入口**：Source、Product、Manager、Desktop 和测试分别从哪里进入；不保留同义 fallback。
6. **验证**：Module focused tests、typecheck，以及需要真实 Product/安装/浏览器/Provider 证据的集成门禁。
7. **迁移撤销点**：中间产物、旧入口、journal、marker 和失败时的保留/恢复规则。

没有 Owner、Interface 和验证命令的目录拆分只是文件搬家，不得作为 Module 迁移开始条件。

## 允许的依赖方向

```text
领域 Module / 稳定合同
        ↑
应用编排与 HTTP/UI adapter
        ↑
Source / Product / Desktop / Release 宿主 adapter
```

- UI、HTTP route 和 CLI 负责解析输入、授权、错误映射和编排；领域 Module 负责业务规则和数据所有权。
- `scripts/` 保持宿主适配职责；迁移时把领域逻辑移入对应 Module，不为单次调用增加 wrapper。
- `packages/neuro-book/server/runtime/commands/` 只适配 Product Runtime Contract；Workspace CLI 的实现归 Workspace Module。
- Manager 通过稳定的 Product/Release/Installation 合同消费应用产物，不导入 Nuxt 页面或根应用特例。
- Desktop Envelope 只拥有宿主窗口、Supervisor、安装和退出协议；不复制 Product Runtime 合同。
- 共享 DTO 或 verifier 只有在实际存在跨宿主复用且不会形成反向环时才下沉。当前依赖环和 type-only 环按 [ADR 0015](../adr/0015-architecture-boundaries-and-deferred-structure.md) 保持记录，不为“看起来干净”提前抽包。

## 物理迁移步骤

1. **冻结基线**：读取根规则、相关 Task、Reference、包规则和入口；记录当前工作树、停工 worktree、生成物和未跟踪文件。不得 stash、prune、reset 或覆盖已有改动。
2. **绘制调用图**：用语言服务、测试配置、`package.json`、workflow 和脚本入口确认所有消费者。字符串搜索只能补充，不能替代符号引用和动态入口审计。
3. **先定 Interface**：为目标 Module 写输入/输出、错误、生命周期、数据所有权和依赖方向；公开合同变化先更新 ADR/Reference，再迁移实现。
4. **建立目标包骨架**：补齐 `package.json`、exports、bin、tsconfig、测试配置和生成物边界。目标包不得通过相对路径偷读应用根或根 `node_modules`。
5. **单次迁移一个 Module**：先迁实现和测试，再迁所有调用方、配置、workflow、文档和生成器。导入采用明确的目标入口；不保留旧路径 alias、deprecated re-export 或静默 fallback。
6. **隔离运行数据**：测试、验收、cache 和 scratch 使用 `NBOOK_AGENT_TEMP_ROOT` 及受控子目录；任何 fixture 不得写入仓库 `.agent/tmp/`、`.worktree/`、包级 `.worktree/` 或目标包源码树。
7. **完成验证后删除旧边界**：确认旧路径引用为零、目标包独立 typecheck/bundle/test 通过、应用级集成门禁通过，再删除旧实现和旧入口。删除前保留 provenance、manifest、migration journal 或 Task 证据。
8. **记录实际偏差**：Task walkthrough 写明未迁移的宿主、未运行的浏览器/真实 Provider/发布门禁和剩余风险；不要把 focused test 写成全仓或产品验收。

## 本轮不做的事情

- 不把主应用再次物理移动；当前应用 owner 已是 `packages/neuro-book`。
- 不把根 `package.json` 改成不含产品、治理、桌面和发布编排的空壳。
- 不批量重写已由应用包 alias 承接的 `nbook/*` 导入。
- 不新建 runtime contract 平行包、跨存储事务框架或跨语言生成层。
- 不把 `.agent/plan`、产品模板、用户内容或产品 Skill 路径改名为 `.agents/`。
- 不以发布、浏览器、真实 Provider 或数据迁移结果替代 Module focused verification。

## 目标应用包的完成条件

主应用物理迁移已完成；后续结构变更仍必须满足以下持续条件：

- 根 workspace orchestrator、`packages/neuro-book` 和所有现存包的依赖图无反向环；领域包不得依赖主应用。
- Source Dev、Nuxt、Vitest、Product build、Manager 和 Desktop Contract 都从明确入口工作。
- `nbook/*` 由应用包内 alias 或公开 exports 承接，且不存在 root-only fallback。
- 生成的 Nuxt、Prisma、OpenAPI、Profile/Variable artifact 和 Product staging 不回写错误的根目录。
- focused Module tests、应用集成测试、typecheck 和必要的平台门禁均有真实命令和证据。
- Task、ADR、Reference、CI workflow、包发布合同和回滚说明同步完成。

相关长期边界见根 [AGENTS.md](../../AGENTS.md)、[packages/AGENTS.md](../../packages/AGENTS.md)、[ADR 0015](../adr/0015-architecture-boundaries-and-deferred-structure.md) 和 [ADR 0009](../adr/0009-product-runtime-image-generation.md)。当前规范注册表继续以本文件为 Monorepo / Module 唯一正文，不创建 `docs/specs/architecture/monorepo-boundaries.md` 副本。
