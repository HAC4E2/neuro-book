import {createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {createReadStream} from "node:fs";
import {
    lstat,
    mkdir,
    readFile,
    readdir,
    readlink,
    realpath,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import {isAbsolute, posix, relative, resolve, sep, win32} from "node:path";
import {promisify} from "node:util";
import {lock as acquireFileLock} from "proper-lockfile";
import {
    assertProductRuntimeContractFiles,
    parseProductRuntimeContract,
    PRODUCT_RUNTIME_CONTRACT_PATH,
    productRuntimeContractSha256,
} from "nbook/shared/product-runtime-contract";

const execFileAsync = promisify(execFile);
const MANIFEST_FILE = "runtime-image.json";
const READY_FILE = "runtime-image.ready";
const MANIFEST_SCHEMA = "nbook.product-runtime-image/v2";
const READY_SCHEMA = "nbook.product-runtime-image-ready/v1";
const BUILDER_CONTRACT_VERSION = "2";
const OWNER_GROWTH_LIMIT = 0.10;
const MAX_CONTROL_FILE_BYTES = 1024 * 1024;
const STAGING_LEASE_STALE_MS = 24 * 60 * 60 * 1000;
const STAGING_LEASE_UPDATE_MS = 60 * 1000;
const STAGING_OWNER_SCHEMA = "nbook.product-runtime-image-staging-owner/v1";
const GITLESS_SOURCE_EXCLUDES = new Set([
    ".agent", ".cache", ".deploy", ".git", ".nuxt", ".output", ".runtime",
    "coverage", "dist", "node_modules", "tmp", "workspace",
]);

/** Product Runtime Image 中一个明确的磁盘 owner。路径均相对镜像根。 */
export interface ProductRuntimeImageOwner {
    name: string;
    paths: readonly string[];
}

/** 已登记 owner 的稳定基线；Builder 固定只允许最多 10% 增长。 */
export interface ProductRuntimeOwnerBaseline {
    name: string;
    files: number;
    bytes: number;
}

/** Runtime Image 的总量与 owner 回归预算。 */
export interface ProductRuntimeImageBudget {
    maxFiles: number;
    maxBytes: number;
    /** 必须覆盖每个 owner；预算调整只能通过受审查的基线文件发生。 */
    ownerBaselines: readonly ProductRuntimeOwnerBaseline[];
}

/** 调用方在构建前已经锁定、需要 Builder 复核的 Source 身份。 */
export interface ProductRuntimeBuildExpectation {
    /** 未提供时使用 Source package.json 中的版本。 */
    version?: string;
    /** 未提供时使用当前 Git HEAD。 */
    revision?: string;
    /** 正式发行应显式传 false；本地验收可以不限制。 */
    dirty?: boolean;
    /** 未提供时仅使用 request.platform。 */
    lockfileSha256?: string;
}

/** 构建回调只能向本次 operation 的候选根与临时根写入。 */
export interface ProductRuntimeBuildContext {
    imageRoot: string;
    /**
     * 与候选共享 lease 的临时目录。回调可以按需创建子目录；Builder 会在清点
     * payload 前删除它，进程硬中断后则随整个候选一起由 stale sweep 回收。
     */
    scratchRoot: string;
    operationId: string;
    /** 构建开始前锁定的完整 Source 内容身份；用于派生可复现的 Product 构建字段。 */
    sourceDigest: string;
}

/** 创建一个隔离候选镜像所需的完整请求。 */
export interface ProductRuntimeBuildRequest {
    operationId: string;
    platform: string;
    owners: readonly ProductRuntimeImageOwner[];
    budget: ProductRuntimeImageBudget;
    expectedSource?: ProductRuntimeBuildExpectation;
    build(context: ProductRuntimeBuildContext): Promise<void>;
}

/** `openVerified` 必须由调用方给出的代次身份。 */
export interface ProductRuntimeExpectedIdentity {
    version: string;
    revision: string;
    dirty: boolean;
    platform: string;
    /** 已知 image ID 时一并钉死。 */
    imageId?: string;
    /** Release/Portable 已知 lockfile 时一并钉死。 */
    lockfileSha256?: string;
    /** 同一构建事务需要复核 Source 输入时一并钉死。 */
    sourceDigest?: string;
}

/** 一个 owner 在最终不可变 payload 中的实际占用。 */
export interface ProductRuntimeOwnerInventory {
    name: string;
    paths: string[];
    files: number;
    bytes: number;
}

/** `runtime-image.json` 的 v2 固定合同。 */
export interface ProductRuntimeImageManifest {
    schema: typeof MANIFEST_SCHEMA;
    builderContractVersion: typeof BUILDER_CONTRACT_VERSION;
    imageId: string;
    version: string;
    revision: string;
    dirty: boolean;
    platform: string;
    lockfileSha256: string;
    sourceDigest: string;
    runtime: {
        bun: string;
        nuxt: string;
        nitro: string;
    };
    runtimeContract: {
        path: typeof PRODUCT_RUNTIME_CONTRACT_PATH;
        sha256: string;
    };
    inventory: {
        files: number;
        bytes: number;
        owners: ProductRuntimeOwnerInventory[];
    };
    treeDigest: string;
    shapeDigest: string;
    createdAt: string;
}

/** 只有 manifest、ready marker 与 payload 全部互相吻合时才返回此句柄。 */
export interface VerifiedProductRuntimeImage {
    path: string;
    manifest: ProductRuntimeImageManifest;
}

/**
 * 只证明 ready 控制面和运行合同完整；不证明全部 payload digest。
 * 仅供 status/discovery 展示，不能用于执行、激活、安装或归档 Product。
 */
export interface ProductRuntimeImageControlPlane {
    path: string;
    manifest: ProductRuntimeImageManifest;
}

interface SourceSnapshot {
    version: string;
    revision: string;
    dirty: boolean;
    lockfileSha256: string;
    sourceDigest: string;
    /** 首次快照锁定的 tracked + untracked Source 路径，后续复核复用以避免重复 Git 枚举。 */
    sourcePaths: string[];
    /** 仅供构建竞态诊断；不会写入 Runtime Image manifest。 */
    sourceEntries: Map<string, string>;
    /** 用于报告构建期间新增、删除或状态变化的 dirty path。 */
    statusResult: string;
}

interface RuntimeFileRecord {
    relativePath: string;
    kind: "file" | "symlink";
    bytes: number;
    mode: number;
    contentDigest: string;
}

interface RuntimeInspection {
    files: number;
    bytes: number;
    owners: ProductRuntimeOwnerInventory[];
    treeDigest: string;
    shapeDigest: string;
}

interface ReadyMarker {
    schema: typeof READY_SCHEMA;
    imageId: string;
    manifestSha256: string;
}

interface RuntimeControlPlaneState extends ProductRuntimeImageControlPlane {
    manifestPath: string;
    markerPath: string;
    runtimeContractPath: string;
    manifestText: string;
    markerText: string;
    runtimeContractText: string;
}

/**
 * 统一拥有 Product Runtime Image 的候选构建、身份生成和只读验证。
 *
 * 写侧只有 `buildCandidate`；读侧按用途区分轻量控制面和完整 payload 验证。
 * 调用方不能绕过 Source 竞态检查自行写 manifest，也不能把“目录存在”误当成 ready。
 */
export class ProductRuntimeImageBuilder {
    private readonly projectRoot: string;

    /** 绑定一个 Source Root；候选始终写入该根的 `.deploy/staging`。 */
    constructor(projectRoot = process.cwd()) {
        this.projectRoot = resolve(projectRoot);
    }

    /**
     * 在隔离目录构建候选，验证 Source 前后未变化，并最后写 ready marker。
     * 任何失败都会删除本次未 ready 候选，不触碰当前 `.output`。
     */
    async buildCandidate(request: ProductRuntimeBuildRequest): Promise<VerifiedProductRuntimeImage> {
        assertOperationId(request.operationId);
        assertPlatform(request.platform);
        const owners = normalizeOwners(request.owners);
        assertBudgetDefinition(request.budget, owners);

        const stagingRoot = resolve(this.projectRoot, ".deploy", "staging");
        const stagingLeaseRoot = resolve(this.projectRoot, ".deploy", "staging-leases");
        const imageRoot = resolve(stagingRoot, request.operationId);
        const scratchRoot = resolve(imageRoot, ".build-scratch");
        const leaseTarget = resolve(stagingLeaseRoot, request.operationId);
        assertContainedPath(stagingRoot, imageRoot, "候选目录");
        assertContainedPath(imageRoot, scratchRoot, "构建临时目录");
        await mkdir(stagingRoot, {recursive: true});
        await mkdir(stagingLeaseRoot, {recursive: true});
        await this.sweepStaleStaging(stagingRoot, stagingLeaseRoot);
        if (await pathExists(imageRoot)) {
            throw new Error(`Product Runtime Image operation 已存在：${request.operationId}`);
        }

        const before = await this.sourceSnapshot(request.platform, undefined, request.expectedSource);
        assertBuildExpectation(before, request.platform, request.expectedSource);
        await mkdir(imageRoot, {recursive: false});
        const startedAt = new Date().toISOString();
        let releaseStagingLease: (() => Promise<void>) | undefined;
        try {
            await writeFile(leaseTarget, `${JSON.stringify({
                schema: STAGING_OWNER_SCHEMA,
                operationId: request.operationId,
                pid: process.pid,
                createdAt: startedAt,
            })}\n`, {encoding: "utf8", flag: "wx"});
            releaseStagingLease = await acquireFileLock(leaseTarget, {
                realpath: false,
                stale: STAGING_LEASE_STALE_MS,
                update: STAGING_LEASE_UPDATE_MS,
                retries: 0,
            });
        } catch (error) {
            await rm(imageRoot, {recursive: true, force: true});
            await rm(leaseTarget, {force: true});
            throw error;
        }

        try {
            await request.build({
                imageRoot,
                scratchRoot,
                operationId: request.operationId,
                sourceDigest: before.sourceDigest,
            });
            await rm(scratchRoot, {recursive: true, force: true});
            if (await pathExists(resolve(imageRoot, MANIFEST_FILE)) || await pathExists(resolve(imageRoot, READY_FILE))) {
                throw new Error("Product build 回调不得自行写入 runtime-image manifest 或 ready marker。");
            }

            const afterBuild = await this.sourceSnapshot(request.platform, before.sourcePaths, request.expectedSource);
            assertSameSource(before, afterBuild);
            const runtimeContractText = await readControlFile(
                resolve(imageRoot, ...PRODUCT_RUNTIME_CONTRACT_PATH.split("/")),
                "Product Runtime Contract",
            );
            const runtimeContract = parseProductRuntimeContract(JSON.parse(runtimeContractText) as unknown);
            await assertProductRuntimeContractFiles(runtimeContract, imageRoot);
            const inspection = await inspectRuntimeImage(imageRoot, owners);
            assertBudget(inspection, request.budget);
            const runtime = await this.runtimeVersions();
            const createdAt = new Date().toISOString();
            const identityPayload: Omit<ProductRuntimeImageManifest, "imageId" | "createdAt"> = {
                schema: MANIFEST_SCHEMA,
                builderContractVersion: BUILDER_CONTRACT_VERSION,
                version: before.version,
                revision: before.revision,
                dirty: before.dirty,
                platform: request.platform,
                lockfileSha256: before.lockfileSha256,
                sourceDigest: before.sourceDigest,
                runtime,
                runtimeContract: {
                    path: PRODUCT_RUNTIME_CONTRACT_PATH,
                    sha256: productRuntimeContractSha256(runtimeContractText),
                },
                inventory: {
                    files: inspection.files,
                    bytes: inspection.bytes,
                    owners: inspection.owners,
                },
                treeDigest: inspection.treeDigest,
                shapeDigest: inspection.shapeDigest,
            };
            const manifest: ProductRuntimeImageManifest = {
                ...identityPayload,
                imageId: sha256Text(canonicalJson(identityPayload)),
                createdAt,
            };
            const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
            await writeFile(resolve(imageRoot, MANIFEST_FILE), manifestText, {encoding: "utf8", flag: "wx"});
            const marker: ReadyMarker = {
                schema: READY_SCHEMA,
                imageId: manifest.imageId,
                manifestSha256: sha256Text(manifestText),
            };
            await writeFile(resolve(imageRoot, READY_FILE), `${JSON.stringify(marker)}\n`, {encoding: "utf8", flag: "wx"});

            const verified = await this.openVerified(imageRoot, {
                version: manifest.version,
                revision: manifest.revision,
                dirty: manifest.dirty,
                platform: manifest.platform,
                imageId: manifest.imageId,
                lockfileSha256: manifest.lockfileSha256,
                sourceDigest: manifest.sourceDigest,
            });
            const afterVerification = await this.sourceSnapshot(request.platform, before.sourcePaths, request.expectedSource);
            assertSameSource(before, afterVerification);
            return verified;
        } catch (error) {
            await rm(imageRoot, {recursive: true, force: true});
            throw error;
        } finally {
            await writeFile(leaseTarget, `${JSON.stringify({
                schema: STAGING_OWNER_SCHEMA,
                operationId: request.operationId,
                pid: process.pid,
                createdAt: startedAt,
                completedAt: new Date().toISOString(),
            })}\n`, "utf8");
            try {
                await releaseStagingLease();
            } finally {
                // ready candidate 自身已是不可变 owner；operation lease 只描述活跃构建，完成后不能留下孤立 marker。
                await rm(leaseTarget, {force: true});
            }
        }
    }

    /**
     * 回收超过 24 小时且无法证明仍有活跃 owner 的候选，并清理已经失去 candidate 的 marker。
     * proper-lockfile 的 lock mtime 是 heartbeat；只有成功取得同一 lease 才允许删除。
     */
    private async sweepStaleStaging(stagingRoot: string, leaseRoot: string): Promise<void> {
        const entries = await readdir(stagingRoot, {withFileTypes: true});
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(entry.name)) {
                continue;
            }
            const candidatePath = resolve(stagingRoot, entry.name);
            const leaseTarget = resolve(leaseRoot, entry.name);
            const lockPath = `${leaseTarget}.lock`;
            const heartbeatPath = await pathExists(lockPath) ? lockPath : await pathExists(leaseTarget) ? leaseTarget : candidatePath;
            if (Date.now() - (await stat(heartbeatPath)).mtimeMs <= STAGING_LEASE_STALE_MS) {
                continue;
            }
            if (!await pathExists(leaseTarget)) {
                await writeFile(leaseTarget, "stale staging candidate without owner marker\n", {encoding: "utf8", flag: "wx"});
            }
            let release: (() => Promise<void>) | undefined;
            try {
                release = await acquireFileLock(leaseTarget, {
                    realpath: false,
                    stale: STAGING_LEASE_STALE_MS,
                    update: STAGING_LEASE_UPDATE_MS,
                    retries: 0,
                });
            } catch (error) {
                if (isLockContention(error)) continue;
                throw error;
            }
            await release();
            await rm(candidatePath, {recursive: true, force: true});
            await rm(leaseTarget, {force: true});
        }

        // candidate 被 Publisher 移走或旧进程在收尾阶段中断时，marker 可能单独遗留。
        // 取得同一 lease 并在持锁期间复核 candidate，避免删除仍有活跃 owner 的 marker。
        const leaseEntries = await readdir(leaseRoot, {withFileTypes: true});
        for (const entry of leaseEntries) {
            if (!entry.isFile() || entry.isSymbolicLink() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(entry.name)) {
                continue;
            }
            const candidatePath = resolve(stagingRoot, entry.name);
            if (await pathExists(candidatePath)) continue;
            const leaseTarget = resolve(leaseRoot, entry.name);
            let release: (() => Promise<void>) | undefined;
            try {
                release = await acquireFileLock(leaseTarget, {
                    realpath: false,
                    stale: STAGING_LEASE_STALE_MS,
                    update: STAGING_LEASE_UPDATE_MS,
                    retries: 0,
                });
            } catch (error) {
                if (isLockContention(error)) continue;
                throw error;
            }
            try {
                if (!await pathExists(candidatePath)) {
                    await rm(leaseTarget, {force: true});
                }
            } finally {
                await release();
            }
        }
    }

    /**
     * 重新证明 ready marker、manifest 身份、payload digests 与 owner inventory。
     * 缺字段、未知 schema、路径逃逸或任何 expected identity 不一致都直接失败。
     */
    async openVerified(imagePath: string, expectedIdentity: ProductRuntimeExpectedIdentity): Promise<VerifiedProductRuntimeImage> {
        const control = await this.readControlPlane(imagePath, expectedIdentity);
        const inspection = await inspectRuntimeImage(control.path, control.manifest.inventory.owners);
        if (inspection.treeDigest !== control.manifest.treeDigest || inspection.shapeDigest !== control.manifest.shapeDigest) {
            throw new Error("Product Runtime Image payload digest 不一致，镜像可能被篡改或未完整写入。");
        }
        if (inspection.files !== control.manifest.inventory.files || inspection.bytes !== control.manifest.inventory.bytes
            || canonicalJson(inspection.owners) !== canonicalJson(control.manifest.inventory.owners)) {
            throw new Error("Product Runtime Image owner inventory 与实际 payload 不一致。");
        }
        await this.assertControlPlaneUnchanged(control);
        return {path: control.path, manifest: control.manifest};
    }

    /**
     * 验证 manifest、ready marker、运行合同摘要与全部合同入口，不遍历 payload。
     * 该结果只适合只读状态展示；任何会执行或分发 Product 的调用方必须使用 `openVerified`。
     */
    async openControlPlane(
        imagePath: string,
        expectedIdentity: ProductRuntimeExpectedIdentity,
    ): Promise<ProductRuntimeImageControlPlane> {
        const control = await this.readControlPlane(imagePath, expectedIdentity);
        await this.assertControlPlaneUnchanged(control);
        return {path: control.path, manifest: control.manifest};
    }

    /** 读取并严格验证一代 Runtime Image 的全部控制文件。 */
    private async readControlPlane(
        imagePath: string,
        expectedIdentity: ProductRuntimeExpectedIdentity,
    ): Promise<RuntimeControlPlaneState> {
        assertExpectedIdentity(expectedIdentity);
        const imageRoot = resolve(imagePath);
        const rootInfo = await lstat(imageRoot);
        if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
            throw new Error(`Product Runtime Image 根必须是真实目录：${imageRoot}`);
        }

        const manifestPath = resolve(imageRoot, MANIFEST_FILE);
        const markerPath = resolve(imageRoot, READY_FILE);
        const manifestText = await readControlFile(manifestPath, "runtime-image manifest");
        const markerText = await readControlFile(markerPath, "runtime-image ready marker");
        const manifest = parseManifest(manifestText);
        const marker = parseReadyMarker(markerText);
        if (marker.imageId !== manifest.imageId || marker.manifestSha256 !== sha256Text(manifestText)) {
            throw new Error("Product Runtime Image ready marker 与 manifest 不一致。");
        }
        if (manifest.imageId !== manifestImageId(manifest)) {
            throw new Error("Product Runtime Image imageId 无法由 manifest 身份重建。");
        }
        assertIdentity(manifest, expectedIdentity);

        const runtimeContractPath = resolve(imageRoot, ...manifest.runtimeContract.path.split("/"));
        const runtimeContractText = await readControlFile(runtimeContractPath, "Product Runtime Contract");
        if (productRuntimeContractSha256(runtimeContractText) !== manifest.runtimeContract.sha256) {
            throw new Error("Product Runtime Image runtime contract 摘要与 manifest 不一致。");
        }
        const runtimeContract = parseProductRuntimeContract(JSON.parse(runtimeContractText) as unknown);
        await assertProductRuntimeContractFiles(runtimeContract, imageRoot);
        return {
            path: imageRoot,
            manifest,
            manifestPath,
            markerPath,
            runtimeContractPath,
            manifestText,
            markerText,
            runtimeContractText,
        };
    }

    /** 防止检查期间另一进程替换控制文件并返回混合代次。 */
    private async assertControlPlaneUnchanged(control: RuntimeControlPlaneState): Promise<void> {
        if (await readControlFile(control.manifestPath, "runtime-image manifest") !== control.manifestText
            || await readControlFile(control.markerPath, "runtime-image ready marker") !== control.markerText
            || await readControlFile(control.runtimeContractPath, "Product Runtime Contract") !== control.runtimeContractText) {
            throw new Error("Product Runtime Image 在验证期间发生变化。");
        }
    }

    /** 读取并摘要当前 Git Source、lockfile 与目标平台身份。 */
    private async sourceSnapshot(
        platform: string,
        knownSourcePaths?: readonly string[],
        expectation?: ProductRuntimeBuildExpectation,
    ): Promise<SourceSnapshot> {
        const packagePath = resolve(this.projectRoot, "package.json");
        const lockfilePath = resolve(this.projectRoot, "bun.lock");
        const [packageText, lockfileSha256] = await Promise.all([
            readFile(packagePath, "utf8"),
            sha256File(lockfilePath),
        ]);
        const version = packageVersion(packageText, packagePath);
        const gitBacked = await pathExists(resolve(this.projectRoot, ".git"));
        let revision: string;
        let dirty: boolean;
        let statusResult: string;
        let sourcePaths: string[];
        if (gitBacked) {
            // porcelain v2 的 branch.oid 与变更集合来自同一次 index snapshot，避免分开读取形成混合身份。
            statusResult = await runCapture("git", [
                "status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all",
            ], this.projectRoot);
            revision = statusResult.split("\0")
                .find((entry) => entry.startsWith("# branch.oid "))
                ?.slice("# branch.oid ".length)
                .trim() ?? "";
            dirty = statusResult.split("\0").some((entry) => entry.length > 0 && !entry.startsWith("# "));
            const trackedResult = knownSourcePaths
                ? undefined
                : await runCapture("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], this.projectRoot);
            sourcePaths = [...new Set([
                ...(knownSourcePaths ?? trackedResult!.split("\0").filter(Boolean)),
                "package.json",
                "bun.lock",
            ])].sort(compareText);
        } else {
            if (!expectation?.revision || expectation.dirty !== false) {
                throw new Error("Git-less Product build 必须显式提供 expectedSource.revision 与 dirty=false。");
            }
            revision = expectation.revision;
            dirty = false;
            statusResult = "gitless-source\0";
            // Git-less Docker context 没有 porcelain 变化集合，因此每次都重新枚举以发现新增和删除。
            sourcePaths = await gitlessSourcePaths(this.projectRoot);
        }
        if (!/^[0-9a-f]{40,64}$/i.test(revision)) {
            throw new Error(`无法读取有效 Source revision：${revision || "empty"}`);
        }
        const sourceHash = createHash("sha256");
        const sourceEntries = new Map<string, string>();
        // branch/upstream 与 index staging 只是 Git 操作状态；同 revision、dirty 语义和文件内容必须得到同一 Source identity。
        sourceHash.update(`platform\0${platform}\0revision\0${revision}\0dirty\0${dirty ? "1" : "0"}\0`);
        for (const trackedPath of sourcePaths) {
            const normalized = normalizeRelativePath(trackedPath, "Git Source input");
            const absolutePath = resolve(this.projectRoot, ...normalized.split("/"));
            assertContainedPath(this.projectRoot, absolutePath, `Git Source input ${normalized}`);
            let info: Awaited<ReturnType<typeof lstat>>;
            try {
                info = await lstat(absolutePath);
            } catch (error) {
                if (isNodeError(error) && error.code === "ENOENT") {
                    // `git ls-files --cached` 会保留 worktree 中已删除的 tracked path；删除本身也是稳定输入。
                    sourceEntries.set(normalized, "missing");
                    sourceHash.update(`${normalized}\0missing\n`);
                    continue;
                }
                throw error;
            }
            if (!info.isFile() && !info.isSymbolicLink()) {
                throw new Error(`Git Source input 不是普通文件：${normalized}`);
            }
            const contentDigest = info.isSymbolicLink()
                ? sha256Text(await readlink(absolutePath))
                : await sha256File(absolutePath);
            sourceEntries.set(
                normalized,
                `${info.isSymbolicLink() ? "symlink" : "file"}:${info.mode & 0o777}:${info.size}:${contentDigest}`,
            );
            sourceHash.update(`${normalized}\0${info.mode & 0o777}\0${info.size}\0${contentDigest}\n`);
        }
        return {
            version,
            revision,
            dirty,
            lockfileSha256,
            sourceDigest: `sha256:${sourceHash.digest("hex")}`,
            sourcePaths,
            sourceEntries,
            statusResult,
        };
    }

    /** 从真实构建宿主和已安装包读取版本，不接受调用方伪造。 */
    private async runtimeVersions(): Promise<ProductRuntimeImageManifest["runtime"]> {
        const bun = process.versions.bun
            ?? (await runCapture("bun", ["--version"], this.projectRoot)).trim();
        if (!bun) {
            throw new Error("无法读取 Bun 版本。");
        }
        const [nuxt, nitro] = await Promise.all([
            installedPackageVersion(this.projectRoot, "nuxt"),
            installedPackageVersion(this.projectRoot, "nitropack"),
        ]);
        return {bun, nuxt, nitro};
    }
}

