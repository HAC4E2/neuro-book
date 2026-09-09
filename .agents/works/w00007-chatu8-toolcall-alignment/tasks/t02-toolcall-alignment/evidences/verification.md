# 验证证据

## 实现分支

- Worktree：`.worktree/w00007-chatu8-toolcall-alignment`
- 分支：`feat/w00007-toolcall-alignment`
- 基线：`4e0347fe1a61952a3062196a79e0cba49cde88cf`
- 实现提交：`0ac96723`（`feat/w00007-toolcall-alignment`，隔离 worktree 已提交且工作树干净）
- 固定上游：`damoshen123/st-chatu8@3138b2c7f24b01c65b72389e2ff7502bd4ee9030`
- 隔离 worktree 实现已提交；旧 `upstream/master` merge 结案为 `0e71893e`。随后同步 HAC4E2 `origin/master=106f5e7b`，解决 `AGENTS.md` 与 `bun.lock` 冲突并提交为 `4faa1205`，已推送到 `origin/new-text-to-picture`。

## 命令与结果

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `bun run --cwd packages/neuro-book generate` | 0 | 仅生成本地 Prisma client，未执行迁移；生成目录保持忽略状态。 |
| 包级原始聚焦 Vitest（现有 global setup） | 1 | 既有 system assets freshness 失败：`Profile manifest 没有 loaded entry`，未进入测试。 |
| 临时关闭该既有 global setup、沿用包 alias/plugin 的聚焦 Vitest | 0 | 初始实现 11 files / 123 tests；同步 HAC4E2 master 后 12 files / 125 tests 全通过，覆盖共用 LLM、五类业务调用、Tool/Tail、DTO/normalizer、独立导入导出和设置 UI 合同。临时配置测试后删除。 |
| `bun install --frozen-lockfile --linker hoisted`（合并后） | 0 | 合并后的 workspace lockfile 可冻结安装；仅执行正常安装生成了必要 lockfile 差异。 |
| `bun run --cwd packages/neuro-book typecheck` | 0 | Prisma client 生成后主应用类型检查通过，无新增类型错误。 |
| `bun run docs:check` | 0 | implemented Spec 登记、实现/测试链接和文档结构均通过。 |
| `bun run governance:check` | 0 | 当前实现 worktree 治理检查无 failure/warning。 |
| `git diff --check` | 0 | 无空白错误；仅有 Git 的换行转换提示。 |

## 默认值和样本证据

- Tool 描述运行时 SHA-256：`e567e4e9f6f7855f3a75c6043ece121217a74d6b8f0948877d58739d127d409d`。
- Tail 第 1 条：296 code units，`e23d97741af47fe58c7ee404e2811869386cd5141314a53e148f7c01cc90765d`。
- Tail 第 2 条：494 code units，`1a263f3f1b1396da22f6d51d8ce6724fde7aac0bb1a4f43b2006356d911547c0`。
- Tail 第 3 条：10485 code units，`facb710db55080170a91e00060bc65d5267e97fbfc64a7fb3e0fd279d0ee5902`。
- 角色设计样本 SHA-256：`7695152b3b7e2f87897b040b32d0167c28fffb7208cf4cd9202a2a35237d323`，32 条。
- 正文样本 SHA-256：`b12894fc3a622282650bfed12dbc588f8f10db26757e079c9937d785bc31b1de`，50 条。

## 行为覆盖

- 缺省全局配置补齐并开启默认；显式 `false`、空 Tail 数组、Provider 完整覆盖和切回继承均保留。
- Tool 关闭时不发送 `tools`、`tool_choice` 或 Tail（包含实际 HTTP body 回归）；Tool 开启时固定单 function 和本次 `tool_choice`。
- dynamic 工具名在重试循环外生成，重试复用同名；Tail 三种占位符只替换为本次工具名。
- JSON 与 SSE 共用工具解码器，覆盖任意 chunk、CRLF、无末尾换行、多个 index、坏 JSON、未知工具、缺字段、`length` 截断和普通文本回退。
- `AbortError` 及其 provider-fetch 出站包装不触发重试；429/5xx 等待期间取消会中断重试定时器。
- 设置 UI 支持全局/Provider 继承与完整覆盖、字段/消息编辑排序、恢复默认、独立格式导入导出及全局配置往返；旧配置缺少新字段时补默认。
- 五类请求 `image_gen`、`char_design`、`char_display`、`char_modify`、`tag_modify` 与测试/预览入口均接收同一有效 Tool/Tail 配置。

## 未运行项

真实 Provider/Model 调用、浏览器人工验收、数据库迁移、`index.js` 执行、PR、发布和部署均未运行；HAC4E2 master 合并和 push 已完成，当前 `origin/new-text-to-picture` 与本地 `HEAD=4faa1205` 一致。