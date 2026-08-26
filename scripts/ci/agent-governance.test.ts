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
taskId: 00161-profile
issueRequired: false
actionIssueId: null
worktreeId: null
branchId: master
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
        const profilePath = ".agents/tasks/00161-profile/README.md";
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
taskId: 00161-profile
issueRequired: false
actionIssueId: null
worktreeId: null
branchId: master
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

    it("agent-context 拒绝数值为零的 Task 标识", async () => {
        const result = await runAgentContextCli("00-invalid");

        expect(result.status).not.toBe(0);
        expect(result.failures).toContain("Task 标识格式无效：00-invalid");
    });
    it.each(["99-new", "00151-new"])("agent-context 拒绝伪历史或非法过渡 Task %s", async (taskId) => {
        const repoRoot = await createForgedHistoricalIdentityFixture(taskId);
        const result = await runAgentContextCli(taskId, repoRoot);

        expect(result.status).not.toBe(0);
        expect(result.failures).toContain(`Task 标识无效：${taskId}`);
    });





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
taskId: 00161-profile
issueRequired: false
actionIssueId: null
worktreeId: null
branchId: master
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
taskId: 00161-profile
issueRequired: false
actionIssueId: null
worktreeId: null
branchId: master
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
        await rm(join(repoRoot, ".agents/tasks/00161-profile/context.md"));

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toContain("Task 缺少 context.md：.agents/tasks/00161-profile/README.md");
    });

    it("合法 design Task 必须声明设计边界与 API 路由", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 00161-profile
issueRequired: false
actionIssueId: null
worktreeId: null
branchId: master
status: draft
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

    it("design Task 缺少设计边界或 API 路由时失败", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 00161-profile
issueRequired: false
actionIssueId: null
worktreeId: null
branchId: master
status: draft
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

    it("根 Task 拒绝非法 ID 形状且高序号不能伪装历史", async () => {
        const invalidId = "100000-invalid";
        const invalidRoot = await createTaskWorkflowFixture("# Invalid root Task\n", invalidId);
        expect(verifyTaskAgentWorkflowProfiles(invalidRoot)).toContain(`根 Task 标识无效：${invalidId}`);

        const highShortId = "999-current";
        const highShortRoot = await createTaskWorkflowFixture("# High short root Task\n", highShortId);
        expect(verifyTaskAgentWorkflowProfiles(highShortRoot)).toContain(`根 Task 标识无效：${highShortId}`);
    });

    it("根 Task 拒绝零编号和未登记的低编号历史伪装", async () => {
        for (const taskId of ["00-invalid", "000-invalid", "00000-invalid", "99-new", "148-new", "00149-other", "00150-other", "00151-new"] as const) {
            const repoRoot = await createTaskWorkflowFixture("# Invalid historical identity\n", taskId);
            expect(verifyTaskAgentWorkflowProfiles(repoRoot), taskId).toContain(`根 Task 标识无效：${taskId}`);
        }
    });

    it("低编号历史身份必须同时命中 sourceRevision 基线和迁移 mapping", async () => {
        const validRoot = await createHistoricalTaskWorkflowFixture("99-legacy", "valid");
        expect(verifyTaskAgentWorkflowProfiles(validRoot)).not.toContain("根 Task 标识无效：99-legacy");

        for (const mode of ["missing-baseline", "missing-mapping"] as const) {
            const invalidRoot = await createHistoricalTaskWorkflowFixture("99-legacy", mode);
            expect(verifyTaskAgentWorkflowProfiles(invalidRoot), mode).toContain("根 Task 标识无效：99-legacy");
        }
    });
    it("历史身份在 index 与 marker 密封值不一致时 fail closed", async () => {
        const repoRoot = await createHistoricalTaskWorkflowFixture("99-legacy", "mismatched-marker");

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toEqual(expect.arrayContaining([
            "历史 Task 迁移 index/marker 不一致",
            "根 Task 标识无效：99-legacy",
        ]));
    });


    it("后续可达 commit 和工作树 mapping 不能伪造历史身份", async () => {
        const repoRoot = await createForgedHistoricalIdentityFixture("99-new");

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toContain("根 Task 标识无效：99-new");
    });
    it("当前迁移 metadata 含畸形 mapping 时 fail closed", async () => {
        const repoRoot = await createHistoricalTaskWorkflowFixture("99-legacy", "valid");
        const indexPath = join(repoRoot, ".agents/tasks/legacy-index.json");
        const index = JSON.parse(await readFile(indexPath, "utf8")) as {mappings: unknown[]};
        index.mappings = [null];
        await writeFile(indexPath, JSON.stringify(index));

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toContain("当前历史 Task 迁移 mapping 结构无效");
    });
    it("密封迁移快照含畸形 mapping 时 fail closed", async () => {
        const repoRoot = await createMalformedSealedMappingFixture();

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toContain("历史 Task 迁移密封 mapping 结构无效");
    });



    it("根当前 Task 的 issueRequired 与 actionIssueId 必须成对", async () => {
        for (const [issueRequired, actionIssueId] of [[true, "null"], [false, "191"]] as const) {
            const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 00161-profile
issueRequired: ${String(issueRequired)}
actionIssueId: ${actionIssueId}
worktreeId: null
branchId: master
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

# Invalid Issue Contract
`);
            expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toContain("根 Task issueRequired 与 actionIssueId 不匹配：.agents/tasks/00161-profile/README.md");
        }
    });

    it("应用当前 Task 由 owner 强制关联正整数 Issue", async () => {
        const taskId = "149-profile";
        const repoRoot = await createApplicationTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: ${taskId}
issueRequired: false
actionIssueId: null
worktreeId: null
branchId: master
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

# Invalid App Issue Contract
`, taskId);

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toContain(`应用 Task 必须声明 issueRequired: true 和正整数 actionIssueId：packages/neuro-book/.agents/tasks/${taskId}/README.md`);
    });

    it("当前 Task 必须显式声明有效执行身份", async () => {
        const taskId = "00161-profile";
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: ${taskId}
issueRequired: false
actionIssueId: null
worktreeId: ""
branchId: 42
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

# Invalid execution identity Task
`, taskId);
        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("Task worktreeId 必须是非空字符串或 null"),
            expect.stringContaining("Task branchId 必须是非空字符串或 null"),
        ]));

        const missingRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: ${taskId}
issueRequired: false
actionIssueId: null
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

# Missing execution identity Task
`, taskId);
        expect(verifyTaskAgentWorkflowProfiles(missingRoot)).toEqual(expect.arrayContaining([
            expect.stringContaining("Task worktreeId 必须是非空字符串或 null"),
            expect.stringContaining("Task branchId 必须是非空字符串或 null"),
        ]));
    });

    it("新 Task 拒绝非法 Issue 聚合字段和 parentTaskId", async () => {
        const taskId = "00161-profile";
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: ${taskId}
issueRequired: false
actionIssueId:
  - 191
parentTaskId: 00160-parent
worktreeId: null
branchId: master
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
            expect.stringContaining("根 Task issueRequired 与 actionIssueId 不匹配"),
            expect.stringContaining("Task 禁止聚合字段 parentTaskId"),
        ]));
    });

    it("design Task 拒绝多目标和业务源码允许路径", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 00161-profile
issueRequired: false
actionIssueId: null
worktreeId: null
branchId: master
status: draft
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

    it("design Task 拒绝可穿越到允许根外的设计产物", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 00161-profile
issueRequired: false
actionIssueId: null
worktreeId: null
branchId: master
status: draft
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

安全模型

## 设计产物

- docs/specs/../../AGENTS.md

## 决策范围

- 安全边界。

## 允许文件

- docs/specs/../../AGENTS.md
`);

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toContain("design Task 必须有唯一 Proposal/Spec 设计产物：.agents/tasks/00161-profile/README.md");
    });

    it("基线 Design Task 不能通过改 kind 绕过真实 diff", async () => {
        const repoRoot = await createDesignDiffFixture("bug");
        const failures = verifyTaskAgentWorkflowProfiles(repoRoot);
        expect(failures).toContain("design Task 基线身份漂移：.agents/tasks/00161-design/README.md");
        expect(failures).toContain("design Task diff 越界：.agents/tasks/00161-design/README.md -> packages/neuro-book/app/api.ts");
    });

    it.each(["completed", "abandoned", "removed-baseline"] as const)("基线 Design Task 不能通过 %s 绕过真实 diff", async (mutation) => {
        const repoRoot = await createDesignDiffFixture(mutation);
        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toContain("design Task diff 越界：.agents/tasks/00161-design/README.md -> packages/neuro-book/app/api.ts");
    });
    it.each([
        "docs/specs/../../AGENTS.md",
        "packages/neuro-book/docs/specs/../../../app/api.md",
        "docs\\specs\\example.md",
        "C:/repo/docs/specs/example.md",
        "/docs/specs/example.md",
        "docs/specs/./example.md",
    ])("design Task 拒绝不安全产物路径 %s", async (output) => {
        const repoRoot = await createTaskWorkflowFixture(designTaskReadme({output, status: "draft"}));

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toContain("design Task 必须有唯一 Proposal/Spec 设计产物：.agents/tasks/00161-profile/README.md");
    });

    it("design Task 接受开放单行类型和包级设计产物", async () => {
        const repoRoot = await createTaskWorkflowFixture(designTaskReadme({
            designType: "安全模型",
            output: "packages/neuro-book/docs/proposals/safety-model.md",
            status: "draft",
        }));

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toEqual([]);
    });

    it.each(["", "安全模型\n流程编排", "- 安全模型\n- 流程编排"])("design Task 拒绝空或多行类型", async (designType) => {
        const repoRoot = await createTaskWorkflowFixture(designTaskReadme({designType, status: "draft"}));

        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toContain("design Task 设计类型无效：.agents/tasks/00161-profile/README.md");
    });

    it.each(["missing", "short", "multiple", "unreachable"] as const)("活跃 Design Task 拒绝 %s 基线", async (contextMode) => {
        const {root} = await createDesignGateFixture({contextMode});

        expect(verifyTaskAgentWorkflowProfiles(root)).toEqual(expect.arrayContaining([
            expect.stringMatching(/design Task (?:密封合同缺少唯一基线 revision|基线不可达)/u),
        ]));
    });

    it.each(["committed", "staged", "unstaged", "untracked", "delete", "rename"] as const)("Design 真实 diff 拒绝 %s 越界路径", async (changeMode) => {
        const fixture = await createDesignGateFixture();
        const expectedPaths = await applyDesignBoundaryChange(fixture, changeMode);
        const failures = verifyTaskAgentWorkflowProfiles(fixture.root);

        for (const path of expectedPaths) expect(failures, changeMode).toContain(`design Task diff 越界：${fixture.readmePath} -> ${path}`);
    });

    it.each(["branch", "worktree", "head-ref"] as const)("Design diff 通过 %s 身份匹配", async (identityMode) => {
        const fixture = await createDesignGateFixture({identityMode});
        await writeText(fixture.root, fixture.boundaryPath, "export const changed = true;\n");
        const previousHeadRef = process.env.GITHUB_HEAD_REF;
        if (identityMode === "head-ref") process.env.GITHUB_HEAD_REF = "feature/design";
        try {
            expect(verifyTaskAgentWorkflowProfiles(fixture.root)).toContain(`design Task diff 越界：${fixture.readmePath} -> ${fixture.boundaryPath}`);
        } finally {
            if (previousHeadRef === undefined) delete process.env.GITHUB_HEAD_REF;
            else process.env.GITHUB_HEAD_REF = previousHeadRef;
        }
    });

    it("同一 checkout 命中多个活跃 Design Task 时失败", async () => {
        const {root} = await createDesignGateFixture({secondTask: true});

        expect(verifyTaskAgentWorkflowProfiles(root)).toEqual(expect.arrayContaining([
            expect.stringContaining("当前 checkout 命中多个活跃 Design Task"),
        ]));
    });

    it("Design diff 允许产物和直属报告但拒绝 Task 杂散与嵌套报告", async () => {
        const fixture = await createDesignGateFixture();
        await writeText(fixture.root, fixture.outputPath, "# Design output\n");
        await writeText(fixture.root, ".agents/tasks/00161-design/walkthroughs/001.md", "# Walkthrough\n");
        await writeText(fixture.root, ".agents/tasks/00161-design/evidences/proof.txt", "proof\n");
        expect(verifyTaskAgentWorkflowProfiles(fixture.root)).toEqual([]);

        await writeText(fixture.root, ".agents/tasks/00161-design/notes.md", "# Notes\n");
        await writeText(fixture.root, ".agents/tasks/00161-design/walkthroughs/nested/002.md", "# Nested\n");
        expect(verifyTaskAgentWorkflowProfiles(fixture.root)).toEqual(expect.arrayContaining([
            `design Task diff 越界：${fixture.readmePath} -> .agents/tasks/00161-design/notes.md`,
            `design Task diff 越界：${fixture.readmePath} -> .agents/tasks/00161-design/walkthroughs/nested/002.md`,
        ]));
    });

    it.each(["completed", "abandoned"] as const)("已提交 %s 终止 Design diff 窗口", async (endStatus) => {
        const fixture = await createDesignGateFixture({endStatus});
        await writeText(fixture.root, fixture.boundaryPath, "export const afterEnd = true;\n");

        expect(verifyTaskAgentWorkflowProfiles(fixture.root)).not.toContain(`design Task diff 越界：${fixture.readmePath} -> ${fixture.boundaryPath}`);
    });


    it("多个已结束 Design 窗口可独立验证", async () => {
        const fixture = await createDesignGateFixture({secondTask: true, endStatus: "completed", secondEndStatus: "completed"});

        expect(verifyTaskAgentWorkflowProfiles(fixture.root)).not.toEqual(expect.arrayContaining([
            expect.stringContaining("当前 checkout 命中多个活跃 Design Task"),
        ]));
    });
    it("Design Task 已提交退出后禁止重开", async () => {
        const fixture = await createDesignGateFixture({endStatus: "completed", reopenStatus: "verifying"});

        expect(verifyTaskAgentWorkflowProfiles(fixture.root)).toContain(`design Task 已结束后重新激活：${fixture.readmePath}`);
    });

    it("Design 基线必须是密封合同的严格祖先", async () => {
        const fixture = await createDesignGateFixture({baselineMode: "unrelated"});

        expect(verifyTaskAgentWorkflowProfiles(fixture.root)).toEqual(expect.arrayContaining([
            expect.stringContaining("design Task 基线不是密封合同的严格祖先"),
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
issueRequired: false
actionIssueId: 0
actionIssueIds:
  - 191
worktreeId: null
branchId: master
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
            expect.stringContaining("应用 Task 必须声明 issueRequired: true 和正整数 actionIssueId"),
            expect.stringContaining("Task 禁止聚合字段 actionIssueIds"),
        ]));
        await rm(join(repoRoot, relativePath));
        expect(verifyTaskAgentWorkflowProfiles(repoRoot)).toContain(`新 Task 缺少 README.md：${relativePath}`);
    });

    it("应用低号 Task 必须命中不可变基线、mapping 和 ownership", async () => {
        const valid = await createHistoricalApplicationTaskFixture("148-legacy", "valid", "---\nschema: wrong.task/v1\ntaskId: 148-legacy\n---\n\n# Historical app Task\n");
        const validPath = "packages/neuro-book/.agents/tasks/148-legacy/README.md";
        expect(verifyTaskAgentWorkflowProfiles(valid)).not.toContain("应用 Task 标识无效：148-legacy");
        expect(verifyTaskAgentWorkflowProfiles(valid)).not.toContain(`新 Task 缺少有效 nbook.task/v1 frontmatter：${validPath}`);

        for (const mode of ["missing-baseline", "missing-mapping"] as const) {
            const invalid = await createHistoricalApplicationTaskFixture("148-legacy", mode, "# Invalid historical app Task\n");
            expect(verifyTaskAgentWorkflowProfiles(invalid), mode).toContain("应用 Task 标识无效：148-legacy");
        }
        const mismatchedOwnership = await createHistoricalApplicationTaskFixture("148-legacy", "mismatched-ownership", "# Invalid historical app Task\n");
        expect(verifyTaskAgentWorkflowProfiles(mismatchedOwnership)).toContain("ownership legacyDestination 不匹配：148-legacy/README.md");

        for (const taskId of ["149-current", "999-current"] as const) {
            const repoRoot = await createApplicationTaskWorkflowFixture(`---
schema: wrong.task/v1
taskId: ${taskId}
---

# Current app Task
`, taskId);
            const relativePath = `packages/neuro-book/.agents/tasks/${taskId}/README.md`;
            expect(verifyTaskAgentWorkflowProfiles(repoRoot), taskId).toContain(`新 Task 缺少有效 nbook.task/v1 frontmatter：${relativePath}`);
        }
    }, 30_000);

    it("应用历史 Task 不补当前字段但仍守 v1 基础不变量", async () => {
        const taskId = "148-legacy";
        const repoRoot = await createHistoricalApplicationTaskFixture(taskId, "valid", `---
schema: nbook.task/v1
taskId: ${taskId}
status: unknown
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

# Historical v1 Task
`);
        const failures = verifyTaskAgentWorkflowProfiles(repoRoot);
        expect(failures).toContain(`Task status 无效：packages/neuro-book/.agents/tasks/${taskId}/README.md`);
        expect(failures).not.toContain(`应用 Task 标识无效：${taskId}`);
        expect(failures).not.toEqual(expect.arrayContaining([
            expect.stringContaining("Task actionIssueId 必须是正整数或 null"),
            expect.stringContaining("Task worktreeId 必须是非空字符串或 null"),
            expect.stringContaining("Task branchId 必须是非空字符串或 null"),
        ]));
    });

    it("应用 Task ownership 拒绝零值、一位和六位数字 ID", async () => {
        for (const taskId of ["00-invalid", "000-invalid", "00000-invalid", "9-invalid", "100000-invalid"] as const) {
            const repoRoot = await createApplicationTaskWorkflowFixture("# Invalid app Task\n", taskId);
            expect(verifyTaskAgentWorkflowProfiles(repoRoot), taskId).toContain(`ownership Task 标识无效：${taskId}`);
        }
    });
    it("agentWorkflow 枚举拒绝原型链属性", async () => {
        const repoRoot = await createTaskWorkflowFixture(`---
schema: nbook.task/v1
taskId: 00161-profile
issueRequired: false
actionIssueId: null
worktreeId: null
branchId: master
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
taskId: 00161-profile
issueRequired: false
actionIssueId: null
worktreeId: null
branchId: master
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
taskId: 00161-profile
issueRequired: false
actionIssueId: null
worktreeId: null
branchId: master
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
            ".agents/tasks/00160-leader-driven-development-workflow/README.md",
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
            "取得 Issue 编号后直接创建 planned Task。",
            "Tasker 只能处理 planned Task。",
            "未获浏览器人工验收授权可以放入 notRun。",
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
    await writeText(root, "packages/neuro-book/docs/proposals/agent-skills-adaptation.md", `# Proposal\n\n状态：${status}\n`);
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

async function createTaskWorkflowFixture(readme: string, taskId = "00161-profile"): Promise<string> {
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

async function createHistoricalTaskWorkflowFixture(taskId: string, mode: "valid" | "missing-baseline" | "missing-mapping" | "mismatched-marker"): Promise<string> {
    const root = await createTestTmpRoot("governance-historical-task", "governance-historical-task-test");
    fixtureRoots.push(root);
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({
        schema: "nbook.task-ownership/v1",
        ownerRoot: "packages/neuro-book/.agents/tasks",
        taskCount: 0,
        fileCount: 0,
        tasks: [],
    }));
    if (mode !== "missing-baseline") await writeText(root, `docs/tasks/${taskId}/README.md`, "# Historical source\n");
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "historical source baseline"]);
    const sourceRevision = (await runGit(root, ["rev-parse", "HEAD"])).trim();
    const mappings = mode === "missing-mapping" ? [] : [{
        source: `docs/tasks/${taskId}/README.md`,
        destination: `.agents/tasks/${taskId}/README.md`,
        sourceSha256: `sha256:${"0".repeat(64)}`,
        destinationSha256: `sha256:${"0".repeat(64)}`,
        kind: "file" as const,
        linkRewrite: false,
    }];
    const manifest = {schema: "nbook.task-migration-manifest/v1", sourceRevision, mappings, repositoryLinkRewrites: [], preservedSourceFiles: []};
    const manifestSha256 = hashBytes(Buffer.from(JSON.stringify(manifest), "utf8"));
    await writeText(root, ".agents/tasks/legacy-index.json", JSON.stringify({schema: "nbook.task-migration-index/v1", sourceRevision, fileCount: mappings.length, manifestSha256, migratedAt: "2026-08-26T00:00:00Z", mappings, repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: 0, localOnlyFiles: []}));
    await writeText(root, ".agents/tasks/.migration-complete", JSON.stringify({schema: "nbook.task-migration/v1", sourceRevision, fileCount: mappings.length, manifestSha256: mode === "mismatched-marker" ? `sha256:${"f".repeat(64)}` : manifestSha256, completedAt: "2026-08-26T00:00:00Z", repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: 0, localOnlyFiles: []}));
    await runGit(root, ["add", ".agents/tasks/legacy-index.json", ".agents/tasks/.migration-complete"]);
    await runGit(root, ["commit", "-m", "seal historical migration identity"]);
    await writeText(root, `.agents/tasks/${taskId}/README.md`, `---
schema: nbook.task/v1
taskId: ${taskId}
status: completed
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

# Historical Task
`);
    await writeText(root, `.agents/tasks/${taskId}/context.md`, "# Historical Context\n");
    return root;
}