/** 扫描 payload，拒绝外部 symlink，并生成内容与 shape 两种 digest。 */
async function inspectRuntimeImage(imageRoot: string, ownerInput: readonly ProductRuntimeImageOwner[]): Promise<RuntimeInspection> {
    const owners = normalizeOwners(ownerInput);
    const rootRealPath = await realpath(imageRoot);
    const pending: Array<{absolutePath: string; relativePath: string}> = [];

    /** 目录顺序固定，确保不同文件系统返回相同 shape。 */
    async function walk(directory: string, relativeDirectory: string): Promise<void> {
        const entries = await readdir(directory, {withFileTypes: true});
        entries.sort((left, right) => compareText(left.name, right.name));
        for (const entry of entries) {
            const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
            if (!relativeDirectory && (relativePath === MANIFEST_FILE || relativePath === READY_FILE)) {
                continue;
            }
            const absolutePath = resolve(directory, entry.name);
            const info = await lstat(absolutePath);
            if (info.isDirectory() && !info.isSymbolicLink()) {
                assertContainedPath(rootRealPath, await realpath(absolutePath), `目录 ${relativePath}`);
                await walk(absolutePath, relativePath);
            } else {
                pending.push({absolutePath, relativePath});
            }
        }
    }

    await walk(imageRoot, "");
    const records: RuntimeFileRecord[] = [];
    for (let offset = 0; offset < pending.length; offset += 24) {
        const batch = pending.slice(offset, offset + 24);
        records.push(...await Promise.all(batch.map(async ({absolutePath, relativePath}) => {
            const before = await lstat(absolutePath);
            if (before.isSymbolicLink()) {
                const target = await readlink(absolutePath);
                if (isAbsolute(target) || win32.isAbsolute(target) || posix.isAbsolute(target)) {
                    throw new Error(`Product Runtime Image 不接受绝对 symlink：${relativePath} -> ${target}`);
                }
                const targetRealPath = await realpath(absolutePath);
                assertContainedPath(rootRealPath, targetRealPath, `symlink ${relativePath}`);
                const targetInfo = await stat(absolutePath);
                if (!targetInfo.isFile() && !targetInfo.isDirectory()) {
                    throw new Error(`Product Runtime Image symlink 目标类型不受支持：${relativePath}`);
                }
                return {
                    relativePath,
                    kind: "symlink" as const,
                    bytes: Buffer.byteLength(target),
                    mode: before.mode & 0o777,
                    contentDigest: sha256Text(target),
                };
            }
            if (!before.isFile()) {
                throw new Error(`Product Runtime Image 包含不受支持的文件类型：${relativePath}`);
            }
            const contentDigest = await sha256File(absolutePath);
            const after = await lstat(absolutePath);
            if (!after.isFile() || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
                throw new Error(`Product Runtime Image 文件在摘要期间变化：${relativePath}`);
            }
            return {
                relativePath,
                kind: "file" as const,
                bytes: after.size,
                mode: after.mode & 0o777,
                contentDigest,
            };
        })));
    }
    records.sort((left, right) => compareText(left.relativePath, right.relativePath));
    if (records.length === 0) {
        throw new Error("Product Runtime Image payload 为空。");
    }

    const inventories = owners.map((owner) => ({name: owner.name, paths: [...owner.paths], files: 0, bytes: 0}));
    const treeHash = createHash("sha256");
    const shapeHash = createHash("sha256");
    let bytes = 0;
    for (const record of records) {
        const matches = owners
            .map((owner, index) => ({owner, index}))
            .filter(({owner}) => owner.paths.some((ownerPath) => pathOwnedBy(record.relativePath, ownerPath)));
        if (matches.length !== 1) {
            const names = matches.map(({owner}) => owner.name).join(", ") || "none";
            throw new Error(`Product Runtime Image 文件必须恰好属于一个 owner：${record.relativePath}（${names}）`);
        }
        const inventory = inventories[matches[0]!.index]!;
        inventory.files += 1;
        inventory.bytes += record.bytes;
        bytes += record.bytes;
        treeHash.update(`${record.relativePath}\0${record.kind}\0${record.bytes}\0${record.mode}\0${record.contentDigest}\n`);
        shapeHash.update(`${record.relativePath}\0${record.kind}\n`);
    }
    inventories.sort((left, right) => compareText(left.name, right.name));
    return {
        files: records.length,
        bytes,
        owners: inventories,
        treeDigest: `sha256:${treeHash.digest("hex")}`,
        shapeDigest: `sha256:${shapeHash.digest("hex")}`,
    };
}

