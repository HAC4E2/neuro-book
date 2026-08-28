import {createHash} from "node:crypto";
import {execFile as execFileCallback} from "node:child_process";
import {mkdir, readFile, realpath, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {promisify} from "node:util";
import {afterEach, describe, expect, it} from "vitest";

import {canonicalSha256, primaryCheckoutRoot, readGitTextAttributes, resolveTaskReadmePath, verifyAgentSkillsAdaptation, verifyApplicationScriptBoundary, verifyLeaderDrivenDevelopmentContract, verifyMonorepoCutover, verifyMonorepoWorktreeLayout, verifySiblingResyncResolution, verifyTaskAgentWorkflowProfiles, verifyTaskMigration, verifyTaskOwnership, verifyWorkspacePackageGovernance} from "#scripts/ci/agent-governance-contract";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

const execFile = promisify(execFileCallback);
const fixtureRoots: string[] = [];
const repositoryRoot = join(import.meta.dirname, "..", "..");

afterEach(async () => {
    await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("canonical Task hash", () => {
    it("按 Git auto 语义将 lone CR 视为 binary，并豁免末尾 SUB", () => {
        const loneCr = Buffer.from([0x41, 0x0d, 0x0a, 0x42, 0x0d, 0x43]);
        const loneCrRawHash = `sha256:${createHash("sha256").update(loneCr).digest("hex")}`;
        const loneCrTextHash = `sha256:${createHash("sha256").update(Buffer.from([0x41, 0x0a, 0x42, 0x0d, 0x43])).digest("hex")}`;
        expect(canonicalSha256(loneCr, "auto")).toBe(loneCrRawHash);
        expect(canonicalSha256(loneCr, "auto")).not.toBe(loneCrTextHash);

        const trailingSub = Buffer.from([0x41, 0x0d, 0x0a, 0x42, 0x1a]);
        const normalizedTrailingSub = Buffer.from([0x41, 0x0a, 0x42, 0x1a]);
        const normalizedHash = `sha256:${createHash("sha256").update(normalizedTrailingSub).digest("hex")}`;
        const rawHash = `sha256:${createHash("sha256").update(trailingSub).digest("hex")}`;
        expect(canonicalSha256(trailingSub, "auto")).toBe(normalizedHash);
        expect(normalizedHash).not.toBe(rawHash);
        const internalSub = Buffer.from([0x41, 0x1a, 0x0d, 0x0a, 0x42]);
        const internalSubRawHash = `sha256:${createHash("sha256").update(internalSub).digest("hex")}`;
        expect(canonicalSha256(internalSub, "auto")).toBe(internalSubRawHash);
    });
    it("localOnly destination 的 CRLF 仍按 Git text canonical hash 校验", async () => {
        const repoRoot = await createLocalOnlyMigrationFixture();
        const destination = ".agents/tasks/01-local/benchmark.json";
        const attributes = readGitTextAttributes(repoRoot, ["docs/tasks/01-local/benchmark.json", destination]);

        expect(attributes.get("docs/tasks/01-local/benchmark.json")).toBe("unspecified");
        expect(attributes.get(destination)).toBe("set");
        expect(verifyTaskMigration(repoRoot)).toEqual([]);
    });
});

describe("Task ownership 当前树门禁", () => {
    it("当前 ownership、双根和 tracked 文件闭合", () => {
        expect(verifyTaskOwnership(repositoryRoot)).toEqual([]);
    });

    it("ownership 声明文件未进入 Git index 时失败", async () => {
        const repoRoot = await createOwnershipFixture({trackTask: false});

        expect(verifyTaskOwnership(repoRoot)).toContain("ownership 文件尚未进入 Git index：packages/neuro-book/.agents/tasks/01-alpha/README.md");
        expect(verifyTaskOwnership(repoRoot)).not.toContain("ownership 文件 hash 不一致：packages/neuro-book/.agents/tasks/01-alpha/README.md");
    });

    it("ownership 文件 hash 漂移时失败", async () => {
        const repoRoot = await createOwnershipFixture({trackTask: true});
        await writeText(repoRoot, "packages/neuro-book/.agents/tasks/01-alpha/README.md", "changed\n");

        expect(verifyTaskOwnership(repoRoot)).toContain("ownership 文件 hash 不一致：packages/neuro-book/.agents/tasks/01-alpha/README.md");
    });

    it("应用 Task 目录缺少 ownership 登记时失败", async () => {
        const repoRoot = await createOwnershipFixture({trackTask: true});
        await mkdir(join(repoRoot, "packages/neuro-book/.agents/tasks/02-unregistered"), {recursive: true});

        expect(verifyTaskOwnership(repoRoot)).toContain("应用 Task 目录未登记 ownership：packages/neuro-book/.agents/tasks/02-unregistered");
    });

    it("旧 docs/tasks 目录重新出现时失败", async () => {
        const repoRoot = await createOwnershipFixture({trackTask: true});
        await writeText(repoRoot, "docs/tasks/01-legacy/README.md", "legacy\n");

        expect(verifyTaskOwnership(repoRoot)).toContain("旧 Task 目录仍存在：docs/tasks");
    });

    it("根与应用 schema Task ID 重复时失败", async () => {
        const repoRoot = await createOwnershipFixture({trackTask: true});
        await writeText(repoRoot, ".agents/tasks/02-root/README.md", "---\nschema: nbook.task/v1\ntaskId: 01-alpha\n---\n\n# Duplicate\n");

        expect(verifyTaskOwnership(repoRoot).some((failure) => failure.startsWith("全仓 Task ID 重复：01-alpha"))).toBe(true);
    });

    it("ownership 精确选择应用与根 Task root", () => {
        const app = resolveTaskReadmePath(repositoryRoot, "01-agent-roleplay-mode");
        expect(app.path).toBe(join(repositoryRoot, "packages/neuro-book/.agents/tasks/01-agent-roleplay-mode/README.md"));
        expect(app.checkedRoots).toEqual(["packages/neuro-book/.agents/tasks"]);

        const root = resolveTaskReadmePath(repositoryRoot, "00149-monorepo-workspace-consolidation");
        expect(root.path).toBe(join(repositoryRoot, ".agents/tasks/00149-monorepo-workspace-consolidation/README.md"));
        expect(root.checkedRoots).toEqual([".agents/tasks"]);

        const missing = resolveTaskReadmePath(repositoryRoot, "99999-does-not-exist");
        expect(missing.path).toBeNull();
        expect(missing.checkedRoots).toEqual([".agents/tasks"]);
    });
});
describe("Agent Skills 适配治理门禁", () => {
    it("draft Proposal 出现 Skill 实现时失败", async () => {
        const repoRoot = await createAgentSkillsAdaptationFixture("draft", "complete");

        expect(verifyAgentSkillsAdaptation(repoRoot)).toContain("Agent Skills Proposal 仍为 draft，但适配实现已出现");
    });
    it("draft Proposal 出现真实 Task agentWorkflow 时失败", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 001-profile
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: bug
  routes:
    - diagnosing-bugs
  verification:
    required:
      - focused-test
    notRun: []
---

# Draft profile
`);
        await writeText(repoRoot, "packages/neuro-book/docs/proposals/agent-skills-adaptation.md", "# Proposal\n\n状态：draft\n");

        expect(verifyAgentSkillsAdaptation(repoRoot)).toContain("Agent Skills Proposal 仍为 draft，但适配实现已出现");
    });


    it("accepted Proposal 与完整适配入口同时存在时通过", async () => {
        const repoRoot = await createAgentSkillsAdaptationFixture("accepted", "complete");

        expect(verifyAgentSkillsAdaptation(repoRoot)).toEqual([]);
    });
    it("accepted Proposal 缺少 research Task 合同时失败", async () => {
        const repoRoot = await createAgentSkillsAdaptationFixture("accepted", "complete");
        await writeText(repoRoot, "packages/neuro-book/docs/proposals/agent-skills-adaptation.md", "# Proposal\n\n状态：accepted\n\n`kind`限定为`feedback`、`design`、`bug`、`feature`、`refactor`、`docs`、`release`、`migration`。\n");

        expect(verifyAgentSkillsAdaptation(repoRoot)).toContain("Agent Skills Proposal 缺少 research Task 合同");
    });
    it("accepted fixture 缺少 report Skill 合同内容时失败", async () => {
        const repoRoot = await createAgentSkillsAdaptationFixture("accepted", "invalid-report");

        expect(verifyAgentSkillsAdaptation(repoRoot)).toContain("report Skill 缺少有效 frontmatter");
    });
    it("accepted fixture 缺少 load_role Skill 合同内容时失败", async () => {
        const repoRoot = await createAgentSkillsAdaptationFixture("accepted", "invalid-load_role");

        expect(verifyAgentSkillsAdaptation(repoRoot)).toContain("load_role Skill 缺少有效 frontmatter");
    });
    it("accepted fixture 缺少 Task verification 固定字段时失败", async () => {
        const repoRoot = await createAgentSkillsAdaptationFixture("accepted", "missing-task-fields");

        expect(verifyAgentSkillsAdaptation(repoRoot)).toContain("Task 合同缺少完整 agentWorkflow 字段");
    });
    it("accepted fixture 缺少治理函数真实导出时失败", async () => {
        const repoRoot = await createAgentSkillsAdaptationFixture("accepted", "missing-contract-export");

        expect(verifyAgentSkillsAdaptation(repoRoot)).toContain("治理合同缺少完整 Agent Skills 校验");
    });

    it("accepted fixture 缺少治理 CLI 真实调用时失败", async () => {
        const repoRoot = await createAgentSkillsAdaptationFixture("accepted", "missing-cli-call");

        expect(verifyAgentSkillsAdaptation(repoRoot)).toContain("治理入口缺少 Agent Skills 校验调用");
    });
    it("accepted fixture 缺少治理合同 import 时失败", async () => {
        const repoRoot = await createAgentSkillsAdaptationFixture("accepted", "missing-cli-import");

        expect(verifyAgentSkillsAdaptation(repoRoot)).toContain("治理入口缺少 Agent Skills 校验调用");
    });

    it("accepted fixture 使用局部同名 stub 时失败", async () => {
        const repoRoot = await createAgentSkillsAdaptationFixture("accepted", "shadowed-cli-call");

        expect(verifyAgentSkillsAdaptation(repoRoot)).toContain("治理入口缺少 Agent Skills 校验调用");
    });
    it("accepted fixture 使用 import type 时失败", async () => {
        const repoRoot = await createAgentSkillsAdaptationFixture("accepted", "type-only-cli-import");

        expect(verifyAgentSkillsAdaptation(repoRoot)).toContain("治理入口缺少 Agent Skills 校验调用");
    });
    it("accepted fixture 在嵌套作用域使用合法 import 时通过", async () => {
        const repoRoot = await createAgentSkillsAdaptationFixture("accepted", "nested-valid-cli-call");

        expect(verifyAgentSkillsAdaptation(repoRoot)).toEqual([]);
    });
    it("accepted fixture 仅在未调用函数中使用治理调用时失败", async () => {
        const repoRoot = await createAgentSkillsAdaptationFixture("accepted", "dead-function-cli-call");

        expect(verifyAgentSkillsAdaptation(repoRoot)).toContain("治理入口缺少 Agent Skills 校验调用");
    });


    it("治理 CLI 聚合 accepted、draft 和缺少 required 的 profile 结果", async () => {
        const repoRoot = await createGovernanceCliFixture();
        const proposalPath = "packages/neuro-book/docs/proposals/agent-skills-adaptation.md";
        const profilePath = ".agents/tasks/001-profile/README.md";
        const accepted = await runGovernanceCli(repoRoot);

        expect(accepted.report.failures).toEqual([]);
        expect(accepted.status, JSON.stringify(accepted.report)).toBe(0);

        await writeText(repoRoot, proposalPath, "# Proposal\n\n状态：draft\n");
        const draft = await runGovernanceCli(repoRoot);
        expect(draft.status).not.toBe(0);
        expect(draft.report.failures).toContain("Agent Skills Proposal 仍为 draft，但适配实现已出现");

        await writeText(repoRoot, proposalPath, "# Proposal\n\n状态：accepted\n");
        await writeText(repoRoot, profilePath, `---
schema: nbook.task/v1
taskId: 001-profile
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: bug
  routes:
    - diagnosing-bugs
  verification:
    notRun: []
---

# Missing required
`);
        const missingRequired = await runGovernanceCli(repoRoot);
        expect(missingRequired.status).not.toBe(0);
        expect(missingRequired.report.failures).toEqual(expect.arrayContaining([
            expect.stringContaining("Task verification.required 必须是非空数组"),
        ]));
    }, 30_000);




    it("历史 Task 可缺少 agentWorkflow，但仍有完整基础字段", async () => {
        const taskId = "00149-monorepo-workspace-consolidation";
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: ${taskId}
status: completed
createdAt: 2026-08-16T14:59:07Z
updatedAt: 2026-08-19T10:35:00Z
---

# Historical Task
`, taskId);

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toEqual([]);
    });

    it("新 Task 缺少成熟度或 agentWorkflow 时失败", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 001-profile
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
---

# Incomplete Task
`);

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("Task status 无效"),
            expect.stringContaining("新 Task 缺少 agentWorkflow"),
        ]));
    });

    it("新 Task 缺少 context 时失败", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 001-profile
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: docs
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# Missing context Task
`);
        await rm(join(repoRoot, ".agents/tasks/001-profile/context.md"));

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toContain("Task 缺少 context.md：.agents/tasks/001-profile/README.md");
    });

    it("合法 design Task 必须声明设计边界与 API 路由", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 001-profile
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: design
  routes:
    - api-and-interface-design
  verification:
    required:
      - docs-check
    notRun: []
---

# API Design Task

## 设计类型

API

## 设计产物

- docs/specs/example/api.md

## 决策范围

- API输入、输出、错误与兼容。

## 允许文件

- docs/specs/example/api.md
`);

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toEqual([]);
    });

    it("design Task 拒绝 Proposal/Spec 路径穿越", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 001-profile
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: design
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# Traversal Design Task

## 设计类型

模块边界

## 设计产物

- docs/specs/../../AGENTS.md

## 决策范围

- 只验证产物路径。

## 允许文件

- docs/specs/../../AGENTS.md
`);

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toContain("design Task 必须有唯一 Proposal/Spec 设计产物：.agents/tasks/001-profile/README.md");
    });

    it("合法 research Task 只允许 Task 内研究报告与证据", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 001-profile
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: research
  routes:
    - domain-modeling
  verification:
    required:
      - docs-check
    notRun: []
---

# Runtime Research Task

## 研究问题

- Harness 是否拥有模型运行循环？

## 研究产物

- .agents/tasks/001-profile/walkthroughs/001-runtime-observation.md
- .agents/tasks/001-profile/evidences/runtime-provenance.json

## 决策范围

- 比较候选并记录开发者决定，不创建 Proposal、Spec 或业务实现。

## 允许文件

- .agents/tasks/001-profile/walkthroughs/001-runtime-observation.md
- .agents/tasks/001-profile/evidences/runtime-provenance.json
`);

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toEqual([]);
    });

    it("research Task 不能用 fenced 示例伪造必需章节", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 001-profile
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: research
  routes:
    - domain-modeling
  verification:
    required:
      - docs-check
    notRun: []
---

# Invalid Fenced Research Task

\`\`\`markdown
## 研究问题

- 这里只是示例吗？

## 研究产物

- .agents/tasks/001-profile/walkthroughs/example.md

## 决策范围

- 示例范围。

## 允许文件

- .agents/tasks/001-profile/walkthroughs/example.md
\`\`\`
`);

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("research Task 缺少研究问题"),
            expect.stringContaining("research Task 缺少研究产物"),
            expect.stringContaining("research Task 缺少决策范围"),
            expect.stringContaining("research Task 缺少允许文件"),
        ]));
    });

    it("research Task 不能用缩进代码块伪造必需章节", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 001-profile
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: research
  routes:
    - domain-modeling
  verification:
    required:
      - docs-check
    notRun: []
---

# Invalid Indented Research Task

    ## 研究问题

    - 这里只是代码示例吗？

    ## 研究产物

    - .agents/tasks/001-profile/walkthroughs/example.md

    ## 决策范围

    - 示例范围。

    ## 允许文件

    - .agents/tasks/001-profile/walkthroughs/example.md
`);

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("research Task 缺少研究问题"),
            expect.stringContaining("research Task 缺少研究产物"),
            expect.stringContaining("research Task 缺少决策范围"),
            expect.stringContaining("research Task 缺少允许文件"),
        ]));
    });

    it("research Task 拒绝缺失问题和 Task 外产物", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 001-profile
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: research
  routes:
    - domain-modeling
  verification:
    required:
      - docs-check
    notRun: []
---

# Invalid Research Task

## 研究产物

- docs/proposals/runtime.md

## 决策范围

- 选择 Runtime。

## 允许文件

- docs/proposals/runtime.md
- packages/neuro-book/server/runtime.ts
`);

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("research Task 缺少研究问题"),
            expect.stringContaining("research Task 研究产物越界"),
            expect.stringContaining("research Task 允许文件越界"),
        ]));
    });

    it("research Task 拒绝 Windows 反斜杠路径穿越", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 001-profile
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: research
  routes:
    - domain-modeling
  verification:
    required:
      - docs-check
    notRun: []
---

# Traversal Research Task

## 研究问题

- 是否拒绝路径穿越？

## 研究产物

- .agents/tasks/001-profile/walkthroughs/..\\..\\AGENTS.md

## 决策范围

- 只验证报告路径。

## 允许文件

- .agents/tasks/001-profile/walkthroughs/..\\..\\AGENTS.md
`);

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("research Task 研究产物越界"),
            expect.stringContaining("research Task 允许文件越界"),
        ]));
    });

    it("自治包当前 schema Task 也受 agentWorkflow 门禁约束", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 001-profile
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: docs
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# Root Task
`);
        await writeText(repoRoot, "packages/example/.agents/tasks/02-research/README.md", `---
schema: nbook.task/v1
taskId: 02-research
actionIssueId: 193
status: draft
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: research
  routes:
    - domain-modeling
  verification:
    required:
      - artifact-structure-check
    notRun: []
---

# Package Research Task
`);
        await writeText(repoRoot, "packages/example/.agents/tasks/02-research/context.md", "# Context\n");

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("research Task 缺少研究问题"),
            expect.stringContaining("research Task 缺少研究产物"),
            expect.stringContaining("Task verification.required[0] 无效"),
        ]));
    });

    it("自治包带 frontmatter 的 Task 不能用错误 schema 绕过合同", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 001-profile
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: docs
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# Root Task
`);
        await writeText(repoRoot, "packages/example/.agents/tasks/02-wrong-schema/README.md", `---
schema: wrong.task/v1
taskId: 02-wrong-schema
---

# Wrong Schema Package Task
`);
        await writeText(repoRoot, "packages/example/.agents/tasks/02-wrong-schema/context.md", "# Context\n");

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toContain("新 Task 缺少有效 nbook.task/v1 frontmatter：packages/example/.agents/tasks/02-wrong-schema/README.md");
    });

    it("自治包当前 schema Task 不能借根 legacy ID 跳过 context 或 agentWorkflow", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 001-profile
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: docs
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# Root Task
`);
        await writeText(repoRoot, "packages/example/.agents/tasks/00158-notification-contrast-fix/README.md", `---
schema: nbook.task/v1
taskId: 00158-notification-contrast-fix
actionIssueId: 193
status: draft
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: docs
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# Missing Package Context
`);
        await writeText(repoRoot, "packages/example/.agents/tasks/00149-monorepo-workspace-consolidation/README.md", `---
schema: nbook.task/v1
taskId: 00149-monorepo-workspace-consolidation
actionIssueId: 193
status: draft
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
---

# Missing Package Workflow
`);
        await writeText(repoRoot, "packages/example/.agents/tasks/00149-monorepo-workspace-consolidation/context.md", "# Context\n");

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("Task 缺少 context.md：packages/example/.agents/tasks/00158-notification-contrast-fix/README.md"),
            expect.stringContaining("新 Task 缺少 agentWorkflow：packages/example/.agents/tasks/00149-monorepo-workspace-consolidation/README.md"),
        ]));
    });

    it("自治包 Task 目录缺少 README 时失败", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 001-profile
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: docs
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# Root Task
`);
        await writeText(repoRoot, "packages/example/.agents/tasks/02-missing/context.md", "# Context\n");

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toContain("新 Task 缺少 README.md：packages/example/.agents/tasks/02-missing/README.md");
    });

    it("design Task 缺少设计边界或 API 路由时失败", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 001-profile
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: design
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# API Design Task

## 设计类型

API
`);

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("design Task 必须有唯一 Proposal/Spec 设计产物"),
            expect.stringContaining("design Task 缺少决策范围"),
            expect.stringContaining("design Task 缺少允许文件"),
            expect.stringContaining("API design Task 缺少 api-and-interface-design"),
        ]));
    });

    it("新 Task 不能用缺失 README 或错误 schema 绕过合同", async () => {
        const taskId = "00161-profile";
        const repoRoot = await createTaskWorkflowFixture(`---
schema: wrong.task/v1
taskId: ${taskId}
---

# Wrong schema Task
`, taskId);

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toContain(`新 Task 缺少有效 nbook.task/v1 frontmatter：.agents/tasks/${taskId}/README.md`);
        await rm(join(repoRoot, `.agents/tasks/${taskId}/README.md`));
        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toContain(`新 Task 缺少 README.md：.agents/tasks/${taskId}/README.md`);
    });

    it("新 Task 拒绝非法 Issue 聚合字段和 parentTaskId", async () => {
        const taskId = "00161-profile";
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: ${taskId}
actionIssueId:
  - 191
parentTaskId: 00160-parent
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: docs
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# Invalid aggregation Task
`, taskId);

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("Task actionIssueId 必须是正整数或 null"),
            expect.stringContaining("Task 禁止聚合字段 parentTaskId"),
        ]));
    });

    it("design Task 拒绝多目标和业务源码允许路径", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 001-profile
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: design
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# Invalid API Design Task

## 设计类型

- API

## 设计产物

- docs/specs/example/api.md
- docs/proposals/example-api.md

## 决策范围

- API输入与输出。

## 允许文件

- docs/specs/example/api.md
- packages/neuro-book/app/api.ts
`);

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("design Task 必须有唯一 Proposal/Spec 设计产物"),
            expect.stringContaining("design Task 允许文件越界"),
            expect.stringContaining("API design Task 缺少 api-and-interface-design"),
        ]));
    });

    it("应用 Task root 的新 Task 不能绕过 schema 与 Issue 聚合门禁", async () => {
        const taskId = "149-profile";
        const repoRoot = await createApplicationTaskWorkflowFixture(`---
schema: wrong.task/v1
taskId: ${taskId}
---

# Wrong app Task
`, taskId);
        const relativePath = `packages/neuro-book/.agents/tasks/${taskId}/README.md`;

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toContain(`新 Task 缺少有效 nbook.task/v1 frontmatter：${relativePath}`);
        await writeText(repoRoot, relativePath, `---
schema: nbook.task/v1
taskId: ${taskId}
actionIssueId: 0
actionIssueIds:
  - 191
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: docs
  routes:
    - documentation-and-adrs
  verification:
    required:
      - docs-check
    notRun: []
---

# Invalid app Task
`);
        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("Task actionIssueId 必须是正整数或 null"),
            expect.stringContaining("Task 禁止聚合字段 actionIssueIds"),
        ]));
        await rm(join(repoRoot, relativePath));
        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toContain(`新 Task 缺少 README.md：${relativePath}`);
    });
    it("agentWorkflow 枚举拒绝原型链属性", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 001-profile
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: toString
  routes:
    - diagnosing-bugs
  verification:
    required:
      - toString
    notRun: []
---

# Prototype profile
`);

        const failures = verifyTaskAgentWorkflowProfiles(repoRoot);
        expect(failures).toEqual(expect.arrayContaining([
            expect.stringContaining("Task agentWorkflow.kind 无效"),
            expect.stringContaining("Task verification.required[0] 无效"),
        ]));
    });

    it("agentWorkflow 必须显式提供 notRun", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 001-profile
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: bug
  routes:
    - diagnosing-bugs
  verification:
    required:
      - focused-test
---

# Missing notRun
`);

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toEqual(expect.arrayContaining([expect.stringContaining("Task verification.notRun 必须显式提供")]));
    });


    it("非法 kind、空 routes、重复 required、缺少 notRun reason 和重叠检查均失败", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 001-profile
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: unknown
  routes: []
  verification:
    required:
      - focused-test
      - focused-test
    notRun:
      - check: browser
      - check: focused-test
        reason: 未运行
---

# Invalid Profile Task
`);

        const failures = verifyTaskAgentWorkflowProfiles(repoRoot);
        expect(failures).toEqual(expect.arrayContaining([
            expect.stringContaining("Task agentWorkflow.kind 无效"),
            expect.stringContaining("Task agentWorkflow.routes 必须是非空数组"),
            expect.stringContaining("Task verification.required 含重复项"),
            expect.stringContaining("Task verification.notRun[0] 缺少非空 reason"),
            expect.stringContaining("Task verification.required 与 verification.notRun 重叠"),
        ]));
    });
});

describe("Leader 主导顺序开发治理门禁", () => {
    it("当前角色与文件交互合同闭合", () => {
        expect(verifyLeaderDrivenDevelopmentContract(repositoryRoot)).toEqual([]);
    });

    it("任一顺序流程合同丢失时失败", async () => {
        const repoRoot = await createTestTmpRoot("leader-driven-contract", "leader-driven-contract-test");
        fixtureRoots.push(repoRoot);
        const contractPaths = [
            "AGENTS.md",
            ".omp/RULES.md",
            "docs/proposals/p-005-development-workflow-governance.md",
            ".agents/issues/README.md",
            "docs/standards/repository-workflow.md",
            "docs/specs/AGENTS.md",
            ".agents/roles/pm/AGENTS.md",
            ".agents/roles/leader/AGENTS.md",
            ".agents/roles/tasker/AGENTS.md",
            ".agents/roles/reviewer/AGENTS.md",
            ".agents/tasks/README.md",
            ".agents/tasks/AGENTS.md",
        ] as const;
        for (const relativePath of contractPaths) {
            await writeText(repoRoot, relativePath, await readFile(join(repositoryRoot, relativePath), "utf8"));
        }

        for (const relativePath of contractPaths) {
            const original = await readFile(join(repoRoot, relativePath), "utf8");
            await writeText(repoRoot, relativePath, `# Missing contract: ${relativePath}\n`);
            expect(verifyLeaderDrivenDevelopmentContract(repoRoot)).toEqual([
                `Leader 主导顺序开发合同缺少必需标记：${relativePath}`,
            ]);
            await writeText(repoRoot, relativePath, original);
        }

        expect(verifyLeaderDrivenDevelopmentContract(repoRoot)).toEqual([]);

        const leaderPath = ".agents/roles/leader/AGENTS.md";
        const leader = await readFile(join(repoRoot, leaderPath), "utf8");
        const forbiddenMutations = [
            "Leader 必须等待 PM 确认后开始。",
            "status: claimed 批准后 Leader 才能开始编排。",
            "planned Task 可以直接 push。",
            "draft 可由 Tasker 执行。",
            "Task completed 可以自动触发 Project Done。",
            "PR 合并可以直接触发 Done。",
            "Reviewer 建议合并可以触发 Done。",
            "CI 通过可以自动进入 Done。",
        ] as const;
        for (const mutation of forbiddenMutations) {
            await writeText(repoRoot, leaderPath, `${leader}\n${mutation}\n`);
            expect(verifyLeaderDrivenDevelopmentContract(repoRoot).some((failure) => failure.startsWith(`Leader 主导顺序开发合同出现禁用语义：${leaderPath}`)), mutation).toBe(true);
        }
        await writeText(repoRoot, leaderPath, leader);
        expect(verifyLeaderDrivenDevelopmentContract(repoRoot)).toEqual([]);
    });
});

