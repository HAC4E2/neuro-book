# GitHub 贡献体系第一期

> 当前状态：Implemented and verified (2026-07-28) / GitHub Issue chooser 人工验收待执行。

## User Request / Topic

- 为公开仓库建立可实际使用的 GitHub contribution 体系，包括贡献指南、Issue 规范、标签、PR 模板、安全报告和 PR 检查。
- 贡献指南需要覆盖开发规范、开发 Agent 协作以及现有 Task walkthrough 体系。
- GitHub Issues 同时承载错误、功能建议和使用帮助，不把使用问题导向外部社区。

## Goal

建立从公开 Issue 提交、维护者分流、实现与 Agent 协作、Task 记录、PR 验证到私密安全报告的完整入口，并保证：

- 中文贡献指南为主入口，英文镜像保持同等语义；
- 外部贡献者不需要先理解全部内部 Task 规则，也不会自行抢占 Task 编号；
- Issue 和 PR 能收集维护者实际需要的信息，并明确隐私边界；
- 标签和表单引用由仓库内清单与自动校验约束；
- 当前已知的类型检查和全量测试基线被如实展示，不通过 required check 锁死快速开发。

## Current State

实施前 GitHub Community Profile 健康度为 42%，只识别到 README 和 LICENSE；仓库没有贡献指南、Issue/PR 模板、安全政策或分支 ruleset。远端只有 GitHub 默认标签，10 个历史 Issue 中 6 个没有标签，4 个历史 PR 均没有标签。

本地基线调查确认：

- `bun run docs:build` 通过，约 39 秒；
- `bun run typecheck` 被 `server/agent/skills/llmlint.test.ts` 中 26 处既有测试 fixture 类型漂移阻断，主要是缺少新必填 `ignoreTerms`；
- 全量 `bun run test -- --reporter=dot` 在本地 240 秒内未收敛，并出现 Windows worker 终止和既有测试隔离问题。

## ADR / Decisions / Discussion

- 继续使用 `AGPL-3.0-only`，不引入 CLA、DCO 或双重许可。
- `CONTRIBUTING.md` 解释人类贡献工作流；`AGENTS.md` 继续承担开发 Agent 的详细执行规则，避免两套细则漂移。
- “开发 Agent”与“NeuroBook 产品 Agent”明确分开。使用 AI 工具无需强制披露，但贡献者必须理解、审查并承担全部改动责任。
- 新功能、跨模块改动和架构变化先经过 Issue 讨论并进入 `status: ready`；拼写、链接和小型文档修正可直接提交。
- Task 是重大实现的持续上下文，不是 Issue 副本。外部贡献者默认不自行分配 Task 编号或修改 `RELEASE.md`。
- 第一批标签保持四个维度：type、status、area、platform；保留 GitHub 发现入口 `good first issue`、`help wanted` 和 `duplicate`。
- Issue chooser 禁止空白 Issue，提供错误、功能建议、使用与安装三个双语表单。安全漏洞只走 GitHub Private Vulnerability Reporting。
- 暂不创建 `CODE_OF_CONDUCT.md`，等待确定可执行的私密投诉渠道后再讨论。
- 代码基线工作流标记为 Advisory，不设置 branch required checks；基线修复另建公开 Issue。
- 不建立 Discussions、CODEOWNERS、stale bot、欢迎机器人或其它当前贡献规模不需要的自动化。

## Implementation Walkthrough

### 贡献入口

- 新建中英文贡献指南，覆盖本地开发、稳定编码规范、隐私、Agent 协作、Task/ADR/Reference 分工、Git、PR、Review 和许可证。
- 在中英文 README、文档索引和 `AGENTS.md` 增加贡献入口。
- 新建双语 PR 模板和安全政策。

### Issue 与标签

- 新建错误报告、功能建议、使用与安装问题三个 Issue Form；每个表单都要求隐私确认和重复检查。
- 新建 `.github/labels.yml` 作为 22 个标签的仓库内真相源。
- 表单只自动添加 type 和 needs-triage；area、platform 和后续状态由维护者根据内容分流。

### 自动校验与 CI

- 新建 `scripts/ci/validate-community-files.ts`，解析所有新增 YAML，检查标签唯一性、颜色、双语描述、表单字段 ID、必填字段、标签引用、隐私确认和中英文贡献指南章节数量。
- 新建 Community and Docs Checks，对社区文件和文档改动执行清单校验与文档构建。
- 新建 Code Baseline (Advisory)，把 typecheck 与全量测试拆成独立 job，分别留下真实结果；当前不作为合并门禁。

## Verification / Test

- `bun scripts/ci/validate-community-files.ts` 通过：22 个标签、3 个 Issue Form、7 个 YAML；标签引用、字段 ID、必填字段、隐私确认和中英文贡献指南章节合同全部成立。
- `bun run docs:build` 通过；只有既有 chunk size warning。
- `git diff --check` 对本任务文件通过；只有仓库既有 CRLF 转换提示。
- 中英文贡献指南均为 170 行、10 个二级章节，并通过互链和章节数量自动校验。
- 已知非本任务基线：typecheck 26 处 llmlint fixture 错误；全量 Vitest 本地 240 秒未收敛。
- GitHub 远端复核通过：22 个标签的名称、颜色和双语描述与 `.github/labels.yml` 一致；#5、#6、#10、#12、#14 的分流符合本任务决定；CI 基线 Issue 为 [#15](https://github.com/notnotype/neuro-book/issues/15)。
- GitHub Private Vulnerability Reporting、Secret Scanning 和 Push Protection 均为 enabled；两条新增工作流均被 GitHub 识别为 active。
- Community Profile 健康度从 42% 升至 85%，已识别 `CONTRIBUTING.md` 和 PR 模板。该 API 不返回 Security 字段，且本次查询仍未把 YAML Issue Form 填入 `issue_template` 字段；表单文件、YAML 校验和配置路径均已独立验证，实际 Issue chooser 留作人工验收。
- 按仓库规则不自动执行浏览器验收；Issue chooser 视觉检查留作可选人工验收。

## Remote Changes

- 默认 `bug`、`enhancement`、`documentation`、`question` 已原地重命名为对应 `type:*` 标签，保留历史关联；保留的 `good first issue`、`help wanted`、`duplicate` 已更新双语描述；`invalid`、`wontfix` 已删除。
- 新增 15 个 type/status/area/platform 标签，远端标签总数为 22。
- 已分流开放 Issue：#14 feature/agent/needs-design；#12 feature/localization/help-wanted/needs-design；#10 bug/install-release/macos/needs-triage；#6 bug/agent/needs-triage；#5 bug/install-release/windows/needs-design。
- 已创建 [#15](https://github.com/notnotype/neuro-book/issues/15) 追踪可强制执行的 PR 质量门禁基线。
- 已开启 Private Vulnerability Reporting、Secret Scanning 和 Push Protection。
- 本期不创建 branch ruleset，不调整 merge/rebase/squash 设置。

## Deviations

- GitHub Community Profile API 只确认贡献指南和 PR 模板；它在本次查询中没有返回 YAML Issue Form 或 Security Policy 的识别字段。没有为了追求 API 健康度改回旧 Markdown Issue Template；YAML Form 是本项目需要的结构化入口，文件存在性和静态合同已经验证。

## TODO / Follow-ups

- 修复类型检查和全量测试基线后，再讨论 required checks 与 `master` ruleset。
- 确定社区行为投诉的私密处理渠道后，再讨论 `CODE_OF_CONDUCT.md`。
- 人工打开 GitHub Issue chooser，检查三个表单在桌面和窄屏下的实际呈现。
