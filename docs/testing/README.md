# NeuroBook 测试规范

本文件是仓库测试、临时根、环境和验收约定的真相源。所有 Vitest 配置、测试编写、fixture 和验收脚本遵守这里；规则冲突时先更新本文件，不在 `AGENTS.md` 维护第二份正文。

## 用户视角人工评测

[`manual-eval/README.md`](manual-eval/README.md) 是测试体系中的人工验收子系统：`criteria.md` 定义判定与证据合同，`journeys/` 保存用户旅程用例，`agent-guide.md` 定义一次评测的执行步骤，`report-template.md` 约束结果格式。它不属于 `docs/runbooks/`，因为整套资产不仅包含操作步骤，还包含测试判据、用例和报告合同。

## 临时根合同

所有 Agent、Vitest、fixture、验收、缓存、browser smoke 和 scratch 数据通过 `scripts/utils/agent-paths.ts` 的 resolver 进入系统临时目录：

```text
<agent-temp-root>/
├── vitest/<runId>/                 Vitest run
├── fixtures/<taskId>/<runId>/      测试 fixture
├── runs/<taskId>/<runId>/          一次性脚本和 scratch
├── acceptance/product-runtime/     Product Runtime 验收
├── cache/<name>/                   可重建开发缓存
└── browser/                        browser smoke 临时产物
```

- `NBOOK_AGENT_TEMP_ROOT` 未设置时解析为 `resolve(os.tmpdir(), "neuro-book")`。显式值必须是系统临时目录的绝对后代，并通过 containment、合法路径段和 Windows 短路径检查；相对、越界或过长路径直接失败，不回退仓库。
- `NBOOK_AGENT_WORKTREE_ROOT` 独立控制 worktree，默认是仓库 `.worktree/`，不属于临时根。仓库 `.agent/`、`.local/`、`.worktree/`、`workspace/` 和用户公共目录都不能作为运行临时根。
- 每个可回收根写入 `.nbook-tmp.json`，包含 schema、owner、PID、runId 和 purpose。调用方在 `afterEach`、teardown 或 `finally` 清理。
- fail-closed sweep 只有在 marker 合法、owner 已退出且最后活动超过 24 小时时回收。schema 不匹配、owner 存活、symlink/reparse、普通文件、marker 不可读或安全性无法证明时保留并报告。

## 开发时加载环境变量

直接运行 OMP 时，它与启动的 Agent 继承启动终端的 `process.env`；项目不从 Markdown、仓库 `config.yaml` 或 `.env.local` 加载 `NBOOK_AGENT_TEMP_ROOT`。需要显式值时，在启动 OMP 前设置当前 shell、用户环境或 CI `env`。

当前 PowerShell 会话：

```powershell
$env:NBOOK_AGENT_TEMP_ROOT = Join-Path ([System.IO.Path]::GetTempPath()) "neuro-book"
omp
```

以后新开的终端也生效时写入 Windows 用户环境，然后重新打开终端、IDE 和 OMP：

```powershell
[Environment]::SetEnvironmentVariable(
    "NBOOK_AGENT_TEMP_ROOT",
    (Join-Path ([System.IO.Path]::GetTempPath()) "neuro-book"),
    "User"
)
```

Bash 只在 `TMPDIR` 已设置时使用 `export NBOOK_AGENT_TEMP_ROOT="$TMPDIR/neuro-book"`；未设置时由 resolver 取默认值。CI 在 job 的 `env` 中设置。

## 证据与秘密

- 正式证据只把脱敏结果放入 `.agents/tasks/<task>/evidences/`。
- 凭据、API Key、Token、Session、小说正文、完整提示词、原始 Provider 请求、未脱敏日志和 trace 不进入仓库。
- 不提交 `.env`、`.env.local`、`config.yaml`、数据库、构建缓存、浏览器产物或本机基准原始结果。
- 用户下载产物和正式发布资产不属于测试临时数据；按发布合同记录 SHA-256、revision 或 image identity，中间日志留在系统临时根。

## Vitest 运行时合同

- 所有 Vitest 配置的 `setupFiles` 第一项必须是 `server/workspace-files/vitest-tmpdir-setup.ts`，`globalSetup` 必须包含 `server/workspace-files/vitest-global-setup.ts`。
- worker 内的 `TMPDIR`、`TEMP`、`TMP` 和 `NBOOK_TEST_TMPDIR` 指向同一受控 run 根；runId 使用 8 位 hex，避免并行冲突和 Windows 路径过长。
- 新增需要“目录 + marker”的测试根使用 `createTestTmpRoot(name, purpose)`，由测试 teardown 与 fail-closed sweep 按上述生命周期回收。

## 测试文件组织

- 测试文件与被测源码同目录，命名 `<module>.test.ts`；服务端需要 JSX 时用 `.test.tsx`。
- 每个 Vitest 配置显式声明 `root`（仓库根或包根），不依赖 `process.cwd()`；include 覆盖
  该作用域内全部测试文件。
- 全量测试统一 `bun run test`（node 运行时）。`bun --bun` 直接运行 vitest 时部分依赖
  （如 zod）的 CJS/ESM interop 与 node 不同，过滤单文件可能误报
  `zod does not provide an export named 'z'`；以 node 运行时为准。
- 新增测试目录（如新 `scripts/<area>/`）必须同步加入对应配置的 `include`，否则测试
  永远不运行——「写了但从不跑」比没有测试更危险。
- 测试导入使用与源码一致的 `nbook/*` / `#manager/*` 别名，不使用跨项目相对路径。

## 平台与 CI

- 依赖 Windows 路径语义的测试用 `it.runIf(process.platform === "win32")`，其余平台跳过；
  POSIX 独有的信号语义测试用 `it.skipIf(process.platform === "win32")`。
- 测试不得依赖本机用户目录、`Program Files`、`C:\t145-*` 等机器特定路径；需要真实目录
  时全部使用 `mkdtemp(tmpdir()...)`（受控根）。
- CI 与本地跑同一套配置：clean-runner 不生成 `.nuxt/tsconfig.json` 时，相关配置使用独立
  esbuild transform（`oxc: false`），不依赖 Nuxt prepare 产物。

## 验收脚本（Task 145 及后续 Desktop 任务）

- `prepare-host.ps1` 等宿主机准备脚本：输入/证据默认落在系统 Temp 下的 Agent 受控目录，
  所有路径可参数化；`.wsb` 等模板文件不得写死本机路径，运行说明要求按脚本输出修改。
- 面向用户的下载产物（如最终 ZIP）不属于测试临时数据：放用户指定目录，并同时给出
  SHA-256 与构建身份（revision/imageId），不与其他 quick 构建混放。

## 验证门禁

- 提交前至少运行：受影响的聚焦测试、对应 typecheck、`git diff --check`。
- 全量 `bun run test` 中的既有 advisory 失败（如 Harness 黑盒超时）单独登记 Issue，
  不能把「focused 通过」写成「全量通过」。