describe("workspace 包级治理门禁", () => {
    it("允许带根继承链接的可选包治理资产", async () => {
        const repoRoot = await createPackageFixture({runtime: null, autonomous: false});

        expect(verifyWorkspacePackageGovernance(repoRoot)).toEqual([]);
    });

    it("自治包缺少 docs、Task 或状态资产时失败", async () => {
        const repoRoot = await createPackageFixture({runtime: null, autonomous: true});

        expect(verifyWorkspacePackageGovernance(repoRoot)).toEqual([
            "包级治理资产缺少 AGENTS.md：packages/nb-history/AGENTS.md",
            "自治workspace包缺少归属资产：packages/nb-history/.agents/tasks",
            "自治workspace包缺少归属资产：packages/nb-history/docs",
            "自治workspace包缺少归属资产：packages/nb-history/PROJECT-STATUS.md",
        ]);
    });

    it("允许被忽略且未跟踪的包级 .local，拒绝被跟踪的运行态", async () => {
        const ignoredRoot = await createPackageFixture({runtime: ".local", autonomous: false});
        expect(verifyWorkspacePackageGovernance(ignoredRoot)).toEqual([]);

        const trackedRoot = await createPackageFixture({runtime: ".agent", autonomous: false, trackRuntime: true});
        expect(verifyWorkspacePackageGovernance(trackedRoot)).toContain("包级运行态被 Git 跟踪：packages/sample/.agent");
    });
});