/** 将 owner 路径正规化并拒绝名字、路径歧义。 */
function normalizeOwners(input: readonly ProductRuntimeImageOwner[]): ProductRuntimeImageOwner[] {
    if (input.length === 0) {
        throw new Error("Product Runtime Image 至少需要一个 owner。");
    }
    const names = new Set<string>();
    return input.map((owner) => {
        if (!owner.name.trim() || owner.name !== owner.name.trim() || /[\u0000-\u001f]/u.test(owner.name)) {
            throw new Error(`Product Runtime Image owner 名称无效：${JSON.stringify(owner.name)}`);
        }
        if (names.has(owner.name)) {
            throw new Error(`Product Runtime Image owner 名称重复：${owner.name}`);
        }
        names.add(owner.name);
        if (owner.paths.length === 0) {
            throw new Error(`Product Runtime Image owner 没有路径：${owner.name}`);
        }
        const paths = [...new Set(owner.paths.map((ownerPath) => normalizeRelativePath(ownerPath, `owner ${owner.name}`)))]
            .sort(compareText);
        return {name: owner.name, paths};
    }).sort((left, right) => compareText(left.name, right.name));
}

/** 校验总预算与每个 owner 的固定 10% 回归门禁。 */
function assertBudget(inspection: RuntimeInspection, budget: ProductRuntimeImageBudget): void {
    if (inspection.files > budget.maxFiles || inspection.bytes > budget.maxBytes) {
        throw new Error(
            `Product Runtime Image 超出总预算：${inspection.files}/${budget.maxFiles} files，`
            + `${inspection.bytes}/${budget.maxBytes} bytes。`,
        );
    }
    const baselines = new Map(budget.ownerBaselines.map((baseline) => [baseline.name, baseline]));
    for (const owner of inspection.owners) {
        const baseline = baselines.get(owner.name);
        if (!baseline) throw new Error(`Product Runtime Image 缺少 owner 登记基线：${owner.name}`);
        const maxFiles = Math.floor(baseline.files * (1 + OWNER_GROWTH_LIMIT));
        const maxBytes = Math.floor(baseline.bytes * (1 + OWNER_GROWTH_LIMIT));
        if (owner.files > maxFiles || owner.bytes > maxBytes) {
            throw new Error(
                `Product Runtime Image owner 超出登记基线 10%：${owner.name} `
                + `${owner.files}/${maxFiles} files，${owner.bytes}/${maxBytes} bytes。`,
            );
        }
    }
}