type HistoricalMappingFixture = {
    source: string;
    destination: string;
    sourceSha256: string;
    destinationSha256: string;
    kind: "file";
    linkRewrite: false;
};

function historicalMapping(taskId: string): HistoricalMappingFixture {
    return {
        source: `docs/tasks/${taskId}/README.md`,
        destination: `.agents/tasks/${taskId}/README.md`,
        sourceSha256: `sha256:${"0".repeat(64)}`,
        destinationSha256: `sha256:${"0".repeat(64)}`,
        kind: "file",
        linkRewrite: false,
    };
}

async function writeHistoricalMigrationMetadata(root: string, sourceRevision: string, mappings: HistoricalMappingFixture[]): Promise<void> {
    const manifest = {schema: "nbook.task-migration-manifest/v1", sourceRevision, mappings, repositoryLinkRewrites: [], preservedSourceFiles: []};
    const manifestSha256 = hashBytes(Buffer.from(JSON.stringify(manifest), "utf8"));
    await writeText(root, ".agents/tasks/legacy-index.json", JSON.stringify({schema: "nbook.task-migration-index/v1", sourceRevision, fileCount: mappings.length, manifestSha256, migratedAt: "2026-08-26T00:00:00Z", mappings, repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: mappings.length, localOnlyFiles: []}));
    await writeText(root, ".agents/tasks/.migration-complete", JSON.stringify({schema: "nbook.task-migration/v1", sourceRevision, fileCount: mappings.length, manifestSha256, completedAt: "2026-08-26T00:00:00Z", repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: mappings.length, localOnlyFiles: []}));
}