describe("最终 monorepo 收敛门禁", () => {
    it("当前迁移结果的旧根入口、应用脚本边界与 sibling 对账均闭合", () => {
        expect(verifyMonorepoCutover(repositoryRoot)).toEqual([]);
        expect(verifyApplicationScriptBoundary(repositoryRoot)).toEqual([]);
        expect(verifySiblingResyncResolution(repositoryRoot)).toEqual([]);
    });

    it("拒绝旧根应用源码和根应用命令重新出现", async () => {
        const repoRoot = await createTestTmpRoot("governance-cutover", "governance-cutover-test");
        fixtureRoots.push(repoRoot);
        await writeText(repoRoot, "package.json", JSON.stringify({name: "fixture", version: "1.0.0", scripts: {dev: "nuxt dev"}}));
        await writeText(repoRoot, "server/index.ts", "export {};\n");
        await runGit(repoRoot, ["init", "--initial-branch", "master"]);
        await runGit(repoRoot, ["add", "."]);

        expect(verifyMonorepoCutover(repoRoot)).toEqual(expect.arrayContaining([
            "旧根应用路径重新出现：server/index.ts",
            "根 workspace orchestrator 不得声明产品 version",
            "根 workspace 保留应用或同步命令：dev",
        ]));
    });

    it("只允许 source-dev 读取根 workspace locator", async () => {
        const repoRoot = await createTestTmpRoot("governance-app-scripts", "governance-app-scripts-test");
        fixtureRoots.push(repoRoot);
        await writeText(repoRoot, "packages/neuro-book/scripts/cli/source-dev.ts", [
            'import {resolveWorkspaceRoots} from "#scripts/utils/workspace-roots";',
            'import type {WorkspaceRoots} from "#scripts/utils/workspace-roots";',
            "export {resolveWorkspaceRoots};",
        ].join("\n"));
        expect(verifyApplicationScriptBoundary(repoRoot)).toEqual([]);

        await writeText(repoRoot, "packages/neuro-book/scripts/smoke/agent.ts", 'import "#scripts/utils/workspace-roots";\n');
        await writeText(repoRoot, "packages/neuro-book/scripts/cli/source-dev.ts", 'import "#scripts/utils/process.mjs";\n');
        expect(verifyApplicationScriptBoundary(repoRoot)).toEqual([
            "应用跨根 #scripts 导入违规：packages/neuro-book/scripts/cli/source-dev.ts -> #scripts/utils/process.mjs",
            "应用跨根 #scripts 导入违规：packages/neuro-book/scripts/smoke/agent.ts -> #scripts/utils/workspace-roots",
        ]);
    });

    it("拒绝 sibling 对账输入 hash 被改写", async () => {
        const repoRoot = await createTestTmpRoot("governance-resync", "governance-resync-test");
        fixtureRoots.push(repoRoot);
        const relativePath = ".agents/tasks/00149-monorepo-workspace-consolidation/evidences/s8-sibling-resync-resolution.json";
        const report = JSON.parse(await readFile(join(repositoryRoot, relativePath), "utf8")) as {inputs: Record<string, string>};
        report.inputs["sibling-import-manifest.json"] = "sha256:invalid";
        await writeText(repoRoot, relativePath, `${JSON.stringify(report)}\n`);

        expect(verifySiblingResyncResolution(repoRoot)).toContain("sibling resync 输入 hash 不匹配：sibling-import-manifest.json");
    });

    it("拒绝 sibling 单包计数被重写", async () => {
        const repoRoot = await createTestTmpRoot("governance-resync-count", "governance-resync-count-test");
        fixtureRoots.push(repoRoot);
        const relativePath = ".agents/tasks/00149-monorepo-workspace-consolidation/evidences/s8-sibling-resync-resolution.json";
        const report = JSON.parse(await readFile(join(repositoryRoot, relativePath), "utf8")) as {
            projects: Record<string, {allowlist: number; exact: number}>;
            totals: {allowlist: number; exact: number};
        };
        report.projects["nb-history"].allowlist -= 1;
        report.projects["nb-history"].exact -= 1;
        report.totals.allowlist -= 1;
        report.totals.exact -= 1;
        await writeText(repoRoot, relativePath, `${JSON.stringify(report)}\n`);

        expect(verifySiblingResyncResolution(repoRoot)).toContain("sibling resync 项目计数不匹配：nb-history");
    });

    it("拒绝仅保留输入 hash 的空 sibling 对账报告", async () => {
        const repoRoot = await createTestTmpRoot("governance-resync-empty", "governance-resync-empty-test");
        fixtureRoots.push(repoRoot);
        const relativePath = ".agents/tasks/00149-monorepo-workspace-consolidation/evidences/s8-sibling-resync-resolution.json";
        const report = JSON.parse(await readFile(join(repositoryRoot, relativePath), "utf8")) as {
            projects: Record<string, unknown>;
            totals: Record<string, number>;
        };
        report.projects = {};
        report.totals = {
            allowlist: 0,
            exact: 0,
            classifiedAllowlistDifferences: 0,
            unclassifiedAllowlistDifferences: 0,
            missing: 0,
            deletionCandidates: 0,
            copyActions: 0,
        };
        await writeText(repoRoot, relativePath, `${JSON.stringify(report)}\n`);

        const failures = verifySiblingResyncResolution(repoRoot);
        expect(failures).toContain("sibling resync 项目集合不匹配：");
        expect(failures).toContain("sibling resync 固定总数不匹配：allowlist");
    });
});