/** 在扫描前先拒绝无效预算，避免构建完成后才暴露配置错误。 */
function assertBudgetDefinition(budget: ProductRuntimeImageBudget, owners: readonly ProductRuntimeImageOwner[]): void {
    assertNonNegativeInteger(budget.maxFiles, "maxFiles");
    assertNonNegativeInteger(budget.maxBytes, "maxBytes");
    if (!Array.isArray(budget.ownerBaselines)) {
        throw new Error("Product Runtime Image ownerBaselines 必须是数组。");
    }
    const ownerNames = new Set(owners.map((owner) => owner.name));
    const baselineNames = new Set<string>();
    for (const baseline of budget.ownerBaselines) {
        if (!ownerNames.has(baseline.name)) {
            throw new Error(`Product Runtime Image baseline 指向未知 owner：${baseline.name}`);
        }
        if (baselineNames.has(baseline.name)) {
            throw new Error(`Product Runtime Image owner baseline 重复：${baseline.name}`);
        }
        baselineNames.add(baseline.name);
        assertNonNegativeInteger(baseline.files, `${baseline.name}.files`);
        assertNonNegativeInteger(baseline.bytes, `${baseline.name}.bytes`);
    }
    for (const owner of owners) {
        if (!baselineNames.has(owner.name)) {
            throw new Error(`Product Runtime Image 缺少 owner 登记基线：${owner.name}`);
        }
    }
}