async function createMalformedSealedMappingFixture(): Promise<string> {
    const root = await createTestTmpRoot("governance-malformed-sealed-mapping", "governance-malformed-sealed-mapping-test");
    fixtureRoots.push(root);
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({schema: "nbook.task-ownership/v1", ownerRoot: "packages/neuro-book/.agents/tasks", taskCount: 0, fileCount: 0, tasks: []}));
    await writeText(root, "docs/tasks/99-malformed/README.md", "# Historical source\n");
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "historical source"]);
    const sourceRevision = (await runGit(root, ["rev-parse", "HEAD"])).trim();
    const mappings = [null];
    const manifest = {schema: "nbook.task-migration-manifest/v1", sourceRevision, mappings, repositoryLinkRewrites: [], preservedSourceFiles: []};
    const manifestSha256 = hashBytes(Buffer.from(JSON.stringify(manifest), "utf8"));
    await writeText(root, ".agents/tasks/legacy-index.json", JSON.stringify({schema: "nbook.task-migration-index/v1", sourceRevision, fileCount: 1, manifestSha256, migratedAt: "2026-08-26T00:00:00Z", mappings, repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: 1, localOnlyFiles: []}));
    await writeText(root, ".agents/tasks/.migration-complete", JSON.stringify({schema: "nbook.task-migration/v1", sourceRevision, fileCount: 1, manifestSha256, completedAt: "2026-08-26T00:00:00Z", repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: 1, localOnlyFiles: []}));
    await runGit(root, ["add", ".agents/tasks/legacy-index.json", ".agents/tasks/.migration-complete"]);
    await runGit(root, ["commit", "-m", "seal malformed migration"]);
    await writeText(root, ".agents/tasks/99-malformed/README.md", "# Malformed historical Task\n");
    await writeText(root, ".agents/tasks/99-malformed/context.md", "# Context\n");
    return root;
}