describe("monorepo worktree 根门禁", () => {
    it("解析 linked worktree 的主 checkout，并拒绝 canonical 根外 worktree", async () => {
        const {primary, linked, outside} = await createWorktreeFixture();
        try {
            expect(primaryCheckoutRoot(linked)).toBe(await realpath(primary));
            expect(verifyMonorepoWorktreeLayout(linked).some((failure) => failure.includes("monorepo worktree 位置违规"))).toBe(true);
        } finally {
            await runGit(primary, ["worktree", "remove", "--force", linked]);
            await runGit(primary, ["worktree", "remove", "--force", outside]);
        }
    });
});

async function createAgentSkillsAdaptationFixture(status: "draft" | "accepted", implementation: "invalid-report" | "invalid-load_role" | "missing-task-fields" | "missing-contract-export" | "missing-cli-call" | "missing-cli-import" | "shadowed-cli-call" | "type-only-cli-import" | "nested-valid-cli-call" | "dead-function-cli-call" | "complete"): Promise<string> {
    const root = await createTestTmpRoot("governance-agent-skills", "governance-agent-skills-test");
    fixtureRoots.push(root);
    await writeText(root, "packages/neuro-book/docs/proposals/agent-skills-adaptation.md", `# Proposal\n\n状态：${status}\n\n\`research\` \`研究问题\` \`研究产物\` 当前Task的精确walkthrough/evidence路径 不得写README、context、Proposal、Spec或业务源码 research/design边界 根/应用/自治包当前schema Task身份\n`);
    const validReport = implementation !== "invalid-report";
    const validLoadRole = implementation !== "invalid-load_role";
    await writeText(root, ".agents/skills/report/SKILL.md", validReport
        ? "---\nname: report\ndescription: Report current state and next action.\nargument-hint: 'Request, file, or decision to report'\n---\n$ARGUMENTS\n当前状态\n下一步\n"
        : "name: report\n");
    await writeText(root, ".agents/skills/load_role/SKILL.md", validLoadRole
        ? "---\nname: load_role\ndescription: Load one canonical project role contract.\nargument-hint: 'Role: pm | leader | tasker | reviewer'\ndisable-model-invocation: true\n---\n$ARGUMENTS\npm\nleader\ntasker\nreviewer\n.agents/roles/<role>/AGENTS.md\n"
        : "name: load_role\n");
    if (!validReport || !validLoadRole) return root;

    const taskContract = implementation === "missing-task-fields"
        ? "```yaml\nagentWorkflow:\n  profile: nbook.agent-skills/v1\n  kind: bug\n  routes:\n```\n"
        : "```yaml\nagentWorkflow:\n  profile: nbook.agent-skills/v1\n  kind: bug\n  routes:\n    - diagnosing-bugs\n  verification:\n    required:\n      - focused-test\n    notRun: []\n```\n";
    await writeText(root, ".agents/tasks/README.md", taskContract);
    await writeText(root, ".agents/skills/README.md", "- [report/SKILL.md](report/SKILL.md)\n- [load_role/SKILL.md](load_role/SKILL.md)\n");
    await writeText(root, "docs/standards/code/README.md", ".agents/skills/**/*.md writing-for-agents/SKILL.md writing-for-agents/SKILL-MECHANICS.md\n");
    await writeText(root, ".agents/tasks/AGENTS.md", "agentWorkflow .agents/skills/load_role/SKILL.md verification.required verification.notRun\n");
    for (const role of ["pm", "leader", "tasker", "reviewer"]) {
        await writeText(root, `.agents/roles/${role}/AGENTS.md`, "agentWorkflow required notRun\n");
    }
    await writeText(root, "scripts/ci/agent-governance-contract.ts", implementation === "missing-contract-export"
        ? "/*\nexport function verifyAgentSkillsAdaptation(repoRoot: string): string[] { return []; }\nexport function verifyTaskAgentWorkflowProfiles(repoRoot: string): string[] { return []; }\n*/\n"
        : "export function verifyAgentSkillsAdaptation(repoRoot: string): string[] { return []; }\nexport function verifyTaskAgentWorkflowProfiles(repoRoot: string): string[] { return []; }\n");
    await writeText(root, "scripts/ci/agent-governance.ts", implementation === "missing-cli-call"
        ? "/*\nfailures.push(...verifyAgentSkillsAdaptation(repoRoot));\nfailures.push(...verifyTaskAgentWorkflowProfiles(repoRoot));\n*/\n"
        : implementation === "missing-cli-import"
            ? "const verifyAgentSkillsAdaptation = (_repoRoot: string): string[] => [];\nconst verifyTaskAgentWorkflowProfiles = (_repoRoot: string): string[] => [];\nfailures.push(...verifyAgentSkillsAdaptation(repoRoot));\nfailures.push(...verifyTaskAgentWorkflowProfiles(repoRoot));\n"
            : implementation === "shadowed-cli-call"
                ? "import {verifyAgentSkillsAdaptation, verifyTaskAgentWorkflowProfiles} from \"#scripts/ci/agent-governance-contract\";\n{\n    const verifyAgentSkillsAdaptation = (_repoRoot: string): string[] => [];\n    const verifyTaskAgentWorkflowProfiles = (_repoRoot: string): string[] => [];\n    failures.push(...verifyAgentSkillsAdaptation(repoRoot));\n    failures.push(...verifyTaskAgentWorkflowProfiles(repoRoot));\n}\n"
                : implementation === "dead-function-cli-call"
                    ? "import {verifyAgentSkillsAdaptation, verifyTaskAgentWorkflowProfiles} from \"#scripts/ci/agent-governance-contract\";\nfunction deadGovernanceChecks(): void {\n    failures.push(...verifyAgentSkillsAdaptation(repoRoot));\n    failures.push(...verifyTaskAgentWorkflowProfiles(repoRoot));\n}\n"
                    : implementation === "type-only-cli-import"
                        ? "import type {verifyAgentSkillsAdaptation, verifyTaskAgentWorkflowProfiles} from \"#scripts/ci/agent-governance-contract\";\nfailures.push(...verifyAgentSkillsAdaptation(repoRoot));\nfailures.push(...verifyTaskAgentWorkflowProfiles(repoRoot));\n"
                        : implementation === "nested-valid-cli-call"
                            ? "import {verifyAgentSkillsAdaptation, verifyTaskAgentWorkflowProfiles} from \"#scripts/ci/agent-governance-contract\";\n{\n    failures.push(...verifyAgentSkillsAdaptation(repoRoot));\n    failures.push(...verifyTaskAgentWorkflowProfiles(repoRoot));\n}\n"
                            : "import {verifyAgentSkillsAdaptation, verifyTaskAgentWorkflowProfiles} from \"#scripts/ci/agent-governance-contract\";\nfailures.push(...verifyAgentSkillsAdaptation(repoRoot));\nfailures.push(...verifyTaskAgentWorkflowProfiles(repoRoot));\n");
    return root;
}

