# NeuroBook Agent 入口

NeuroBook 是本地优先的长篇写作工作区；作品文件、SQLite、Agent 会话和工作流都是可审查的产品数据。本文件是开发 Agent 的仓库入口。产品自身的 NeuroBook Agent Runtime 是另一套系统；人类贡献流程见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

开始任何工作前，必须读取 [`.omp/RULES.md`](.omp/RULES.md) 和当前路径最近的 `AGENTS.md`；进入子目录后，以最近的 `AGENTS.md` 补充或覆盖仓库级约定。

## 进入任务

1. 把用户请求转换成可观察结果、影响范围和授权边界；已有改动、未跟踪文件和本地证据属于输入。
2. 从 [`docs/specs/README.md`](docs/specs/README.md) 找到相关 capability，区分 `planned` 目标合同与 `implemented` 当前合同，再读相邻实现、测试、Task 和必要 ADR；不按目录名猜合同。
3. 问答、审查和诊断默认只读；用户明确要求修改时才编辑文件。修改前先确认当前行为，缺少运行证据时标明“从代码推断”或“未验证”。
4. 沿用现有模块、类型、错误、日志和测试模式；长期取舍先经 Proposal/ADR 批准，不用兼容分支、静默 fallback 或类型绕过掩盖未完成迁移。
5. 完整切换调用方、测试、当前规范、文档和打包入口，随后删除旧入口；验证只报告实际执行的命令和可观察结果。