/** 对照调用方锁定的 Source 代次；提供了哪个字段就严格比较哪个字段。 */
function assertBuildExpectation(
    snapshot: SourceSnapshot,
    platform: string,
    expected: ProductRuntimeBuildExpectation | undefined,
): void {
    if (!expected) return;
    const actual = {...snapshot, platform};
    for (const key of ["version", "revision", "dirty", "lockfileSha256"] as const) {
        if (expected[key] !== undefined && expected[key] !== actual[key]) {
            throw new Error(`Product build Source 身份不一致：${key} expected=${String(expected[key])} actual=${String(actual[key])}`);
        }
    }
}

/** Source 的任意输入或 dirty 集合在构建期间变化都拒绝发布。 */
function assertSameSource(before: SourceSnapshot, after: SourceSnapshot): void {
    for (const key of ["version", "revision", "dirty", "lockfileSha256", "sourceDigest"] as const) {
        if (before[key] !== after[key]) {
            const details = key === "dirty" || key === "sourceDigest" ? sourceSnapshotDiff(before, after) : [];
            throw new Error([
                `Product build 期间 Source 输入发生变化：${key}`,
                ...details.map((detail) => `- ${detail}`),
            ].join("\n"));
        }
    }
}

/** 把摘要变化还原为可操作路径；最多报告 20 项，避免巨型 dirty worktree 淹没日志。 */
function sourceSnapshotDiff(before: SourceSnapshot, after: SourceSnapshot): string[] {
    const details: string[] = [];
    const paths = new Set([...before.sourceEntries.keys(), ...after.sourceEntries.keys()]);
    for (const path of [...paths].sort(compareText)) {
        if (before.sourceEntries.get(path) === after.sourceEntries.get(path)) continue;
        details.push(`内容变化：${path}`);
        if (details.length >= 20) return details;
    }
    if (before.statusResult !== after.statusResult) {
        const beforeStatus = new Set(before.statusResult.split("\0"));
        for (const entry of after.statusResult.split("\0")) {
            if (!entry || entry.startsWith("# ") || beforeStatus.has(entry)) continue;
            details.push(`Git 状态变化：${entry.slice(0, 240)}`);
            if (details.length >= 20) break;
        }
    }
    if (details.length === 0) details.push("Source 集合摘要变化，但没有可枚举的路径差异");
    return details;
}

