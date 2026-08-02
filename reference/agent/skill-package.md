# Agent Skill Package Contract

本文定义 NeuroBook Agent Skill 的可移植 package、版本、安装和同步合同。任务过程记录见 [Task 120](../../docs/tasks/120-agent-skill-package-contract/README.md)。

通过 Workshop 发布的 Skill 还必须遵守 [Agent Asset Package Protocol](agent-asset-package.md)：所有可发布 Skill 都要有根 `package.json` 和 `neurobook` 字段。本文件继续负责本地 catalog、runnable Skill 安装和依赖失效细节。

## Package Identity

- Skill 目录名是 catalog 稳定 `key`；用户和 Agent 必须原样使用，不翻译或重命名。
- 固定入口是根目录 `SKILL.md`。新建可移植 Skill 的 key 使用小写字母、数字和连字符。
- `SkillCatalog.rootPath` 是当前生效 Skill 的绝对根目录，`skillPath` 是其入口绝对路径。
- Skill 不得假定安装在 `.nbook`、`.claude`、`.codex` 或其它宿主专用目录。命令从 catalog 路径推导根目录。

## SKILL.md

`SKILL.md` frontmatter 只承载触发发现所需元数据：

```yaml
---
name: example-skill
description: Describe what the skill does and the concrete tasks that should trigger it.
---
```

- `name` 和 `description` 必填；触发条件写进 `description`。
- 版本、作者、安装状态和运行时配置不写入 frontmatter。
- 正文只保留 Agent 执行任务所需的流程和资源导航；详细材料放在同级 `references/`。
- Skill 引用的相对资源必须位于自身目录内，并从 `rootPath` 解析。

## Runnable Skill

本地只含提示词和参考资料的 loose Skill 不要求 package manifest；但它不能直接发布到 Workshop。包含 CLI、脚本依赖、独立发布生命周期或需要发布的 Skill 必须包含：

```text
<skill-key>/
├── SKILL.md
├── package.json
├── bun.lock
├── bin/ or scripts/
└── references/ and assets/ as needed
```

- `package.json.name` 与目录 key 一致。
- `package.json.version` 是唯一 Skill 版本真相源，使用 SemVer；catalog 不从 `SKILL.md` 读取版本。
- 通过 Workshop 发布时，非空 `bin`、非空 `scripts` 或任一实际 Bun 安装输入都会要求根目录携带非空 `bun.lock`；纯提示词/资料包不为形式统一而生成空锁文件。
- 需要依赖安装的 Skill 首次运行任何 CLI 前，Agent 必须先执行 `bun install --cwd "<skill-root>" --frozen-lockfile`。安装失败时停止，不绕过 frozen lockfile。
- 后续运行复用本地安装；只有 `node_modules` 缺失时重新安装。

版本调整口径：

- `patch`：提示词、规则、修复或文档行为调整，公开命令和配置兼容。
- `minor`：新增向后兼容的公开能力。
- `major`：公开命令、配置或输出合同不兼容。

## Dependency Lifecycle

`node_modules` 是当前用户机器上的本地派生物，不是 Skill package 文件：

- sibling/source → Bundled Workspace Template 的 vendored 同步排除 `node_modules`。
- Bundled Workspace Template → Workspace Root `.nbook` 的受管资产清单排除 `node_modules`。
- 普通同步、no-op、`force` no-op、版本号变化、`SKILL.md` / `references` / rules 更新不得删除 `node_modules`。
- 当新的 `bun.lock`，或 `package.json` 中影响 Bun install 的依赖、安装脚本、平台与 package-manager 字段实际发布到用户 Skill 时，只失效该 Skill 的 `node_modules`。
- 如果用户目录已经自行与新上游文件一致，同步只补齐 sync state，不猜测此前安装动作，也不清理依赖。
- 用户修改了 package 安装合同且系统更新未覆盖时，不清理用户依赖；强制同步真正覆盖该合同时才清理。

`.git`、开发评测、coverage 和已硬切官方目录属于 vendored/runtime 排除项，不与依赖失效机制混用。

## Override And Sync

- Bundled system Skill 位于 Bundled Workspace Template 的 `.nbook/agent/skills/<key>/`。
- 用户 Skill 位于 Workspace Root `.nbook/agent/skills/<key>/`。
- 用户同 key 目录整体覆盖 system Skill；catalog 不逐文件合并两层。
- 系统 Skill package 违反 manifest / SemVer 合同属于打包缺陷，catalog 直接失败；损坏的用户 Skill 只隔离该 key 并记录服务端诊断，不拖垮其它 Skill，也不回退执行同 key system Skill。
- 系统受管文件继续按 sync state 更新；用户已手改文件默认保留并产生冲突提示。
- runnable Skill 真相源位于独立仓时，先更新独立仓 package，再同步 vendored snapshot，最后同步真实 user-assets runtime。

## Review Checklist

发布或更新 runnable Skill 时检查：

1. `SKILL.md` 只含 `name` / `description` frontmatter，正文从 catalog 路径推导 `<skill-root>`。
2. `package.json.version` 已按 SemVer 更新；存在脚本、命令或 Bun 安装输入时，非空 `bun.lock` 与安装声明一致。
3. 需要依赖安装的新目录先运行 `bun install --cwd "<skill-root>" --frozen-lockfile`，再运行初始化或业务命令。
4. no-op、版本号、提示词更新保留 `node_modules`；依赖或 lockfile 更新会精确失效对应 Skill。
5. source、vendored snapshot 与 Workspace Root `.nbook` runtime 的受管文件一致，runtime 不含开发资产。