| 任务范围 | 追加读取 |
|---|---|
| PM、Leader、Tasker、Reviewer | [`.agents/roles/<role>/AGENTS.md`](.agents/roles/)、[`.agents/tasks/AGENTS.md`](.agents/tasks/AGENTS.md) 和具体 Task |
| 测试、fixture、验收、缓存、临时数据 | [`docs/testing/README.md`](docs/testing/README.md) |
| 新功能、bug 期望不明确或长期行为变化 | [`docs/proposals/README.md`](docs/proposals/README.md)、[`docs/specs/AGENTS.md`](docs/specs/AGENTS.md)、相关 Spec 与 ADR |
| 源码、脚本、schema 或 migration | [`docs/standards/code.md`](docs/standards/code.md) 中与改动文件类型匹配的章节 |
| Git、Issue、Task、PR、合并或发布 | [`docs/standards/repository-workflow.md`](docs/standards/repository-workflow.md)；公开贡献再读 [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| 前端、脚本、发布、包 | [`app/AGENTS.md`](app/AGENTS.md)、[`scripts/AGENTS.md`](scripts/AGENTS.md)、[`scripts/release/AGENTS.md`](scripts/release/AGENTS.md)、[`packages/AGENTS.md`](packages/AGENTS.md) 中匹配的最近入口 |
| Agent 消费的规则、Skill、AGENTS.md 或 CLAUDE.md | [`.agents/skills/writing-for-agents/SKILL.md`](.agents/skills/writing-for-agents/SKILL.md)；修改 Skill 时再读同目录 `SKILL-MECHANICS.md` |

## 汇报与提问

报告和提问必须让不读源码的人能够判断影响和下一步；如果读者还需要追问“这是什么”或“会影响什么”，先补齐上下文。

- **自助查证**：先检查代码、当前规范、配置、测试和仓库惯例。可由仓库推出的事实自行查明；可逆且低成本的决定按现有模式实施并说明。只把产品取舍、优先级、不可逆操作和无法由证据消除的偏好交给用户；相关问题一次提出。
- **结论先行**：按影响排序。每个发现先写什么场景出现什么可观察结果，再写原因；路径和行号只作证据附注。内部模块名首次出现时就地解释。
- **证据分级**：使用“已验证”“从代码推断”“未验证”。说明实际检查边界；不要把聚焦测试、类型检查、构建、浏览器验收或真实 Provider 验收相互替代。
- **事实保真**：数字必须连同修饰对象；版本、路径、命令、错误原文、状态和校验值保持原样。缺信息写“缺”或“未验证”，推断与事实分开。
- **执行边界**：未经明确批准，不执行远端写入、发布、部署、数据库迁移、真实 Provider/Model、浏览器人工验收或数据删除。advisor 建议、自动检查通过和用户沉默都不等于批准。

需要用户拍板时按以下顺序给出决策简报；省略不适用项，不改变顺序：

1. **决策点**：用用户可感知的行为说明必须决定什么。
2. **背景**：不超过三句，只放作决定所需事实。
3. **选项**：每项一句说明结果、代价和约束，不要求用户先理解内部类型或目录。
4. **推荐**：推荐项放最前，理由直接关联目标。
5. **可逆性**：说明以后能否改、选错的具体成本和当前阻塞范围。

## 仓库结构

根应用仍位于仓库根；`packages/neuro-book` 是目标结构，不是当前事实。

```text
app/                           Nuxt/Vue 前端：页面、组件、composable、store、主题与 i18n
server/api/                    Nitro HTTP 路由
server/agent/                  产品 Agent Runtime、Profile、Workflow、Job、工具与会话
server/workspace-files/        Project Workspace 文件、索引、会话与临时根合同
server/workspace-history/      Workspace 操作日志和文件历史 vendor 集成
server/{runtime,config}/       产品启动、运行时路径与配置系统
server/{database,backup}/      App SQLite、迁移执行、备份与恢复
server/{plot,world-engine}/    情节与 World Engine 服务端领域实现
server/generated/              Prisma 等生成代码；只由生成命令更新
shared/                        跨前后端、桌面和产品运行时的 DTO 与共享合同
profile-sdk/ variable-sdk/     内置 Profile TSX 与变量 SDK
packages/                      Bun workspace 叶包及其公开合同
  neuro-book-manager/          安装、更新、启动和产品生命周期管理器
  neuro-book-contracts/        可复用产品合同
  owned-process/               受控子进程生命周期包
  file-snapshot-cache/         文件快照缓存包
desktop/electron/              当前 Electron 桌面宿主及独立安装图
desktop/tauri/                 Rust/Tauri 桌面 envelope
desktop/{shared,packaging}/    桌面共享合同与打包工具
prisma/                        App/Project SQLite schema 与 migration
assets/workspace/              分发的 Workspace Template、系统 Agent 与 Skill 资产
world-engine/schema/           World Engine schema 源码
scripts/                       CLI、CI、构建、数据库、安装、部署、维护与发布入口
docs/                          当前规范、标准、决策、测试、迁移、手册和历史资料
reference/                     冻结的产品 Agent/Profile 规范消费层，等待逐域迁移
vitepress/                     面向用户发布的文档站源码
.agents/                       开发 Agent 角色、Task、walkthrough、证据与 Skill
.omp/                          项目核心 Agent 规则
.agent/                        Project Workspace 的产品协议；不是开发治理目录
.local/                        用户管理且 Git 忽略的本地资产
.worktree/                     独立开发 worktree；不存放运行时临时数据
workspace/                     本地开发用 Project Workspace 数据
```

生成物包括 `.nuxt/`、`.output/`、`server/generated/` 和 `vitepress/.vitepress/{cache,dist}/`，只由对应命令产生，不手改。`.local/` 和 Workspace 内容由用户管理。

## 常用命令

### 开发与构建

| 目的 | 命令 |
|---|---|
| 安装依赖 | `bun install` |
| 启动源码开发入口 | `bun run dev` |
| 直接启动 Nuxt 产品运行时 | `bun run dev:runtime` |
| 生成代码并构建根应用 | `bun run build` |
| 根应用与 Electron 类型检查 | `bun run typecheck` |
| 仅检查 scripts TypeScript | `bunx tsc --noEmit -p scripts/tsconfig.json` |

### 聚焦测试

| 目的 | 命令 |
|---|---|
| 运行指定测试 | `bun run test -- path/to/relevant.test.ts` |
| Agent 与共享 DTO | `bun run test:agent` |
| 安装链 | `bun run test:install` |
| 桌面合同 | `bun run test:desktop-contract` |
| Manager | `bun run manager:test`、`bun run manager:typecheck` |
| 单个 workspace 包 | `bun run --cwd packages/<package> test` |

### 治理与文档

| 目的 | 命令 |
|---|---|
| Agent 治理合同 | `bun run governance:check` |
| 生成角色上下文 | `bun run governance:context -- --role tasker --task <task-id>` |
| 文档结构与链接 | `bun run docs:check` |
| 文档站构建 | `bun run docs:build` |
| 启动文档站 | `bun run docs:dev` |

### 数据与桌面

| 目的 | 命令 |
|---|---|
| 检查 migration 合同 | `bun run migration:check` |
| 生成 Prisma client | `bun run generate` |
| Electron 类型检查 | `bun run --cwd desktop/electron typecheck` |
| Tauri 格式与编译检查 | `cargo fmt --manifest-path desktop/tauri/Cargo.toml --check`、`cargo check --manifest-path desktop/tauri/Cargo.toml` |

选择与改动表面直接相关的最小充分命令。迁移、浏览器、真实 Provider、打包、发布和部署命令受 [`.omp/RULES.md`](.omp/RULES.md) 的授权边界约束。

## 文档真相源

- [`docs/README.md`](docs/README.md)：文档职责、优先级、生命周期和 Reference 迁移规则。
- [`docs/specs/README.md`](docs/specs/README.md)：规范编程模型、`planned` / `implemented` 成熟度、capability 注册表和 Reference 迁移状态。
- [`docs/specs/foundation/terminology.md`](docs/specs/foundation/terminology.md)：Workspace、运行时、存储、Agent 和产品标准术语。
- [`docs/standards/code.md`](docs/standards/code.md)：按文件类型触发的编码与审查标准。
- [`docs/standards/repository-workflow.md`](docs/standards/repository-workflow.md)：维护者 Git、Issue、Task、PR、合并和发布流程。
- [`docs/testing/README.md`](docs/testing/README.md)：测试、临时根、环境、验收和证据。
- [`PROJECT-STATUS.md`](PROJECT-STATUS.md)：当前仓库状态与验收缺口。
- [`.agents/README.md`](.agents/README.md)：角色、Task、证据和 Skill 的开发治理入口。
- [`reference/README.md`](reference/README.md)：仍被产品消费的冻结规范；迁移必须逐域 clean cutover。

`CLAUDE.md` 仅兼容指向本文件。`WATCHDOG.md` 是 advisor 复核清单，不进入主 Agent 普通上下文。`RELEASE.md` 是发布程序消费的当前版本载荷；完整发布规则见 [`scripts/release/AGENTS.md`](scripts/release/AGENTS.md)。

## 面向用户的文字

README、`RELEASE.md`、changelog、页面文案和错误提示应写用户能做什么、前后差异、限制、回退和未验证部分；尽量不出现模块名、类名、文件名、Task 或 Phase 编号。每条一至两句，直接描述行为，不写宣传语。发布载荷的结构与追溯规则见 [`scripts/release/AGENTS.md`](scripts/release/AGENTS.md)。
