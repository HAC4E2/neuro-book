import {createHash} from "node:crypto";
import {execFile as execFileCallback} from "node:child_process";
import {mkdir, readFile, realpath, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {promisify} from "node:util";
import {afterEach, describe, expect, it} from "vitest";

import {primaryCheckoutRoot, verifyMonorepoCutover, verifyMonorepoWorktreeLayout, verifySiblingResyncResolution, verifyTaskMigration, verifyWorkspacePackageGovernance} from "#scripts/ci/agent-governance-contract";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

const execFile = promisify(execFileCallback);
const fixtureRoots: string[] = [];
const sourceFiles = [
    {source: "docs/tasks/alpha/README.md", destination: ".agents/tasks/alpha/README.md", content: "alpha baseline\n"},
    {source: "docs/tasks/beta/README.md", destination: ".agents/tasks/beta/README.md", content: "beta baseline\n"},
] as const;
const repositoryRoot = join(import.meta.dirname, "..", "..");

afterEach(async () => {
    await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("agent governance task migration gate", () => {
    it("目标未进入 Git index 时失败并指出 canonical 路径", async () => {
        const repoRoot = await createFixture({stageTargets: false, retainLegacy: false});

        const failures = verifyTaskMigration(repoRoot);

        expect(failures).toContain("canonical Task 尚未进入 Git index：.agents/tasks/alpha/README.md");
    });

    it("旧 docs/tasks 仍在工作树时失败并指出 clean cutover 缺口", async () => {
        const repoRoot = await createFixture({stageTargets: true, retainLegacy: true});

        const failures = verifyTaskMigration(repoRoot);

        expect(failures).toContain("旧 Task 文件仍存在：docs/tasks/alpha/README.md");
        expect(failures).toContain("旧 Task 删除尚未暂存：docs/tasks/alpha/README.md");
    });

    it("canonical targets、metadata 和 staged deletion 完整时通过", async () => {
        const repoRoot = await createFixture({stageTargets: true, retainLegacy: false, commitCutover: false});

        expect(verifyTaskMigration(repoRoot)).toEqual([]);
    });

    it("迁移提交完成后旧目录不再要求虚假的 staged deletion", async () => {
        const repoRoot = await createFixture({stageTargets: true, retainLegacy: false, commitCutover: true});

        expect(verifyTaskMigration(repoRoot)).toEqual([]);
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
    it("当前迁移结果的旧根入口与 sibling 对账均闭合", () => {
        expect(verifyMonorepoCutover(repositoryRoot)).toEqual([]);
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

async function createFixture(options: {stageTargets: boolean; retainLegacy: boolean; commitCutover?: boolean}): Promise<string> {

    const root = await createTestTmpRoot("governance-migration", "governance-migration-test");
    fixtureRoots.push(root);
    await runGit(root, ["init", "--initial-branch", "master"]);
    await runGit(root, ["config", "user.email", "governance-test@example.invalid"]);
    await runGit(root, ["config", "user.name", "Governance Test"]);

    for (const file of sourceFiles) await writeText(root, file.source, file.content);
    await runGit(root, ["add", "docs/tasks"]);
    await runGit(root, ["commit", "-m", "baseline tasks"]);
    const sourceRevision = (await runGit(root, ["rev-parse", "HEAD"])).trim();

    for (const file of sourceFiles) await writeText(root, file.destination, file.content);
    const mappings = await Promise.all(sourceFiles.map(async (file) => ({
        source: file.source,
        destination: file.destination,
        sourceSha256: await sha256(join(root, file.source)),
        destinationSha256: await sha256(join(root, file.destination)),
        kind: "file" as const,
        linkRewrite: false,
    })));
    const manifest = {
        schema: "nbook.task-migration-manifest/v1",
        sourceRevision,
        mappings,
        repositoryLinkRewrites: [],
        preservedSourceFiles: [],
    };
    const manifestSha256 = hashBytes(Buffer.from(JSON.stringify(manifest)));
    const index = {
        schema: "nbook.task-migration-index/v1",
        sourceRevision,
        fileCount: mappings.length,
        manifestSha256,
        migratedAt: new Date().toISOString(),
        mappings,
        repositoryLinkRewrites: [],
        preservedSourceFiles: [],
        trackedFileCount: sourceFiles.length,
        localOnlyFiles: [],
    };
    const marker = {
        schema: "nbook.task-migration/v1",
        sourceRevision,
        fileCount: mappings.length,
        manifestSha256,
        completedAt: new Date().toISOString(),
        repositoryLinkRewrites: [],
        preservedSourceFiles: [],
        trackedFileCount: sourceFiles.length,
        localOnlyFiles: [],
    };
    await writeText(root, ".agents/tasks/legacy-index.json", `${JSON.stringify(index, null, 2)}\n`);
    await writeText(root, ".agents/tasks/.migration-complete", `${JSON.stringify(marker, null, 2)}\n`);

    if (!options.retainLegacy) {
        await rm(join(root, "docs/tasks"), {recursive: true, force: true});
        await runGit(root, ["add", "-A", "docs/tasks"]);
    }
    if (options.stageTargets) {
        await runGit(root, ["add", "-A", ".agents/tasks"]);
    } else {
        await runGit(root, ["add", ".agents/tasks/legacy-index.json", ".agents/tasks/.migration-complete"]);
    }
    if (options.commitCutover) await runGit(root, ["commit", "-m", "task migration cutover"]);
    return root;
}

async function writeText(root: string, relativePath: string, content: string): Promise<void> {
    const path = join(root, relativePath);
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, content, "utf8");
}

async function sha256(path: string): Promise<string> {
    return hashBytes(await readFile(path));
}

function hashBytes(bytes: Uint8Array): string {
    return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function runGit(cwd: string, args: string[]): Promise<string> {
    const result = await execFile("git", args, {cwd, encoding: "utf8"});
    return result.stdout;
}