async function createForgedHistoricalIdentityFixture(taskId: string): Promise<string> {
    const root = await createTestTmpRoot("governance-forged-historical-task", "governance-forged-historical-task-test");
    fixtureRoots.push(root);
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({schema: "nbook.task-ownership/v1", ownerRoot: "packages/neuro-book/.agents/tasks", taskCount: 0, fileCount: 0, tasks: []}));
    await writeText(root, "docs/tasks/98-sealed/README.md", "# Sealed historical source\n");
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "sealed migration source"]);
    const sealedSourceRevision = (await runGit(root, ["rev-parse", "HEAD"])).trim();
    const sealedMappings = [historicalMapping("98-sealed")];
    await writeHistoricalMigrationMetadata(root, sealedSourceRevision, sealedMappings);
    await runGit(root, ["add", ".agents/tasks/legacy-index.json", ".agents/tasks/.migration-complete"]);
    await runGit(root, ["commit", "-m", "seal migration identity"]);

    await writeText(root, `docs/tasks/${taskId}/README.md`, "# Forged historical source\n");
    await runGit(root, ["add", `docs/tasks/${taskId}/README.md`]);
    await runGit(root, ["commit", "-m", "add forged reachable source"]);
    const forgedSourceRevision = (await runGit(root, ["rev-parse", "HEAD"])).trim();
    await writeHistoricalMigrationMetadata(root, forgedSourceRevision, [...sealedMappings, historicalMapping(taskId)]);
    await writeText(root, `.agents/tasks/${taskId}/README.md`, `---\nschema: nbook.task/v1\ntaskId: ${taskId}\nstatus: completed\ncreatedAt: 2026-08-26T00:00:00Z\nupdatedAt: 2026-08-26T00:00:00Z\nagentWorkflow:\n  profile: nbook.agent-skills/v1\n  kind: docs\n  routes:\n    - documentation-and-adrs\n  verification:\n    required:\n      - docs-check\n    notRun: []\n---\n\n# Forged Task\n`);
    await writeText(root, `.agents/tasks/${taskId}/context.md`, "# Forged context\n");
    return root;
}