async function createTaskWorkflowFixture(readme: string, taskId = "001-profile"): Promise<string> {
    const root = await createTestTmpRoot("governance-task-workflow", "governance-task-workflow-test");
    fixtureRoots.push(root);
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({
        schema: "nbook.task-ownership/v1",
        ownerRoot: "packages/neuro-book/.agents/tasks",
        taskCount: 0,
        fileCount: 0,
        tasks: [],
    }));
    await writeText(root, `.agents/tasks/${taskId}/README.md`, readme);
    await writeText(root, `.agents/tasks/${taskId}/context.md`, "# Task Context\n");
    return root;
}

async function createApplicationTaskWorkflowFixture(readme: string, taskId: string): Promise<string> {
    const root = await createTestTmpRoot("governance-application-task-workflow", "governance-application-task-workflow-test");
    fixtureRoots.push(root);
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({
        schema: "nbook.task-ownership/v1",
        ownerRoot: "packages/neuro-book/.agents/tasks",
        taskCount: 1,
        fileCount: 1,
        tasks: [{
            taskId,
            ownerRoot: "packages/neuro-book/.agents/tasks",
            files: [{path: `${taskId}/README.md`, legacyDestination: `.agents/tasks/${taskId}/README.md`, sha256: `sha256:${"0".repeat(64)}`}],
        }],
    }));
    await writeText(root, `packages/neuro-book/.agents/tasks/${taskId}/README.md`, readme);
    await writeText(root, `packages/neuro-book/.agents/tasks/${taskId}/context.md`, "# App Task Context\n");
    return root;
}
async function createGovernanceCliFixture(): Promise<string> {
    const root = await createTestTmpRoot("governance-cli", "governance-cli-test");
    fixtureRoots.push(root);
    const governanceFiles: readonly [string, string][] = [
        ["AGENTS.md", "fixture root rules\n"],
        [".omp/RULES.md", "fixture omp rules\n"],
        ["WATCHDOG.md", "fixture watchdog\n"],
        [".agents/AGENTS.md", "fixture agents rules\n"],
        [".agents/README.md", "fixture agents readme\n"],
        [".agents/issues/README.md", "fixture issue draft rules\n"],
        [".agents/tasks/AGENTS.md", "agentWorkflow .agents/skills/load_role/SKILL.md verification.required verification.notRun\n"],
        [".agents/tasks/.migration-complete", "{}\n"],
        [".agents/tasks/legacy-index.json", "{}\n"],
        [".agents/tasks/README.md", "```yaml\nagentWorkflow:\n  profile: nbook.agent-skills/v1\n  kind: bug\n  routes:\n    - diagnosing-bugs\n  verification:\n    required:\n      - focused-test\n    notRun: []\n```\n"],
        [".agents/roles/pm/AGENTS.md", "agentWorkflow required notRun\n"],
        [".agents/roles/leader/AGENTS.md", "agentWorkflow required notRun\n"],
        [".agents/roles/tasker/AGENTS.md", "agentWorkflow required notRun\n"],
        [".agents/roles/reviewer/AGENTS.md", "agentWorkflow required notRun\n"],
        [".agents/skills/README.md", "- [report/SKILL.md](report/SKILL.md)\n- [load_role/SKILL.md](load_role/SKILL.md)\n"],
        [".agents/skills/report/SKILL.md", "---\nname: report\ndescription: Report current state and next action.\nargument-hint: 'Request, file, or decision to report'\n---\n$ARGUMENTS\n当前状态\n下一步\n"],
        [".agents/skills/load_role/SKILL.md", "---\nname: load_role\ndescription: Load one canonical project role contract.\nargument-hint: 'Role: pm | leader | tasker | reviewer'\ndisable-model-invocation: true\n---\n$ARGUMENTS\npm\nleader\ntasker\nreviewer\n.agents/roles/<role>/AGENTS.md\n"],
        ["docs/standards/code/README.md", ".agents/skills/**/*.md writing-for-agents/SKILL.md writing-for-agents/SKILL-MECHANICS.md\n"],
        ["docs/standards/repository-workflow.md", "Issue 条目**是需求交付状态的唯一 owner。PR 合并后 Issue 条目继续保持 `In review`。`Done`：覆盖当前 Issue 批准范围的关联 PR 已全部合并。`Item closed` workflow 应保持关闭。`is:open` 过滤器与本状态机不兼容。当前 merge revision 集合。\n"],
        ["scripts/ci/agent-governance-contract.ts", "export function verifyAgentSkillsAdaptation(repoRoot: string): string[] { return []; }\nexport function verifyTaskAgentWorkflowProfiles(repoRoot: string): string[] { return []; }\n\"notRun\" in verification\n"],
        ["scripts/ci/agent-governance.ts", "import {verifyAgentSkillsAdaptation, verifyTaskAgentWorkflowProfiles} from \"#scripts/ci/agent-governance-contract\";\nfailures.push(...verifyAgentSkillsAdaptation(repoRoot));\nfailures.push(...verifyTaskAgentWorkflowProfiles(repoRoot));\n"],
        ["scripts/AGENTS.md", "fixture scripts rules\n"],
        ["scripts/release/AGENTS.md", "fixture release rules\n"],
        ["packages/AGENTS.md", "fixture packages rules\n"],
        ["packages/neuro-book/AGENTS.md", "共享规则见 ../../AGENTS.md\n"],
        ["packages/neuro-book/package.json", JSON.stringify({name: "@notnotype/neuro-book"})],
        ["package.json", JSON.stringify({name: "fixture", type: "module", scripts: {
            "governance:check": "bun scripts/ci/agent-governance.ts",
            "governance:context": "bun scripts/cli/agent-context.ts",
            "governance:worktree": "bun scripts/cli/create-agent-worktree.ts",
            "governance:migrate-tasks": "bun scripts/maintenance/migrate-agent-tasks.ts",
            "governance:migrate-task-ownership": "bun scripts/maintenance/migrate-task-ownership.ts",
            "test:agent-state-root": "workspace-runtime-root.test.ts agent-workspace-state-root.test.ts",
        }})],
        ["bunfig.toml", "[test]\npathIgnorePatterns = [\n    \".agent/**\",\n    \".agents/**\",\n]\n"],
        [".gitignore", ".env.local\n.agent/\n.worktree/\n"],
    ];
    for (const [relativePath, content] of governanceFiles) await writeText(root, relativePath, content);
    for (const relativePath of [
        "AGENTS.md",
        ".omp/RULES.md",
        "docs/proposals/p-005-development-workflow-governance.md",
        ".agents/issues/README.md",
        "docs/standards/repository-workflow.md",
        "docs/specs/AGENTS.md",
        ".agents/roles/pm/AGENTS.md",
        ".agents/roles/leader/AGENTS.md",
        ".agents/roles/tasker/AGENTS.md",
        ".agents/roles/reviewer/AGENTS.md",
        ".agents/tasks/README.md",
        ".agents/tasks/AGENTS.md",
    ] as const) {
        await writeText(root, relativePath, await readFile(join(repositoryRoot, relativePath), "utf8"));
    }
    await writeText(root, "packages/neuro-book/docs/proposals/agent-skills-adaptation.md", "# Proposal\n\n状态：accepted\n\n`research` `研究问题` `研究产物` 当前Task的精确walkthrough/evidence路径 不得写README、context、Proposal、Spec或业务源码 research/design边界 根/应用/自治包当前schema Task身份\n");
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({
        schema: "nbook.task-ownership/v1",
        ownerRoot: "packages/neuro-book/.agents/tasks",
        taskCount: 0,
        fileCount: 0,
        tasks: [],
    }));
    await writeText(root, ".agents/tasks/001-profile/README.md", `---
schema: nbook.task/v1
taskId: 001-profile
status: planned
createdAt: 2026-08-26T00:00:00Z
updatedAt: 2026-08-26T00:00:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: bug
  routes:
    - diagnosing-bugs
  verification:
    required:
      - focused-test
    notRun: []
---

# CLI profile
`);
    await writeText(root, ".agents/tasks/001-profile/context.md", "# CLI Task Context\n");
    const siblingPath = ".agents/tasks/00149-monorepo-workspace-consolidation/evidences/s8-sibling-resync-resolution.json";
    await writeText(root, siblingPath, await readFile(join(repositoryRoot, siblingPath), "utf8"));

    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "fixture governance"]);
    return root;
}

