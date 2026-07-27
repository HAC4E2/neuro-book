import {createHash} from "node:crypto";
import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {readInstallationManifest, writeInstallationManifest} from "#manager/manifest-store";
import {createOperation, updateOperation} from "#manager/operation";
import {installationPaths} from "#manager/paths";
import {currentProductPlatform, PRODUCT_ASSET_NAMES} from "#manager/platform";
import type {GitUpdateTarget} from "#manager/git";
import type {InstallationManifest, OperationJournal, ReleaseManifest} from "#manager/types";
import {updateInstallation} from "#manager/updater";
import {planGitProfileUpdate, planReleaseProfileUpdate} from "#manager/update-planner";
import {MANAGER_VERSION} from "#manager/version-info";

const manifestStore = vi.hoisted(() => ({resolve: vi.fn()}));
const git = vi.hoisted(() => ({
    fetchUpdateTarget: vi.fn<(root: string) => Promise<GitUpdateTarget>>(),
    createStagedWorktree: vi.fn<(root: string, path: string, revision: string) => Promise<void>>(),
    removeStagedWorktree: vi.fn<(root: string, path: string) => Promise<void>>(),
    commitFastForward: vi.fn<(root: string, target: GitUpdateTarget) => Promise<void>>(),
    repositoryRevision: vi.fn<(root: string) => Promise<string>>(),
}));
const product = vi.hoisted(() => ({
    installSourceDependencies: vi.fn<(root: string, bun?: string) => Promise<void>>(),
}));
const migration = vi.hoisted(() => ({
    apply: vi.fn<(
        root: string,
        manifest: InstallationManifest,
        journal: OperationJournal,
        applicationRoot?: string,
    ) => Promise<OperationJournal>>(),
}));
const appCommands = vi.hoisted(() => ({
    rollbackAttachmentMigration: vi.fn<(
        root: string,
        manifest: InstallationManifest,
        runId: string,
        allowNotStarted?: boolean,
        applicationRoot?: string,
    ) => Promise<void>>(),
}));
vi.mock("#manager/manifest-store", async (importOriginal) => ({
    ...await importOriginal<typeof import("#manager/manifest-store")>(),
    resolveReleaseManifest: manifestStore.resolve,
}));
vi.mock("#manager/git", async (importOriginal) => ({
    ...await importOriginal<typeof import("#manager/git")>(),
    fetchUpdateTarget: git.fetchUpdateTarget,
    createStagedWorktree: git.createStagedWorktree,
    removeStagedWorktree: git.removeStagedWorktree,
    commitFastForward: git.commitFastForward,
    repositoryRevision: git.repositoryRevision,
}));
vi.mock("#manager/product", async (importOriginal) => ({
    ...await importOriginal<typeof import("#manager/product")>(),
    installSourceDependencies: product.installSourceDependencies,
}));
vi.mock("#manager/migration-operation", async (importOriginal) => ({
    ...await importOriginal<typeof import("#manager/migration-operation")>(),
    applyJournaledApplicationMigrations: migration.apply,
}));
vi.mock("#manager/app-commands", async (importOriginal) => ({
    ...await importOriginal<typeof import("#manager/app-commands")>(),
    rollbackAttachmentMigration: appCommands.rollbackAttachmentMigration,
}));

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const MANAGER_SOURCE = "console.log('manager');\n";
const MANAGER_SHA = createHash("sha256").update(MANAGER_SOURCE).digest("hex");
let root: string | null = null;

afterEach(async () => {
    manifestStore.resolve.mockReset();
    git.fetchUpdateTarget.mockReset();
    git.createStagedWorktree.mockReset();
    git.removeStagedWorktree.mockReset();
    git.commitFastForward.mockReset();
    git.repositoryRevision.mockReset();
    product.installSourceDependencies.mockReset();
    migration.apply.mockReset();
    appCommands.rollbackAttachmentMigration.mockReset();
    if (root) {
        await rm(root, {recursive: true, force: true});
        root = null;
    }
});