async function createDesignDiffFixture(mutation: "bug" | "completed" | "abandoned" | "removed-baseline"): Promise<string> {
    const root = await createTestTmpRoot("governance-design-diff", "governance-design-diff-test");
    fixtureRoots.push(root);
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({
        schema: "nbook.task-ownership/v1",
        ownerRoot: "packages/neuro-book/.agents/tasks",
        taskCount: 0,
        fileCount: 0,
        tasks: [],
    }));
    await writeText(root, "README.md", "# Design fixture\n");
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "repository baseline"]);
    const baseline = (await runGit(root, ["rev-parse", "HEAD"])).trim();
    const baselineReadme = `---
schema: nbook.task/v1
taskId: 00161-design
issueRequired: false
actionIssueId: null
worktreeId: null
branchId: master
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

# Workflow Design Task

## 设计类型

流程编排

## 设计产物

- docs/specs/example/design.md

## 决策范围

- 流程边界。

## 允许文件

- docs/specs/example/design.md
`;
    await writeText(root, ".agents/tasks/00161-design/README.md", baselineReadme);
    await writeText(root, ".agents/tasks/00161-design/context.md", `# Design Context\n\n- 基线 revision：\`${baseline}\`\n`);
    await runGit(root, ["add", ".agents/tasks/00161-design"]);
    await runGit(root, ["commit", "-m", "design task contract"]);
    const mutatedReadme = mutation === "bug"
        ? baselineReadme.replace("kind: design", "kind: bug")
        : baselineReadme.replace("status: planned", `status: ${mutation}`);
    if (mutation !== "removed-baseline") await writeText(root, ".agents/tasks/00161-design/README.md", mutatedReadme);
    else await writeText(root, ".agents/tasks/00161-design/context.md", "# Design Context\n");
    await writeText(root, "packages/neuro-book/app/api.ts", "export const leaked = true;\n");
    return root;
}