type GovernanceCliResult = {status: number; report: {failures: string[]}};

async function runGovernanceCli(repoRoot: string): Promise<GovernanceCliResult> {
    try {
        const result = await execFile("bun", [join(repositoryRoot, "scripts/ci/agent-governance.ts"), "--repo-root", repoRoot], {cwd: repositoryRoot, encoding: "utf8"});
        return {status: 0, report: JSON.parse(result.stdout) as {failures: string[]}};
    } catch (error) {
        const result = error as {code?: number | string; stdout?: string; stderr?: string};
        if (result.stdout) {
            return {
                status: typeof result.code === "number" ? result.code : 1,
                report: JSON.parse(result.stdout) as {failures: string[]},
            };
        }
        throw new Error(`治理 CLI 未输出 JSON：${result.stderr ?? ""}`, {cause: error});
    }
}

async function createPackageFixture(options: {runtime: ".agent" | ".local" | ".worktree" | null; autonomous: boolean; trackRuntime?: boolean}): Promise<string> {
    const root = await createTestTmpRoot("governance-package", "governance-package-test");
    fixtureRoots.push(root);
    const packageName = options.autonomous ? "nb-history" : "sample";
    await writeText(root, ".gitignore", "/packages/*/.agent/\n/packages/*/.local/\n/packages/*/.worktree/\n");
    await writeText(root, `packages/${packageName}/package.json`, JSON.stringify({name: options.autonomous ? "@notnotype/nb-history" : "@notnotype/sample", version: "0.0.0"}));
    if (!options.autonomous) {
        await writeText(root, `packages/${packageName}/AGENTS.md`, "共享规则见 ../../AGENTS.md\n");
        await writeText(root, `packages/${packageName}/.agents/tasks/README.md`, "# Tasks\n");
        await writeText(root, `packages/${packageName}/.agents/tasks/one.md`, "taskId: sample-1\n");
        await writeText(root, `packages/${packageName}/docs/README.md`, "# Docs\n");
        await writeText(root, `packages/${packageName}/PROJECT-STATUS.md`, "# Status\n");
    }
    if (options.runtime) await writeText(root, `packages/${packageName}/${options.runtime}/state.json`, "{}\n");
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", ".gitignore", "packages"]);
    if (options.trackRuntime) await runGit(root, ["add", "-f", `packages/${packageName}/${options.runtime}`]);
    await runGit(root, ["commit", "-m", "fixture"]);
    return root;
}