describe("Release Update预检", () => {
    it("应用、channel与Manager均一致时无副作用退出", async () => {
        root = await fixtureRoot();
        const manifest = productManifest();
        manifestStore.resolve.mockResolvedValue(releaseManifest());

        const result = await updateInstallation({root, manifest, managerExecutable: join(root, "manager-source.mjs")});

        expect(result).toEqual({manifest, changed: false, reason: "already-current"});
        await expect(stat(installationPaths(root).operations)).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(installationPaths(root).staging)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("加锁恢复后使用真实Manifest而不是调用方旧快照", async () => {
        root = await fixtureRoot();
        const current = productManifest();
        const stale = productManifest();
        stale.appVersion = "0.8.5-canary.1";
        stale.sourceRevision = "0".repeat(40);
        stale.components.source = {...stale.components.source, version: stale.appVersion, revision: stale.sourceRevision};
        if (stale.components.product?.provider === "release") {
            stale.components.product = {...stale.components.product, version: stale.appVersion, revision: stale.sourceRevision};
        }
        await writeInstallationManifest(installationPaths(root).manifest, stale);
        await createOperation({
            id: "restore-current-manifest",
            action: "update",
            root,
            containerEngine: null,
            backupRoot: join(root, ".deploy", "backups", "restore-current-manifest"),
            previousManifest: current,
            nextManifest: stale,
        });
        manifestStore.resolve.mockResolvedValue(releaseManifest());

        const result = await updateInstallation({root, manifest: stale, managerExecutable: join(root, "manager-source.mjs")});

        expect(result).toEqual({manifest: current, changed: false, reason: "already-current"});
        expect(await readInstallationManifest(installationPaths(root).manifest)).toEqual(current);
        expect(await readdir(installationPaths(root).operations)).toHaveLength(1);
    });

    it("应用相同但Manager较新时只接管Manager", async () => {
        root = await fixtureRoot();
        const manifest = productManifest({managerVersion: "0.1.0-canary.18"});
        manifestStore.resolve.mockResolvedValue(releaseManifest());
        const source = join(root, "manager-source.mjs");
        await writeFile(source, MANAGER_SOURCE, "utf8");

        const result = await updateInstallation({root, manifest, managerExecutable: source});

        expect(result.changed).toBe(true);
        expect(result.manifest.appVersion).toBe(manifest.appVersion);
        expect(result.manifest.components.source).toEqual(manifest.components.source);
        expect(result.manifest.components.product).toEqual(manifest.components.product);
        expect(result.manifest.managerVersion).toBe(MANAGER_VERSION);
        expect((await readInstallationManifest(installationPaths(root).manifest))?.managerVersion).toBe(MANAGER_VERSION);
        await expect(stat(join(root, ".deploy", "backups"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("GHCR应用相同但Manager较新时不生成或切换Compose", async () => {
        const manifest = ghcrManifest({managerVersion: "0.1.0-canary.18"});
        const release = releaseManifest();

        const plan = planReleaseProfileUpdate(manifest, release, "canary", true);

        expect(plan.applicationChanged).toBe(false);
        expect(plan.managerChanged).toBe(true);
        expect([...plan.components]).toEqual([]);
        expect(plan.alreadyCurrent).toBe(false);
    });

    it("staging失败发生在停服务与数据库备份前，并清理本次staging", async () => {
        root = await fixtureRoot();
        const manifest = productManifest();
        const databasePath = join(root, "workspace", ".nbook", "neuro-book.sqlite");
        await mkdir(databasePath, {recursive: true});
        manifestStore.resolve.mockResolvedValue(releaseManifest({version: "0.8.7-canary.1", sourceRevision: "c".repeat(40), sha: SHA_B}));

        await expect(updateInstallation({root, manifest, managerExecutable: join(root, "manager-source.mjs")}))
            .rejects.toThrow("下载失败 404");

        const operations = await readdir(installationPaths(root).operations);
        expect(operations).toHaveLength(1);
        const journal = JSON.parse(await readFile(join(installationPaths(root).operations, operations[0]!), "utf8")) as {
            phase: string;
            outcome?: string;
            nextManifest: unknown;
        };
        expect(journal).toMatchObject({phase: "committed", outcome: "rolled-back", nextManifest: null});
        expect(await readdir(installationPaths(root).staging)).toEqual([]);
        expect(await stat(databasePath)).toBeTruthy();
    });

    it("checksum变化只保留真正变化的应用组件", () => {
        const manifest = productManifest();
        const release = releaseManifest({productSha: SHA_B});

        const plan = planReleaseProfileUpdate(manifest, release, "canary", false);

        expect([...plan.components]).toEqual(["source", "product"]);
        expect(plan.applicationChanged).toBe(true);
        expect(plan.alreadyCurrent).toBe(false);
    });
});

describe("Git Profile Update Planner", () => {
    it("Source Dev只更新Source，Source Product固定更新Source与Product", () => {
        const sourceDev = gitManifest("source-dev");
        const sourceProduct = gitManifest("source-product");

        expect([...planGitProfileUpdate(sourceDev, "2".repeat(40), "canary", false).components]).toEqual(["source"]);
        expect([...planGitProfileUpdate(sourceProduct, "2".repeat(40), "canary", false).components]).toEqual(["source", "product"]);
    });

    it("同revision、同channel且Manager未变化时无操作", () => {
        const manifest = gitManifest("source-dev");
        expect(planGitProfileUpdate(manifest, manifest.sourceRevision, manifest.channel, false).alreadyCurrent).toBe(true);
    });
});

describe("Source Dev Update恢复", () => {
    it("迁移失败时先用staged executor恢复Operation，再删除worktree", async () => {
        root = await fixtureRoot();
        const manifest = gitManifest("source-dev");
        const targetRevision = "2".repeat(40);
        const events: string[] = [];
        let stagedWorktree: string | null = null;
        git.fetchUpdateTarget.mockResolvedValue({
            previousRevision: manifest.sourceRevision,
            targetRevision,
            branch: "master",
        });
        git.repositoryRevision.mockResolvedValue(manifest.sourceRevision);
        git.createStagedWorktree.mockImplementation(async (_root, path) => {
            stagedWorktree = path;
            await mkdir(path, {recursive: true});
            await writeFile(join(path, "package.json"), JSON.stringify({name: "neuro-book", version: "0.8.7-canary.1"}), "utf8");
        });
        git.removeStagedWorktree.mockImplementation(async (_root, path) => {
            events.push("remove-worktree");
            await rm(path, {recursive: true, force: true});
        });
        product.installSourceDependencies.mockResolvedValue();
        migration.apply.mockImplementation(async (_root, _manifest, journal, applicationRoot) => {
            if (!applicationRoot) throw new Error("测试缺少staged migrationRoot");
            await updateOperation(journal, journal.phase, {
                migrationRoot: applicationRoot,
                attachmentMigration: {
                    runId: `${journal.id}-attachment`,
                    state: "planned",
                    migratedSessions: 1,
                    sessions: [{
                        sessionId: 1,
                        sourcePath: "workspace/project/.nbook/sessions/1/attachments/source.png",
                        sourceHash: SHA_A,
                        targetHash: SHA_B,
                    }],
                },
            });
            throw new Error("模拟迁移失败");
        });
        appCommands.rollbackAttachmentMigration.mockImplementation(async (_root, _manifest, _runId, _allowNotStarted, applicationRoot) => {
            const executorExists = applicationRoot
                ? await stat(applicationRoot).then(() => true).catch(() => false)
                : false;
            events.push(`recover:${executorExists ? "executor-present" : "executor-missing"}`);
        });

        await expect(updateInstallation({root, manifest, managerExecutable: join(root, "manager-source.mjs")}))
            .rejects.toThrow("模拟迁移失败");

        expect(stagedWorktree).not.toBeNull();
        expect(events).toEqual(["recover:executor-present", "remove-worktree"]);
        expect(appCommands.rollbackAttachmentMigration).toHaveBeenCalledOnce();
    });
});

async function fixtureRoot(): Promise<string> {
    const fixture = await mkdtemp(join(tmpdir(), "nbook-manager-update-"));
    await mkdir(join(fixture, ".deploy"), {recursive: true});
    await writeFile(join(fixture, "manager-source.mjs"), MANAGER_SOURCE, "utf8");
    return fixture;
}

function productManifest(overrides: {managerVersion?: string} = {}): InstallationManifest {
    return {
        schemaVersion: 4,
        profile: "product-bun",
        containerEngine: null,
        managerVersion: overrides.managerVersion ?? MANAGER_VERSION,
        appVersion: "0.8.6-canary.1",
        channel: "canary",
        sourceRevision: "1".repeat(40),
        stateRoot: ".",
        components: {
            source: {
                provider: "release",
                version: "0.8.6-canary.1",
                revision: "1".repeat(40),
                path: ".",
                files: ["package.json"],
                archiveSha256: SHA_A,
                sourceUrl: "https://example.com/source.zip",
                license: "AGPL-3.0-only",
                redistribution: "test",
            },
            product: {
                provider: "release",
                version: "0.8.6-canary.1",
                revision: "1".repeat(40),
                path: ".output",
                platform: currentProductPlatform(),
                archiveSha256: SHA_A,
                sourceUrl: "https://example.com/product.zip",
                license: "AGPL-3.0-only",
                redistribution: "test",
            },
            manager: {provider: "managed", version: overrides.managerVersion ?? MANAGER_VERSION, path: ".runtime/manager/old/neuro-book.mjs", bundleSha256: MANAGER_SHA},
            managerRuntime: {provider: "system", version: "1.3.14", executable: process.execPath},
            applicationRuntime: {provider: "system", version: "1.3.14", executable: process.execPath},
            tools: {},
        },
        installedAt: "2026-07-17T00:00:00.000Z",
        updatedAt: "2026-07-17T00:00:00.000Z",
    };
}

function ghcrManifest(overrides: {managerVersion?: string} = {}): InstallationManifest {
    const manifest = productManifest(overrides);
    return {
        ...manifest,
        profile: "ghcr",
        stateRoot: ".",
        components: {
            source: {
                provider: "container",
                version: manifest.appVersion,
                revision: manifest.sourceRevision,
                path: "/app",
            },
            product: {
                provider: "container",
                version: manifest.appVersion,
                revision: manifest.sourceRevision,
                image: `ghcr.io/notnotype/neuro-book:v${manifest.appVersion}`,
                digest: `sha256:${SHA_A}`,
            },
            manager: manifest.components.manager,
            managerRuntime: manifest.components.managerRuntime,
            applicationRuntime: {provider: "container", version: manifest.appVersion},
            tools: {},
        },
    };
}

function gitManifest(profile: "source-dev" | "source-product"): InstallationManifest {
    const manifest = productManifest();
    return {
        ...manifest,
        profile,
        components: {
            ...manifest.components,
            source: {
                provider: "git",
                version: manifest.appVersion,
                revision: manifest.sourceRevision,
                path: ".",
                repository: "https://github.com/notnotype/neuro-book.git",
                branch: "master",
            },
            product: profile === "source-dev" ? undefined : {
                provider: "git",
                version: manifest.appVersion,
                revision: manifest.sourceRevision,
                path: ".output",
                platform: currentProductPlatform(),
            },
        },
    };
}

function releaseManifest(overrides: {version?: string; sourceRevision?: string; sha?: string; productSha?: string} = {}): ReleaseManifest {
    const version = overrides.version ?? "0.8.6-canary.1";
    const sourceRevision = overrides.sourceRevision ?? "1".repeat(40);
    const sourceSha = overrides.sha ?? SHA_A;
    return {
        schemaVersion: 3,
        version,
        channel: "canary",
        sourceRevision,
        minManagerVersion: MANAGER_VERSION,
        source: {url: "https://example.com/source.zip", sha256: sourceSha, bytes: 1},
        products: [{platform: currentProductPlatform(), sourceRevision, url: `https://example.com/${PRODUCT_ASSET_NAMES[currentProductPlatform()]}`, sha256: overrides.productSha ?? sourceSha, bytes: 1}],
        windowsPortable: {url: "https://example.com/portable.zip", sha256: sourceSha, bytes: 1},
        ghcr: {ref: `ghcr.io/notnotype/neuro-book:v${version}`, digest: `sha256:${SHA_A}`, sourceRevision},
    };
}