function designTaskReadme(options: {
    taskId?: string;
    designType?: string;
    output?: string;
    status?: "draft" | "planned" | "in-progress" | "blocked" | "verifying" | "completed" | "abandoned";
    worktreeId?: string | null;
    branchId?: string | null;
} = {}): string {
    const taskId = options.taskId ?? "00161-profile";
    const designType = options.designType ?? "流程编排";
    const output = options.output ?? "docs/specs/example/design.md";
    const status = options.status ?? "planned";
    const worktreeId = options.worktreeId === undefined ? "null" : options.worktreeId === null ? "null" : JSON.stringify(options.worktreeId);
    const branchId = options.branchId === undefined ? "master" : options.branchId === null ? "null" : JSON.stringify(options.branchId);
    return `---
schema: nbook.task/v1
taskId: ${taskId}
issueRequired: false
actionIssueId: null
worktreeId: ${worktreeId}
branchId: ${branchId}
status: ${status}
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

# Workflow Design Task

## 设计类型

${designType}

## 设计产物

- ${output}

## 决策范围

- 流程边界。

## 允许文件

- ${output}
`;
}

type DesignGateFixture = {
    root: string;
    readmePath: string;
    outputPath: string;
    boundaryPath: string;
};

async function createDesignGateFixture(options: {
    contextMode?: "valid" | "missing" | "short" | "multiple" | "unreachable";
    identityMode?: "branch" | "worktree" | "head-ref";
    baselineMode?: "ancestor" | "unrelated";
    secondTask?: boolean;
    endStatus?: "completed" | "abandoned";
    secondEndStatus?: "completed" | "abandoned";
    reopenStatus?: "planned" | "in-progress" | "blocked" | "verifying";
} = {}): Promise<DesignGateFixture> {
    const root = await createTestTmpRoot("governance-design-gate", "governance-design-gate-test");
    fixtureRoots.push(root);
    const readmePath = ".agents/tasks/00161-design/README.md";
    const outputPath = "docs/specs/example/design.md";
    const boundaryPath = "packages/neuro-book/app/api.ts";
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({
        schema: "nbook.task-ownership/v1",
        ownerRoot: "packages/neuro-book/.agents/tasks",
        taskCount: 0,
        fileCount: 0,
        tasks: [],
    }));
    await writeText(root, "README.md", "# Design gate fixture\n");
    await writeText(root, boundaryPath, "export const baseline = true;\n");
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "repository baseline"]);
    const baseline = (await runGit(root, ["rev-parse", "HEAD"])).trim();
    const unrelatedBaseline = options.baselineMode === "unrelated"
        ? (await runGit(root, ["commit-tree", `${baseline}^{tree}`, "-m", "unrelated baseline"])).trim()
        : null;
    const identityMode = options.identityMode ?? "branch";
    const worktreeId = identityMode === "worktree" ? "." : null;
    const branchId = identityMode === "head-ref" ? "feature/design" : identityMode === "branch" ? "master" : null;
    const contextMode = options.contextMode ?? "valid";
    const baselineLines = contextMode === "missing"
        ? ""
        : contextMode === "short"
            ? "- 基线 revision：`abc1234`\n"
            : contextMode === "multiple"
                ? `- 基线 revision：\`${baseline}\`\n- baseline revision: \`${baseline}\`\n`
                : contextMode === "unreachable"
                    ? `- 基线 revision：\`${"f".repeat(40)}\`\n`
                    : `- 基线 revision：\`${unrelatedBaseline ?? baseline}\`\n`;
    await writeText(root, readmePath, designTaskReadme({taskId: "00161-design", output: outputPath, worktreeId, branchId}));
    await writeText(root, ".agents/tasks/00161-design/context.md", `# Design Context\n\n${baselineLines}`);
    if (options.secondTask) {
        await writeText(root, ".agents/tasks/00162-design/README.md", designTaskReadme({taskId: "00162-design", output: "docs/specs/example/second.md", worktreeId, branchId}));
        await writeText(root, ".agents/tasks/00162-design/context.md", `# Design Context\n\n- 基线 revision：\`${baseline}\`\n`);
    }
    await runGit(root, ["add", ".agents/tasks"]);
    await runGit(root, ["commit", "-m", "seal design task contract"]);
    if (options.endStatus) {
        const ended = designTaskReadme({taskId: "00161-design", output: outputPath, status: options.endStatus, worktreeId, branchId});
        await writeText(root, readmePath, ended);
        await runGit(root, ["add", readmePath]);
        await runGit(root, ["commit", "-m", `end design task as ${options.endStatus}`]);
    }
    if (options.reopenStatus) {
        const reopened = designTaskReadme({taskId: "00161-design", output: outputPath, status: options.reopenStatus, worktreeId, branchId});
        await writeText(root, readmePath, reopened);
        await runGit(root, ["add", readmePath]);
        await runGit(root, ["commit", "-m", `reopen design task as ${options.reopenStatus}`]);
    }
    if (options.secondEndStatus) {
        const ended = designTaskReadme({taskId: "00162-design", output: "docs/specs/example/second.md", status: options.secondEndStatus, worktreeId, branchId});
        await writeText(root, ".agents/tasks/00162-design/README.md", ended);
        await runGit(root, ["add", ".agents/tasks/00162-design/README.md"]);
        await runGit(root, ["commit", "-m", `end second design task as ${options.secondEndStatus}`]);
    }
    return {root, readmePath, outputPath, boundaryPath};
}

