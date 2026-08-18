import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {existsSync, lstatSync, readFileSync, readdirSync} from "node:fs";
import {dirname, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {resolveAgentAcceptanceRoot, resolveAgentCacheRoot, resolveAgentTempRoot, resolveAgentTestRoot, resolveAgentWorktreeRoot} from "@notnotype/neuro-book-test-support/paths";

export const GOVERNANCE_SCHEMA = "nbook.governance/v1";
export const CANONICAL_ROLES = ["pm", "leader", "tasker", "reviewer"] as const;
export type CanonicalRole = typeof CANONICAL_ROLES[number];

type TaskMigrationMapping = {
    source: string;
    destination: string;
    sourceSha256: string;
    destinationSha256: string;
    kind: "file";
    linkRewrite: boolean;
};

type TaskMigrationIndex = {
    schema: string;
    sourceRevision: string;
    fileCount: number;
    manifestSha256: string;
    migratedAt: string;
    mappings: TaskMigrationMapping[];
    repositoryLinkRewrites: string[];
    preservedSourceFiles: string[];
    trackedFileCount: number;
    localOnlyFiles: string[];
};

type TaskMigrationMarker = {
    schema: string;
    sourceRevision: string;
    fileCount: number;
    manifestSha256: string;
    completedAt: string;
    repositoryLinkRewrites: string[];
    preservedSourceFiles: string[];
    trackedFileCount: number;
    localOnlyFiles: string[];
};

export function defaultRepoRoot(moduleUrl: string): string {
    return resolve(dirname(fileURLToPath(moduleUrl)), "..", "..");
}

export function git(repoRoot: string, args: readonly string[]): string {
    return execFileSync("git", [...args], {cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trimEnd();
}

export function gitRevision(repoRoot: string): string {
    return git(repoRoot, ["rev-parse", "HEAD"]);
}

export function gitBranch(repoRoot: string): string {
    return git(repoRoot, ["branch", "--show-current"]) || "detached";
}

export function gitStatus(repoRoot: string): string {
    return git(repoRoot, ["status", "--short"]);
}

export function readRepoText(repoRoot: string, relativePath: string): string {
    return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

export function hasDirectory(repoRoot: string, relativePath: string): boolean {
    const path = resolve(repoRoot, relativePath);
    return existsSync(path) && lstatSync(path).isDirectory();
}

export function hasFile(repoRoot: string, relativePath: string): boolean {
    const path = resolve(repoRoot, relativePath);
    return existsSync(path) && lstatSync(path).isFile();
}

export function governanceRoots(repoRoot: string, env: NodeJS.ProcessEnv = process.env) {
    const agentRoot = resolveAgentTempRoot(env);
    return {
        agentRoot,
        testRoot: resolveAgentTestRoot(env.NBOOK_TEST_RUN_ID && /^[a-f0-9]{8}$/u.test(env.NBOOK_TEST_RUN_ID) ? env.NBOOK_TEST_RUN_ID : "00000000", env),
        acceptanceRoot: resolveAgentAcceptanceRoot(env),
        cacheRoot: resolveAgentCacheRoot("source-dev", env),
        worktreeRoot: resolveAgentWorktreeRoot(primaryCheckoutRoot(repoRoot), env),
    };
}

/** 返回共享 Git common dir 对应的主 checkout，避免 linked worktree 内嵌套 `.worktree/.worktree`。 */
export function primaryCheckoutRoot(repoRoot: string): string {
    const commonDir = resolve(repoRoot, git(repoRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
    return dirname(commonDir);
}

/** 校验 monorepo registered worktree 只位于主 checkout 的 canonical `.worktree/` 下。 */
export function verifyMonorepoWorktreeLayout(repoRoot: string): string[] {
    const failures: string[] = [];
    const primaryRoot = primaryCheckoutRoot(repoRoot);
    const canonicalRoot = resolve(primaryRoot, ".worktree");
    for (const entry of parseWorktreeEntries(git(repoRoot, ["worktree", "list", "--porcelain"]))) {
        const worktree = typeof entry.worktree === "string" ? entry.worktree : null;
        if (!worktree || samePath(worktree, primaryRoot)) continue;
        if (!isAbsoluteInside(worktree, canonicalRoot)) failures.push(`monorepo worktree 位置违规：${worktree}（应位于 ${canonicalRoot}）`);
    }
    if (!samePath(repoRoot, primaryRoot) && !isAbsoluteInside(repoRoot, canonicalRoot)) {
        failures.push(`当前 worktree 不在主 checkout 的 canonical 根下：${repoRoot}`);
    }
    return failures;
}

function parseWorktreeEntries(text: string): Array<Record<string, string | true>> {
    return text.split(/\n\n/u).filter(Boolean).map((block) => Object.fromEntries(block.split(/\r?\n/u).map((line) => {
        const separator = line.indexOf(" ");
        return separator < 0 ? [line, true] : [line.slice(0, separator), line.slice(separator + 1)];
    })));
}

function samePath(left: string, right: string): boolean {
    return normalizePath(left) === normalizePath(right);
}

function isAbsoluteInside(path: string, parent: string): boolean {
    const remainder = relative(normalizePath(parent), normalizePath(path));
    return remainder !== "" && !remainder.startsWith("..") && !remainder.startsWith("/") && !/^[A-Za-z]:/u.test(remainder);
}

function normalizePath(path: string): string {
    const normalized = resolve(path).replaceAll("\\", "/");
    return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

export function expectedGovernanceFiles(): readonly string[] {
    return [
        ".agents/AGENTS.md",
        ".agents/README.md",
        ".agents/tasks/AGENTS.md",
        ".agents/tasks/README.md",
        ".agents/tasks/.migration-complete",
        ".agents/tasks/legacy-index.json",
        ...CANONICAL_ROLES.map((role) => `.agents/roles/${role}/AGENTS.md`),
        ".agents/skills/README.md",
        "packages/neuro-book/AGENTS.md",
        "scripts/AGENTS.md",
        "scripts/release/AGENTS.md",
        "packages/AGENTS.md",
    ];
}

export function containsLine(text: string, line: string): boolean {
    return text.split(/\r?\n/u).some((candidate) => candidate.trim() === line);
}

export function isPathInside(relativePath: string, parent: string): boolean {
    const normalized = relativePath.replaceAll("\\", "/");
    const normalizedParent = parent.replaceAll("\\", "/").replace(/\/$/u, "");
    return normalized === normalizedParent || normalized.startsWith(`${normalizedParent}/`);
}

/** 校验历史 Task 迁移是否同时具备磁盘、hash、Git index 和 clean-cutover 证据。 */
export function verifyTaskMigration(repoRoot: string): string[] {
    const failures: string[] = [];
    const indexPath = resolve(repoRoot, ".agents", "tasks", "legacy-index.json");
    const markerPath = resolve(repoRoot, ".agents", "tasks", ".migration-complete");
    const index = readJson<TaskMigrationIndex>(indexPath, failures, "legacy-index.json");
    const marker = readJson<TaskMigrationMarker>(markerPath, failures, ".migration-complete");
    if (!index || !marker) return failures;

    if (index.schema !== "nbook.task-migration-index/v1") failures.push("legacy-index.json schema 不匹配");
    if (marker.schema !== "nbook.task-migration/v1") failures.push(".migration-complete schema 不匹配");
    if (!Number.isInteger(index.fileCount)) failures.push("legacy-index.json 缺少整数 fileCount");
    if (!Array.isArray(index.mappings)) failures.push("legacy-index.json mappings 不是数组");
    if (!Array.isArray(index.repositoryLinkRewrites) || !Array.isArray(index.preservedSourceFiles)) failures.push("legacy-index.json 链接字段不是数组");
    if (!Array.isArray(index.localOnlyFiles) || !Number.isInteger(index.trackedFileCount)) failures.push("legacy-index.json 缺少 trackedFileCount/localOnlyFiles");
    if (!Number.isInteger(marker.fileCount)) failures.push(".migration-complete 缺少整数 fileCount");
    if (!Array.isArray(marker.repositoryLinkRewrites) || !Array.isArray(marker.preservedSourceFiles)) failures.push(".migration-complete 链接字段不是数组");
    if (!Array.isArray(marker.localOnlyFiles) || !Number.isInteger(marker.trackedFileCount)) failures.push(".migration-complete 缺少 trackedFileCount/localOnlyFiles");
    if (failures.length > 0) return failures;

    let baselineTracked: Record<string, true>;
    try {
        const paths = git(repoRoot, ["ls-tree", "-r", "--name-only", index.sourceRevision, "--", "docs/tasks"]).split(/\r?\n/u).filter(Boolean);
        baselineTracked = Object.fromEntries(paths.map((path) => [path, true])) as Record<string, true>;
    } catch (error) {
        failures.push(`迁移 sourceRevision 无法读取：${String(error)}`);
        return failures;
    }
    const mappings = index.mappings;
    const mappingSources = Object.fromEntries(mappings.map((mapping) => [mapping.source, true])) as Record<string, true>;
    const mappingDestinations = Object.fromEntries(mappings.map((mapping) => [mapping.destination, true])) as Record<string, true>;
    const localOnlySources = Object.fromEntries(index.localOnlyFiles.map((source) => [source, true])) as Record<string, true>;
    const stagedOrTracked = Object.fromEntries(git(repoRoot, ["ls-files", "--cached"]).split(/\r?\n/u).filter(Boolean).map((path) => [path, true])) as Record<string, true>;
    const stagedLegacyDeletes = Object.fromEntries(git(repoRoot, ["diff", "--cached", "--name-only", "--diff-filter=D", "--", "docs/tasks"]).split(/\r?\n/u).filter(Boolean).map((path) => [path, true])) as Record<string, true>;

    if (index.fileCount !== mappings.length) failures.push(`迁移 index fileCount 与 mappings 不一致：${String(index.fileCount)} != ${String(mappings.length)}`);
    if (marker.fileCount !== mappings.length) failures.push(`迁移 marker fileCount 与 mappings 不一致：${String(marker.fileCount)} != ${String(mappings.length)}`);
    if (marker.sourceRevision !== index.sourceRevision) failures.push("迁移 marker sourceRevision 与 index 不一致");
    if (marker.manifestSha256 !== index.manifestSha256) failures.push("迁移 marker manifestSha256 与 index 不一致");
    if (marker.trackedFileCount !== index.trackedFileCount) failures.push("迁移 marker trackedFileCount 与 index 不一致");
    if (JSON.stringify(marker.localOnlyFiles) !== JSON.stringify(index.localOnlyFiles)) failures.push("迁移 marker localOnlyFiles 与 index 不一致");
    if (JSON.stringify(marker.repositoryLinkRewrites) !== JSON.stringify(index.repositoryLinkRewrites)) failures.push("迁移 marker repositoryLinkRewrites 与 index 不一致");
    if (JSON.stringify(marker.preservedSourceFiles) !== JSON.stringify(index.preservedSourceFiles)) failures.push("迁移 marker preservedSourceFiles 与 index 不一致");
    if (Object.keys(mappingSources).length !== mappings.length) failures.push("迁移 mappings 含重复 source");
    if (Object.keys(mappingDestinations).length !== mappings.length) failures.push("迁移 mappings 含重复 destination");
    if (Object.keys(baselineTracked).length !== index.trackedFileCount) failures.push(`迁移 trackedFileCount 与 baseline 不一致：${String(index.trackedFileCount)} != ${String(Object.keys(baselineTracked).length)}`);

    const manifest = {
        schema: "nbook.task-migration-manifest/v1",
        sourceRevision: index.sourceRevision,
        mappings,
        repositoryLinkRewrites: index.repositoryLinkRewrites,
        preservedSourceFiles: index.preservedSourceFiles,
    };
    const manifestSha256 = `sha256:${createHash("sha256").update(JSON.stringify(manifest)).digest("hex")}`;
    if (manifestSha256 !== index.manifestSha256) failures.push(`迁移 manifest SHA-256 不一致：${manifestSha256} != ${index.manifestSha256}`);

    for (const source of Object.keys(baselineTracked)) {
        if (!mappingSources[source]) failures.push(`baseline tracked Task 缺少 mapping：${source}`);
        if (existsSync(resolve(repoRoot, source))) failures.push(`旧 Task 文件仍存在：${source}`);
        if (stagedOrTracked[source] && !stagedLegacyDeletes[source]) failures.push(`旧 Task 删除尚未暂存：${source}`);
    }
    for (const source of index.localOnlyFiles) {
        if (!source.startsWith("docs/tasks/")) failures.push(`迁移 localOnlyFiles 路径不在 docs/tasks：${source}`);
        if (!mappingSources[source]) failures.push(`迁移 localOnlyFiles 缺少 mapping：${source}`);
    }
    for (const mapping of mappings) {
        const destinationPath = resolve(repoRoot, mapping.destination);
        const sourceTracked = Boolean(baselineTracked[mapping.source]);
        const sourceLocalOnly = Boolean(localOnlySources[mapping.source]);
        if (!hasFile(repoRoot, mapping.destination)) {
            if (sourceLocalOnly && isGitIgnored(repoRoot, mapping.destination)) continue;
            failures.push(`迁移目标缺失或不是普通文件：${mapping.destination}`);
            continue;
        }
        const actual = `sha256:${createHash("sha256").update(readFileSync(destinationPath)).digest("hex")}`;
        if (actual !== mapping.destinationSha256) failures.push(`迁移目标 hash 不一致：${mapping.destination}`);
        if (sourceTracked && sourceLocalOnly) failures.push(`tracked Task 被错误标记 localOnly：${mapping.source}`);
        if (sourceLocalOnly && sourceTracked) failures.push(`localOnly Task 与 baseline tracked 冲突：${mapping.source}`);
        if (!sourceLocalOnly && !stagedOrTracked[mapping.destination]) failures.push(`canonical Task 尚未进入 Git index：${mapping.destination}`);
        if (!sourceLocalOnly && isGitIgnored(repoRoot, mapping.destination)) failures.push(`canonical tracked Task 被 .gitignore：${mapping.destination}`);
        if (sourceLocalOnly && !isGitIgnored(repoRoot, mapping.destination)) failures.push(`localOnly Task 未被 .gitignore：${mapping.destination}`);
    }
    if (Object.keys(localOnlySources).length !== index.localOnlyFiles.length) failures.push("迁移 localOnlyFiles 含重复路径");
    if (index.localOnlyFiles.some((source) => baselineTracked[source])) failures.push("迁移 localOnlyFiles 包含 baseline tracked 路径");

    return failures;
}

/**
 * 校验所有 workspace 包的继承/覆盖规则、运行态边界和自治包归属资产。
 * 自治包保留项目 docs/Task/status；其他包可选建立同类专属资产，但不得复制根治理正文。
 */
export function verifyWorkspacePackageGovernance(repoRoot: string): string[] {
    const failures: string[] = [];
    const packagesRoot = resolve(repoRoot, "packages");
    const packageNames = existsSync(packagesRoot)
        ? readdirSync(packagesRoot, {withFileTypes: true}).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
        : [];
    const autonomous = new Set(["nb-history", "nb-workflow", "nb-memory", "nb-ui", "neuro-agent-harness", "llmlint"]);
    const manifestNames = new Map<string, string>();
    const manifests = new Map<string, Record<string, unknown>>();

    for (const packageName of packageNames) {
        const packageRoot = resolve(packagesRoot, packageName);
        const manifest = readJson<Record<string, unknown>>(resolve(packageRoot, "package.json"), failures, `packages/${packageName}/package.json`);
        if (!manifest) continue;
        manifests.set(packageName, manifest);
        if (typeof manifest.name !== "string" || !manifest.name) failures.push(`workspace包 package.json 缺少 name：packages/${packageName}/package.json`);
        else if (manifestNames.has(manifest.name)) failures.push(`workspace包 package name 重复：${manifest.name}`);
        else manifestNames.set(manifest.name, packageName);
    }

    for (const packageName of packageNames) {
        const packageRoot = resolve(packagesRoot, packageName);
        const manifest = manifests.get(packageName);
        if (!manifest) continue;
        for (const runtimeName of [".agent", ".local", ".worktree"] as const) {
            const runtimePath = resolve(packageRoot, runtimeName);
            if (!pathEntryExists(runtimePath)) continue;
            const relativePath = `packages/${packageName}/${runtimeName}`;
            if (!isGitIgnored(repoRoot, `${relativePath}/placeholder`)) failures.push(`包级运行态未被忽略：${relativePath}`);
            if (trackedPathExists(repoRoot, relativePath)) failures.push(`包级运行态被 Git 跟踪：${relativePath}`);
            if (runtimeName === ".worktree") failures.push(`临时 package worktree 尚未清理：${relativePath}`);
        }

        const agentsPath = resolve(packageRoot, "AGENTS.md");
        const taskRoot = resolve(packageRoot, ".agents", "tasks");
        const docsRoot = resolve(packageRoot, "docs");
        const statusPath = resolve(packageRoot, "PROJECT-STATUS.md");
        const hasLocalGovernance = pathEntryExists(agentsPath) || pathEntryExists(taskRoot) || pathEntryExists(docsRoot) || pathEntryExists(statusPath);
        if (hasLocalGovernance || autonomous.has(packageName)) {
            if (!pathEntryExists(agentsPath)) failures.push(`包级治理资产缺少 AGENTS.md：packages/${packageName}/AGENTS.md`);
            else if (!readFileSync(agentsPath, "utf8").includes("../../AGENTS.md")) failures.push(`包级 AGENTS.md 未引用根共享规则：packages/${packageName}/AGENTS.md`);
            failures.push(...verifyPackageTaskIds(packageRoot, packageName));
        }
        if (autonomous.has(packageName)) {
            for (const [entryPath, label] of [[taskRoot, ".agents/tasks"], [docsRoot, "docs"], [statusPath, "PROJECT-STATUS.md"]] as const) {
                if (!pathEntryExists(entryPath)) failures.push(`自治workspace包缺少归属资产：packages/${packageName}/${label}`);
            }
        }

        for (const dependencyName of workspaceDependencies(manifest)) {
            if (!manifestNames.has(dependencyName)) failures.push(`workspace依赖未对应本地包：packages/${packageName} -> ${dependencyName}`);
        }
        if (packageName !== "neuro-book" && workspaceDependencies(manifest).includes("@notnotype/neuro-book")) {
            failures.push(`自治或内部包不得依赖主应用：packages/${packageName} -> @notnotype/neuro-book`);
        }
    }
    return failures;
}

function workspaceDependencies(manifest: Record<string, unknown>): string[] {
    const names = new Set<string>();
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        const value = manifest[field];
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        for (const [name, version] of Object.entries(value)) {
            if (typeof version === "string" && (version.startsWith("workspace:") || version.startsWith("file:../"))) names.add(name);
        }
    }
    return [...names];
}

function pathEntryExists(path: string): boolean {
    try {
        lstatSync(path);
        return true;
    } catch {
        return false;
    }
}

function verifyPackageTaskIds(packageRoot: string, packageName: string): string[] {
    const failures: string[] = [];
    const taskRoot = resolve(packageRoot, ".agents", "tasks");
    if (!pathEntryExists(taskRoot)) return failures;
    const ids = new Set<string>();
    const files = collectMarkdownFiles(taskRoot);
    for (const file of files) {
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(/\btaskId:\s*["']?([A-Za-z0-9._-]+)["']?/gu)) {
            const taskId = match[1];
            if (ids.has(taskId)) failures.push(`自治workspace包Task编号重复：packages/${packageName}/${taskId}`);
            ids.add(taskId);
        }
    }
    return failures;
}
function trackedPathExists(repoRoot: string, relativePath: string): boolean {
    try {
        return Boolean(git(repoRoot, ["ls-files", "--", relativePath, `${relativePath}/`]).trim());
    } catch {
        return false;
    }
}

function collectMarkdownFiles(root: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(root, {withFileTypes: true})) {
        const path = resolve(root, entry.name);
        if (entry.isDirectory()) files.push(...collectMarkdownFiles(path));
        else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
    }
    return files;
}


function readJson<T>(path: string, failures: string[], label: string): T | null {
    try {
        return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch (error) {
        failures.push(`${label} 不可读或 JSON 无效：${String(error)}`);
        return null;
    }
}

function isGitIgnored(repoRoot: string, relativePath: string): boolean {
    try {
        git(repoRoot, ["check-ignore", "--no-index", "-q", relativePath]);
        return true;
    } catch {
        return false;
    }
}