/** 将 manifest 可复算身份稳定投影为 image ID。 */
function manifestImageId(manifest: ProductRuntimeImageManifest): string {
    return sha256Text(canonicalJson({
        schema: manifest.schema,
        builderContractVersion: manifest.builderContractVersion,
        version: manifest.version,
        revision: manifest.revision,
        dirty: manifest.dirty,
        platform: manifest.platform,
        lockfileSha256: manifest.lockfileSha256,
        sourceDigest: manifest.sourceDigest,
        runtime: manifest.runtime,
        runtimeContract: manifest.runtimeContract,
        inventory: manifest.inventory,
        treeDigest: manifest.treeDigest,
        shapeDigest: manifest.shapeDigest,
    }));
}

/** expected identity 是消费方与 Builder 之间的 fail-closed 代次合同。 */
function assertIdentity(manifest: ProductRuntimeImageManifest, expected: ProductRuntimeExpectedIdentity): void {
    for (const key of ["version", "revision", "dirty", "platform", "imageId", "lockfileSha256", "sourceDigest"] as const) {
        if (expected[key] !== undefined && expected[key] !== manifest[key]) {
            throw new Error(`Product Runtime Image 身份不一致：${key} expected=${String(expected[key])} actual=${String(manifest[key])}`);
        }
    }
}