async function applyDesignBoundaryChange(fixture: DesignGateFixture, mode: "committed" | "staged" | "unstaged" | "untracked" | "delete" | "rename"): Promise<string[]> {
    if (mode === "untracked") {
        const path = "packages/neuro-book/app/untracked.ts";
        await writeText(fixture.root, path, "export const untracked = true;\n");
        return [path];
    }
    if (mode === "delete") {
        await rm(join(fixture.root, fixture.boundaryPath));
        return [fixture.boundaryPath];
    }
    if (mode === "rename") {
        const renamed = "packages/neuro-book/app/renamed.ts";
        await runGit(fixture.root, ["mv", fixture.boundaryPath, renamed]);
        return [fixture.boundaryPath, renamed];
    }
    await writeText(fixture.root, fixture.boundaryPath, `export const mode = "${mode}";\n`);
    if (mode === "staged" || mode === "committed") await runGit(fixture.root, ["add", fixture.boundaryPath]);
    if (mode === "committed") await runGit(fixture.root, ["commit", "-m", "commit boundary change"]);
    return [fixture.boundaryPath];
}

async function createHistoricalApplicationTaskFixture(
    taskId: string,
    mode: "valid" | "missing-baseline" | "missing-mapping" | "mismatched-ownership",
    readme: string,
): Promise<string> {
    const root = await createTestTmpRoot("governance-historical-application-task", "governance-historical-application-task-test");
    fixtureRoots.push(root);
    const source = `docs/tasks/${taskId}/README.md`;
    const destination = `.agents/tasks/${taskId}/README.md`;
    if (mode !== "missing-baseline") await writeText(root, source, "# Historical source\n");
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "historical application source baseline"]);
    const sourceRevision = (await runGit(root, ["rev-parse", "HEAD"])).trim();
    const mappings = mode === "missing-mapping" ? [] : [{
        source,
        destination,
        sourceSha256: `sha256:${"0".repeat(64)}`,
        destinationSha256: `sha256:${"0".repeat(64)}`,
        kind: "file" as const,
        linkRewrite: false,
    }];
    const manifest = {schema: "nbook.task-migration-manifest/v1", sourceRevision, mappings, repositoryLinkRewrites: [], preservedSourceFiles: []};
    const manifestSha256 = hashBytes(Buffer.from(JSON.stringify(manifest), "utf8"));
    await writeText(root, ".agents/tasks/legacy-index.json", JSON.stringify({schema: "nbook.task-migration-index/v1", sourceRevision, fileCount: mappings.length, manifestSha256, migratedAt: "2026-08-26T00:00:00Z", mappings, repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: 0, localOnlyFiles: []}));
    await writeText(root, ".agents/tasks/.migration-complete", JSON.stringify({schema: "nbook.task-migration/v1", sourceRevision, fileCount: mappings.length, manifestSha256, completedAt: "2026-08-26T00:00:00Z", repositoryLinkRewrites: [], preservedSourceFiles: [], trackedFileCount: 0, localOnlyFiles: []}));
    await runGit(root, ["add", ".agents/tasks/legacy-index.json", ".agents/tasks/.migration-complete"]);
    await runGit(root, ["commit", "-m", "seal historical application identity"]);
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({
        schema: "nbook.task-ownership/v1",
        ownerRoot: "packages/neuro-book/.agents/tasks",
        taskCount: 1,
        fileCount: 1,
        tasks: [{
            taskId,
            ownerRoot: "packages/neuro-book/.agents/tasks",
            files: [{
                path: `${taskId}/README.md`,
                legacyDestination: mode === "mismatched-ownership" ? `.agents/tasks/other/README.md` : destination,
                sha256: `sha256:${"0".repeat(64)}`,
            }],
        }],
    }));
    await writeText(root, `packages/neuro-book/.agents/tasks/${taskId}/README.md`, readme);
    await writeText(root, `packages/neuro-book/.agents/tasks/${taskId}/context.md`, "# Historical application context\n");
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
        ".agents/tasks/00160-leader-driven-development-workflow/README.md",
        ".agents/tasks/00160-leader-driven-development-workflow/context.md",
    ] as const) {
        await writeText(root, relativePath, await readFile(join(repositoryRoot, relativePath), "utf8"));
    }
    await writeText(root, "packages/neuro-book/docs/proposals/agent-skills-adaptation.md", "# Proposal\n\n状态：accepted\n");
    await writeText(root, ".agents/tasks/ownership.json", JSON.stringify({
        schema: "nbook.task-ownership/v1",
        ownerRoot: "packages/neuro-book/.agents/tasks",
        taskCount: 0,
        fileCount: 0,
        tasks: [],
    }));
    await writeText(root, ".agents/tasks/00161-profile/README.md", `---
schema: nbook.task/v1
taskId: 00161-profile
issueRequired: false
actionIssueId: null
worktreeId: null
branchId: master
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
    await writeText(root, ".agents/tasks/00161-profile/context.md", "# CLI Task Context\n");
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

async function runAgentContextCli(taskId: string, repoRoot = repositoryRoot): Promise<{status: number; failures: string[]}> {
    try {
        const result = await execFile("bun", [join(repositoryRoot, "scripts/cli/agent-context.ts"), "--repo-root", repoRoot, "--task", taskId], {cwd: repositoryRoot, encoding: "utf8"});
        const report = JSON.parse(result.stdout) as {failures: string[]};
        return {status: 0, failures: report.failures};
    } catch (error) {
        const result = error as {code?: number | string; stdout?: string; stderr?: string};
        if (result.stdout) {
            const report = JSON.parse(result.stdout) as {failures: string[]};
            return {status: typeof result.code === "number" ? result.code : 1, failures: report.failures};
        }
        throw new Error(`agent-context CLI 未输出 JSON：${result.stderr ?? ""}`, {cause: error});
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