async function createWorktreeFixture(): Promise<{primary: string; linked: string; outside: string}> {
    const primary = await createTestTmpRoot("governance-worktree", "governance-worktree-test");
    fixtureRoots.push(primary);
    await mkdir(join(primary, ".worktree"), {recursive: true});
    const linked = join(primary, ".worktree", "inside");
    const outside = `${primary}-outside`;
    await writeText(primary, "README.md", "fixture\n");
    await runGit(primary, ["init", "--initial-branch", "master"]);
    await runGit(primary, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(primary, ["config", "user.name", "Governance Test"]);
    await runGit(primary, ["add", "README.md"]);
    await runGit(primary, ["commit", "-m", "fixture"]);
    await runGit(primary, ["worktree", "add", "--detach", linked]);
    await runGit(primary, ["worktree", "add", "--detach", outside]);
    return {primary, linked, outside};
}

async function createOwnershipFixture(options: {trackTask: boolean}): Promise<string> {
    const root = await createTestTmpRoot("governance-ownership", "governance-ownership-test");
    fixtureRoots.push(root);
    const taskPath = "packages/neuro-book/.agents/tasks/01-alpha/README.md";
    const taskContent = Buffer.from("---\nschema: nbook.task/v1\ntaskId: 01-alpha\n---\n\n# Alpha\n", "utf8");
    await writeText(root, ".gitignore", ".worktree/\n");
    await mkdir(join(root, "packages/neuro-book/.agents/tasks/01-alpha"), {recursive: true});
    await writeFile(join(root, taskPath), taskContent);
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    const textAttributes = readGitTextAttributes(root, [taskPath]);
    const taskSha = canonicalSha256(taskContent, textAttributes.get(taskPath) ?? "unspecified");
    await writeText(root, ".agents/tasks/ownership.json", `${JSON.stringify({
        schema: "nbook.task-ownership/v1",
        ownerRoot: "packages/neuro-book/.agents/tasks",
        taskCount: 1,
        fileCount: 1,
        tasks: [{taskId: "01-alpha", ownerRoot: "packages/neuro-book/.agents/tasks", files: [{path: "01-alpha/README.md", legacyDestination: ".agents/tasks/01-alpha/README.md", sha256: taskSha}]}],
    }, null, 2)}\n`);
    await runGit(root, ["add", ".gitignore", ".agents/tasks/ownership.json"]);
    if (options.trackTask) await runGit(root, ["add", taskPath]);
    return root;
}

async function writeText(root: string, relativePath: string, content: string): Promise<void> {
    const path = join(root, relativePath);
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, content, "utf8");
}