/** 解析外部 manifest；unknown 是刻意的，因为磁盘 JSON 在验证前不可信。 */
function parseManifest(text: string): ProductRuntimeImageManifest {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new Error(`Product Runtime Image manifest 不是有效 JSON：${String(error)}`);
    }
    const record = plainObject(value, "runtime-image manifest");
    assertExactKeys(record, [
        "schema", "builderContractVersion", "imageId", "version", "revision", "dirty", "platform",
        "lockfileSha256", "sourceDigest", "runtime", "runtimeContract", "inventory", "treeDigest", "shapeDigest", "createdAt",
    ], "runtime-image manifest");
    if (record.schema !== MANIFEST_SCHEMA || record.builderContractVersion !== BUILDER_CONTRACT_VERSION) {
        throw new Error("Product Runtime Image manifest schema 或 Builder 合同版本不受支持。");
    }
    const runtime = plainObject(record.runtime, "runtime-image runtime");
    assertExactKeys(runtime, ["bun", "nuxt", "nitro"], "runtime-image runtime");
    const runtimeContract = plainObject(record.runtimeContract, "runtime-image runtimeContract");
    assertExactKeys(runtimeContract, ["path", "sha256"], "runtime-image runtimeContract");
    if (runtimeContract.path !== PRODUCT_RUNTIME_CONTRACT_PATH || !isSha256(runtimeContract.sha256)) {
        throw new Error("Product Runtime Image runtimeContract identity 无效。");
    }
    const inventory = plainObject(record.inventory, "runtime-image inventory");
    assertExactKeys(inventory, ["files", "bytes", "owners"], "runtime-image inventory");
    if (!Array.isArray(inventory.owners)) {
        throw new Error("Product Runtime Image inventory.owners 必须是数组。");
    }
    const owners = inventory.owners.map((ownerValue, index) => {
        const owner = plainObject(ownerValue, `runtime-image owner[${index}]`);
        assertExactKeys(owner, ["name", "paths", "files", "bytes"], `runtime-image owner[${index}]`);
        if (typeof owner.name !== "string" || !Array.isArray(owner.paths) || !owner.paths.every((path) => typeof path === "string")) {
            throw new Error(`Product Runtime Image owner[${index}] identity 无效。`);
        }
        assertNonNegativeInteger(owner.files, `owner[${index}].files`);
        assertNonNegativeInteger(owner.bytes, `owner[${index}].bytes`);
        return {name: owner.name, paths: owner.paths, files: owner.files, bytes: owner.bytes};
    });
    normalizeOwners(owners);
    assertNonNegativeInteger(inventory.files, "inventory.files");
    assertNonNegativeInteger(inventory.bytes, "inventory.bytes");
    for (const [label, field] of [
        ["imageId", record.imageId],
        ["lockfileSha256", record.lockfileSha256],
        ["sourceDigest", record.sourceDigest],
        ["treeDigest", record.treeDigest],
        ["shapeDigest", record.shapeDigest],
    ] as const) {
        if (!isSha256(field)) throw new Error(`Product Runtime Image ${label} 无效。`);
    }
    for (const [label, field] of [
        ["version", record.version], ["revision", record.revision], ["platform", record.platform],
        ["runtime.bun", runtime.bun], ["runtime.nuxt", runtime.nuxt], ["runtime.nitro", runtime.nitro],
        ["createdAt", record.createdAt],
    ] as const) {
        if (typeof field !== "string" || !field) throw new Error(`Product Runtime Image ${label} 无效。`);
    }
    if (typeof record.dirty !== "boolean" || Number.isNaN(Date.parse(record.createdAt as string))) {
        throw new Error("Product Runtime Image dirty 或 createdAt 无效。");
    }
    if (!/^[0-9a-f]{40,64}$/iu.test(record.revision as string)) {
        throw new Error("Product Runtime Image revision 不是 Git object ID。");
    }
    return {
        schema: MANIFEST_SCHEMA,
        builderContractVersion: BUILDER_CONTRACT_VERSION,
        imageId: record.imageId as string,
        version: record.version as string,
        revision: record.revision as string,
        dirty: record.dirty,
        platform: record.platform as string,
        lockfileSha256: record.lockfileSha256 as string,
        sourceDigest: record.sourceDigest as string,
        runtime: {bun: runtime.bun as string, nuxt: runtime.nuxt as string, nitro: runtime.nitro as string},
        runtimeContract: {
            path: PRODUCT_RUNTIME_CONTRACT_PATH,
            sha256: runtimeContract.sha256,
        },
        inventory: {files: inventory.files, bytes: inventory.bytes, owners},
        treeDigest: record.treeDigest as string,
        shapeDigest: record.shapeDigest as string,
        createdAt: record.createdAt as string,
    };
}

/** 解析并严格校验最后写入的 ready marker。 */
function parseReadyMarker(text: string): ReadyMarker {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new Error(`Product Runtime Image ready marker 不是有效 JSON：${String(error)}`);
    }
    const marker = plainObject(value, "runtime-image ready marker");
    assertExactKeys(marker, ["schema", "imageId", "manifestSha256"], "runtime-image ready marker");
    if (marker.schema !== READY_SCHEMA || !isSha256(marker.imageId) || !isSha256(marker.manifestSha256)) {
        throw new Error("Product Runtime Image ready marker 字段无效。");
    }
    return {schema: READY_SCHEMA, imageId: marker.imageId, manifestSha256: marker.manifestSha256};
}

/** 控制文件必须是有大小上限的普通文件，不能借 symlink 读取候选外内容。 */
async function readControlFile(filePath: string, label: string): Promise<string> {
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_CONTROL_FILE_BYTES) {
        throw new Error(`Product Runtime Image ${label} 不是有效普通文件。`);
    }
    return await readFile(filePath, "utf8");
}

/** 读取 package.json 的版本字段。 */
function packageVersion(text: string, source: string): string {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new Error(`${source} 不是有效 JSON：${String(error)}`);
    }
    const record = plainObject(value, source);
    if (typeof record.version !== "string" || !record.version) {
        throw new Error(`${source} 缺少 version。`);
    }
    return record.version;
}

/** 从安装树读取实际 Nuxt/Nitro 版本。 */
async function installedPackageVersion(projectRoot: string, packageName: string): Promise<string> {
    const packagePath = resolve(projectRoot, "node_modules", ...packageName.split("/"), "package.json");
    return packageVersion(await readFile(packagePath, "utf8"), packagePath);
}

/** 使用流式 SHA-256，避免大 Product 文件进入进程内存。 */
async function sha256File(filePath: string): Promise<string> {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(filePath)) {
        hash.update(chunk);
    }
    return `sha256:${hash.digest("hex")}`;
}

