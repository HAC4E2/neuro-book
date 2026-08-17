import {createHash} from "node:crypto";
import {execFile as execFileCallback} from "node:child_process";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {promisify} from "node:util";
import {afterEach, describe, expect, it} from "vitest";

import {GOVERNANCE_NON_EMPTY_LINE_LIMITS, verifyGovernanceDocumentLimits, verifyTaskMigration} from "nbook/scripts/ci/agent-governance-contract";
import {createTestTmpRoot} from "nbook/server/workspace-files/test-tmp-sweep";

const execFile = promisify(execFileCallback);
const fixtureRoots: string[] = [];
const sourceFiles = [
    {source: "docs/tasks/alpha/README.md", destination: ".agents/tasks/alpha/README.md", content: "alpha baseline\n"},
    {source: "docs/tasks/beta/README.md", destination: ".agents/tasks/beta/README.md", content: "beta baseline\n"},
] as const;

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

describe("agent governance document limits", () => {
    it("非空行数达到上限时通过", async () => {
        const root = await createLimitFixture(0);

        expect(verifyGovernanceDocumentLimits(root)).toEqual([]);
    });

    it("超过一行时报告文件、实际行数与上限", async () => {
        const root = await createLimitFixture(1);

        expect(verifyGovernanceDocumentLimits(root)).toEqual([
            "治理入口超过非空行上限：AGENTS.md 221 > 220",
            "治理入口超过非空行上限：.omp/RULES.md 81 > 80",
            "治理入口超过非空行上限：WATCHDOG.md 41 > 40",
        ]);
    });
});

async function createLimitFixture(extraLines: number): Promise<string> {
    const root = await createTestTmpRoot("governance-limits", "governance-limits-test");
    fixtureRoots.push(root);
    await Promise.all(Object.entries(GOVERNANCE_NON_EMPTY_LINE_LIMITS).map(async ([relativePath, limit]) => {
        const content = Array.from({length: limit + extraLines}, (_, index) => `line ${String(index + 1)}`).join("\n");
        await writeText(root, relativePath, `${content}\n`);
    }));
    return root;
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