async function createLocalOnlyMigrationFixture(): Promise<string> {
    const root = await createTestTmpRoot("governance-migration-local-only", "governance-migration-local-only-test");
    fixtureRoots.push(root);
    const destination = ".agents/tasks/01-local/benchmark.json";
    const source = "docs/tasks/01-local/benchmark.json";
    await writeText(root, ".gitattributes", "**/.agents/tasks/** text eol=lf\n");
    await writeText(root, ".gitignore", `${destination}\n`);
    await writeText(root, ".agents/tasks/ownership.json", `${JSON.stringify({
        schema: "nbook.task-ownership/v1",
        ownerRoot: "packages/neuro-book/.agents/tasks",
        taskCount: 0,
        fileCount: 0,
        tasks: [],
    })}\n`);
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "fixture migration baseline"]);
    const sourceRevision = (await runGit(root, ["rev-parse", "HEAD"])).trim();

    const destinationBytes = Buffer.from("benchmark\r\nvalue\r\n", "utf8");
    await mkdir(join(root, ".agents/tasks/01-local"), {recursive: true});
    await writeFile(join(root, destination), destinationBytes);
    const destinationSha256 = hashBytes(Buffer.from("benchmark\nvalue\n", "utf8"));
    const mappings = [{source, destination, sourceSha256: destinationSha256, destinationSha256, kind: "file" as const, linkRewrite: false}];
    const manifest = {schema: "nbook.task-migration-manifest/v1", sourceRevision, mappings, repositoryLinkRewrites: [], preservedSourceFiles: []};
    const manifestSha256 = hashBytes(Buffer.from(JSON.stringify(manifest), "utf8"));
    const index = {schema: "nbook.task-migration-index/v1", sourceRevision, fileCount: 1, manifestSha256, migratedAt: new Date().toISOString(), mappings, repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: 0, localOnlyFiles: [source]};
    const marker = {schema: "nbook.task-migration/v1", sourceRevision, fileCount: 1, manifestSha256, completedAt: new Date().toISOString(), repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: 0, localOnlyFiles: [source]};
    await writeText(root, ".agents/tasks/legacy-index.json", `${JSON.stringify(index)}\n`);
    await writeText(root, ".agents/tasks/.migration-complete", `${JSON.stringify(marker)}\n`);
    return root;
}

function hashBytes(bytes: Uint8Array): string {
    return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
async function runGit(cwd: string, args: string[]): Promise<string> {
    const result = await execFile("git", args, {cwd, encoding: "utf8"});
    return result.stdout;
}