/** 生成统一带算法前缀的文本摘要。 */
function sha256Text(text: string): string {
    return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

/** JSON key 排序后序列化，保证 manifest key 顺序变化不影响 image ID。 */
function canonicalJson(value: unknown): string {
    if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error("canonical JSON 不接受非有限数字。");
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
    if (typeof value === "object") {
        // generic canonicalizer 必须从 unknown 收窄；这里只接受普通 JSON object。
        const record = value as {[key: string]: unknown};
        return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
    }
    throw new Error(`canonical JSON 不接受 ${typeof value}。`);
}

/** 执行只读身份命令并保留 NUL 输出。 */
async function runCapture(command: string, args: string[], cwd: string): Promise<string> {
    try {
        const result = await execFileAsync(command, args, {
            cwd,
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
            windowsHide: true,
        });
        return result.stdout;
    } catch (error) {
        throw new Error(`执行 ${command} ${args.join(" ")} 失败：${String(error)}`);
    }
}

/**
 * 枚举 Git-less Docker build context 的 Source 输入。
 * 排除集合与 `.dockerignore` 的生成态目录一致；node_modules 由 lockfile 表达，不属于 Source。
 */
async function gitlessSourcePaths(projectRoot: string): Promise<string[]> {
    const paths: string[] = [];
    const walk = async (directory: string, segments: string[]): Promise<void> => {
        for (const entry of (await readdir(directory, {withFileTypes: true})).sort((left, right) => compareText(left.name, right.name))) {
            if (segments.length === 0 && GITLESS_SOURCE_EXCLUDES.has(entry.name)) continue;
            const nextSegments = [...segments, entry.name];
            const absolutePath = resolve(directory, entry.name);
            if (entry.isDirectory()) {
                await walk(absolutePath, nextSegments);
            } else if (entry.isFile() || entry.isSymbolicLink()) {
                paths.push(nextSegments.join("/"));
            } else {
                throw new Error(`Git-less Source 含不支持的特殊文件：${nextSegments.join("/")}`);
            }
        }
    };
    await walk(projectRoot, []);
    return [...new Set([...paths, "package.json", "bun.lock"])].sort(compareText);
}

/** owner path 匹配完整路径段，避免 `server` 意外拥有 `server-old`。 */
function pathOwnedBy(filePath: string, ownerPath: string): boolean {
    return ownerPath === "." || filePath === ownerPath || filePath.startsWith(`${ownerPath}/`);
}

/** 所有相对路径统一为 POSIX 形态，并拒绝盘符、UNC 与 `..`。 */
function normalizeRelativePath(input: string, label: string): string {
    const portableInput = input.replaceAll("\\", "/");
    const segments = portableInput.split("/");
    if (!input || input.includes("\0") || /^[A-Za-z]:/u.test(input)
        || isAbsolute(input) || win32.isAbsolute(input) || posix.isAbsolute(input)) {
        throw new Error(`${label} 必须是候选根内相对路径：${JSON.stringify(input)}`);
    }
    if (segments.includes("..")) {
        throw new Error(`${label} 不能逃逸候选根：${JSON.stringify(input)}`);
    }
    const normalized = posix.normalize(portableInput);
    return normalized === "./" ? "." : normalized.replace(/^\.\//u, "");
}

/** 候选与 symlink target 必须位于声明根之内。 */
function assertContainedPath(root: string, target: string, label: string): void {
    const child = relative(resolve(root), resolve(target));
    if (child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child))) return;
    throw new Error(`${label} 逃逸允许根：${target}`);
}

/** operation ID 直接成为目录名，因此只接受稳定的单段 ASCII 标识。 */
function assertOperationId(operationId: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(operationId) || operationId === "." || operationId === "..") {
        throw new Error(`Product Runtime Image operationId 无效：${JSON.stringify(operationId)}`);
    }
}

/** 平台身份进入 source digest 和 image ID，禁止空白与控制字符。 */
function assertPlatform(platform: string): void {
    if (!platform.trim() || platform !== platform.trim() || /[\u0000-\u001f]/u.test(platform)) {
        throw new Error(`Product Runtime Image platform 无效：${JSON.stringify(platform)}`);
    }
}

/** openVerified 的四项基础代次身份不可省略。 */
function assertExpectedIdentity(identity: ProductRuntimeExpectedIdentity): void {
    if (!identity.version || !identity.revision || !identity.platform || typeof identity.dirty !== "boolean") {
        throw new Error("Product Runtime Image expected identity 必须包含 version、revision、dirty 与 platform。");
    }
    if (!/^[0-9a-f]{40,64}$/iu.test(identity.revision)) {
        throw new Error("Product Runtime Image expected revision 必须是 Git object ID。");
    }
    assertPlatform(identity.platform);
    for (const [label, digest] of [
        ["imageId", identity.imageId],
        ["lockfileSha256", identity.lockfileSha256],
        ["sourceDigest", identity.sourceDigest],
    ] as const) {
        if (digest !== undefined && !isSha256(digest)) {
            throw new Error(`Product Runtime Image expected ${label} 无效。`);
        }
    }
}

/** JSON 外部对象的唯一集中收窄点。 */
function plainObject(value: unknown, label: string): {[key: string]: unknown} {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Product Runtime Image ${label} 必须是 object。`);
    }
    return value as {[key: string]: unknown};
}

/** v1 manifest 使用精确字段集合，未知字段必须通过新 schema 演进。 */
function assertExactKeys(record: {[key: string]: unknown}, expected: readonly string[], label: string): void {
    const actual = Object.keys(record).sort();
    const required = [...expected].sort();
    if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
        throw new Error(`Product Runtime Image ${label} 字段集合无效。`);
    }
}

/** 数量与字节预算只接受可精确表达的非负整数。 */
function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`Product Runtime Image ${label} 必须是非负安全整数。`);
    }
}

/** 所有持久化摘要都显式携带 SHA-256 算法名。 */
function isSha256(value: unknown): value is string {
    return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

/** 使用固定 UTF-16 code unit 顺序，避免 locale/ICU 改变跨机器 digest。 */
function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

/** 无 TOCTOU 副作用地判断候选 operation 是否已经存在。 */
async function pathExists(path: string): Promise<boolean> {
    try {
        await lstat(path);
        return true;
    } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") return false;
        throw error;
    }
}

/** Node filesystem error 的集中收窄。 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error;
}

/** proper-lockfile 在其他 owner 仍持有 lease 时使用 ELOCKED。 */
function isLockContention(error: unknown): boolean {
    return isNodeError(error) && error.code === "ELOCKED";
}
