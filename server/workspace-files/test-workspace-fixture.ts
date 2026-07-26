import {copyFile, cp, link, lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {execFile} from "node:child_process";
import {tmpdir} from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {
    PROFILE_COMPILED_ARTIFACTS_DIR_NAME,
    PROFILE_COMPILED_DIR_NAME,
    PROFILE_COMPILED_MANIFEST_FILE,
    readProfileArtifactManifest,
} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {
    getSystemWorkspaceAssetContextForTest,
    resolveApplicationRoot,
    resolveSystemNbookRoot,
    setSystemWorkspaceAssetContextForTest,
    type SystemWorkspaceAssetContext,
} from "nbook/server/workspace-files/system-workspace-assets";
import {
    getWorkspaceRuntimeRootContextForTest,
    setWorkspaceRuntimeRootContextForTest,
    type WorkspaceRuntimeRootContext,
} from "nbook/server/workspace-files/workspace-runtime-root";

/** fixture 临时 root 的固定前缀；sweep 只认这个前缀。 */
export const FIXTURE_ROOT_PREFIX = "nbook-workspace-assets-";
/** run 级共享只读 system assets snapshot 的固定前缀。 */
export const SNAPSHOT_ROOT_PREFIX = "nbook-workspace-snapshot-";
/** owner marker 文件名。 */
export const FIXTURE_MARKER_FILE = ".nbook-fixture.json";
/** marker 结构版本；sweep 只回收版本完全一致的 root。 */
export const FIXTURE_MARKER_SCHEMA_VERSION = 1;
/** 保守回收窗口：只有超过该时长且 owner 不活跃的 root 才允许回收。 */
export const FIXTURE_STALE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 共享 snapshot 的投影字节预算；超出说明有人又把不可达 artifact 放回了模板。 */
export const SHARED_SNAPSHOT_BYTE_BUDGET = 512 * 1024 * 1024;
/** globalSetup 把共享 snapshot 路径通过该环境变量传给各测试 fork。 */
export const TEST_SYSTEM_ASSETS_SNAPSHOT_ENV = "NBOOK_TEST_SYSTEM_ASSETS_SNAPSHOT";
/** globalSetup 生成的单次 run 标识，写进 marker 便于把残留 root 归组。 */
export const TEST_RUN_ID_ENV = "NBOOK_TEST_RUN_ID";

/** 进程内 fallback run id：没有 globalSetup 时（例如单文件直跑）仍然要能写出 marker。 */
const processRunId = randomUUID();

/**
 * system assets 的投影方式。
 *
 * - `shared`：`<root>/assets` 由 run 级 snapshot 硬链接投影而来，几乎零字节、零耗时，但内容与
 *   其它 fixture 共享，**只可读**。
 * - `isolated`：真实拷贝，供**会写入 system assets** 的测试独占。
 */
export type SystemAssetsMode = "shared" | "isolated";

export type IsolatedWorkspaceAssets = {
    root: string;
    applicationRoot: string;
    systemNbookRoot: string;
    workspaceContainerRoot: string;
    userNbookRoot: string;
    userProfileRoot: string;
    systemProfileRoot: string;
    dispose: () => Promise<void>;
};

export type IsolatedWorkspaceAssetsOptions = {
    /**
     * 为 true 时临时切换 cwd 到隔离 root；helper 会用 junction 暴露项目源码和依赖。
     */
    useAsCwd?: boolean;
    /**
     * 默认 `shared`（只读共享 snapshot）。只有会修改 system assets 的测试才用 `isolated`。
     */
    systemAssets?: SystemAssetsMode;
    /**
     * 写进 owner marker 的用途标签，仅用于诊断残留 root；为空时按 vitest worker 编号生成。
     */
    purpose?: string;
};

/**
 * fixture root 的 owner marker。sweep 只在这些字段全部可证明安全时才回收目录。
 */
export type TestWorkspaceFixtureMarker = {
    /** marker 结构版本；不一致一律保留并报告，不回收。 */
    schemaVersion: number;
    /** 创建时刻 ISO 字符串；用于保守回收窗口判定。 */
    createdAt: string;
    /** 创建进程 PID；仍存活时绝不回收。 */
    pid: number;
    /** 单次 Vitest run 标识；用于把同一 run 的 root 归组诊断。 */
    runId: string;
    /** 用途标签，仅用于诊断。 */
    purpose: string;
    /** system assets 投影方式，用于诊断哪些 root 真的复制了模板。 */
    systemAssets: SystemAssetsMode;
};

/** sweep 判定保留某个 root 的原因。 */
export type FixtureSweepRetainReason = "no_marker" | "schema_mismatch" | "owner_alive" | "within_window" | "unreadable";

export type FixtureSweepReport = {
    /** 已成功回收的 root 绝对路径。 */
    removed: string[];
    /** 匹配前缀但无法证明可安全回收的 root 及原因。 */
    retained: {root: string; reason: FixtureSweepRetainReason}[];
    /** 回收过程中的失败项；不阻断本次 run。 */
    failures: {root: string; message: string}[];
};

/**
 * 在隔离的 Workspace assets root 中执行测试，避免并行测试写入真实 user-assets。
 */
export async function withIsolatedWorkspaceAssets<T>(
    options: IsolatedWorkspaceAssetsOptions,
    task: (assets: IsolatedWorkspaceAssets) => Promise<T>,
): Promise<T> {
    const assets = await createIsolatedWorkspaceAssets(options);
    try {
        return await task(assets);
    } finally {
        await assets.dispose();
    }
}

/**
 * 创建独立 Workspace assets root，并把全局 context 指向该 root。
 *
 * 初始化任一步失败时由本函数自己回收已创建的 root 再 rethrow；
 * 调用方永远不会因为拿不到 `dispose()` 而泄漏临时目录。
 */
export async function createIsolatedWorkspaceAssets(options: IsolatedWorkspaceAssetsOptions = {}): Promise<IsolatedWorkspaceAssets> {
    const root = await mkdtemp(path.join(tmpdir(), FIXTURE_ROOT_PREFIX));
    try {
        return await initializeFixture(root, options);
    } catch (error) {
        await removeFixtureTree(root).catch(() => undefined);
        throw error;
    }
}

/**
 * 在已创建的 root 上完成投影、链接、cwd 切换和全局 context 覆盖。
 *
 * `<root>/assets/workspace/.nbook` 这个**物理相对路径必须始终存在**：
 * profile 编译把依赖路径记成 cwd 相对（`normalizeArtifactPath`），
 * user-assets sync 又按 `assets/workspace/.nbook/agent/profiles` 这个字符串标签
 * 把 system entry rehome 成 user entry。把 system root 挪到 cwd 之外会让依赖标签
 * 退化成临时目录绝对路径，rehome 随之失配。
 */
async function initializeFixture(root: string, options: IsolatedWorkspaceAssetsOptions): Promise<IsolatedWorkspaceAssets> {
    const previousSystemContext = getSystemWorkspaceAssetContextForTest();
    const previousRuntimeContext = getWorkspaceRuntimeRootContextForTest();
    const previousCwd = process.cwd();
    const applicationRoot = resolveApplicationRoot();
    const systemAssets: SystemAssetsMode = options.systemAssets ?? "shared";
    const assetsRoot = path.join(root, "assets");
    const systemNbookRoot = path.join(assetsRoot, "workspace", ".nbook");
    const workspaceContainerRoot = path.join(root, "workspace");
    const userNbookRoot = path.join(workspaceContainerRoot, ".nbook");

    await writeFixtureMarker(root, {
        schemaVersion: FIXTURE_MARKER_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        pid: process.pid,
        runId: process.env[TEST_RUN_ID_ENV] ?? processRunId,
        purpose: options.purpose ?? `vitest-worker-${process.env.VITEST_WORKER_ID ?? "0"}`,
        systemAssets,
    });

    const snapshotRoot = resolveSharedSnapshotRoot();
    await mkdir(path.dirname(systemNbookRoot), {recursive: true});
    const snapshotNbookRoot = path.join(snapshotRoot, "assets", "workspace", ".nbook");
    if (systemAssets === "shared") {
        // 共享模式用硬链接投影，而不是 junction。
        // junction 会被子进程 realpath 穿透：测试里 `bun <fixture>/assets/.../agent/scripts/workspace.ts`
        // 解析出的入口是 snapshot 内的真实路径，脚本随之把 snapshot 当成自己的 Workspace Root。
        // 硬链接是真实目录项，没有 reparse point，既不会被穿透，又不额外占空间。
        await linkTreeWithHardLinks(snapshotNbookRoot, systemNbookRoot);
    } else {
        // 独占可写副本：来源已经是投影结果，这里不再重复过滤。
        await cp(snapshotNbookRoot, systemNbookRoot, {recursive: true, force: true});
    }
    await mkdir(userNbookRoot, {recursive: true});

    if (options.useAsCwd) {
        await linkApplicationFiles(applicationRoot, root);
        process.chdir(root);
    }

    const systemContext: SystemWorkspaceAssetContext = {applicationRoot, systemNbookRoot};
    const runtimeContext: WorkspaceRuntimeRootContext = {workspaceRoot: workspaceContainerRoot, userNbookRoot};
    setSystemWorkspaceAssetContextForTest(systemContext);
    setWorkspaceRuntimeRootContextForTest(runtimeContext);

    return {
        root,
        applicationRoot,
        systemNbookRoot,
        workspaceContainerRoot,
        userNbookRoot,
        userProfileRoot: path.join(userNbookRoot, "agent", "profiles"),
        systemProfileRoot: path.join(systemNbookRoot, "agent", "profiles"),
        dispose: async () => {
            // context 恢复是同步赋值，不会抛，放最前面保证一定生效。
            setSystemWorkspaceAssetContextForTest(previousSystemContext);
            setWorkspaceRuntimeRootContextForTest(previousRuntimeContext);
            const failures: unknown[] = [];
            if (options.useAsCwd) {
                try {
                    process.chdir(previousCwd);
                } catch (error) {
                    failures.push(error);
                }
            }
            try {
                await removeFixtureTree(root);
            } catch (error) {
                failures.push(error);
            }
            if (failures.length > 0) {
                throw new AggregateError(failures, `Workspace fixture 销毁存在失败项：${root}`);
            }
        },
    };
}

/**
 * 解析 run 级共享 snapshot root。
 *
 * 未经 globalSetup 就使用 `shared` 模式属于调用顺序错误，直接抛错而不是静默回退到
 * 真实仓库 assets——静默回退会让测试写穿到仓库本体。
 */
function resolveSharedSnapshotRoot(): string {
    const snapshotRoot = process.env[TEST_SYSTEM_ASSETS_SNAPSHOT_ENV]?.trim();
    if (!snapshotRoot) {
        throw new Error(`缺少共享 system assets snapshot：请确认 vitest globalSetup 已运行并设置 ${TEST_SYSTEM_ASSETS_SNAPSHOT_ENV}。`);
    }
    return snapshotRoot;
}

/**
 * 构建 run 级共享只读 system assets snapshot。
 *
 * 这是对**已发布 release 的纯投影**，不做任何编译：源码、manifest 和 manifest 当前引用的
 * artifact 一起复制过来，三者本来就相互一致，投影后依然新鲜。manifest 里的依赖路径是
 * cwd 相对（`assets/workspace/.nbook/...`、`node_modules/...`），而 snapshot 根同时挂了
 * `assets` 与仓库 junction，因此这些路径在 snapshot 里解析到同样的字节。
 *
 * 刻意不在这里重编：重编一旦失败会用 compile_failed 覆盖掉刚投影进来的有效 manifest，
 * 让所有依赖 system profile 的测试一起垮掉，而失败原因往往与被测代码无关。
 * 系统 assets 的编译由 `bun run dev` / `system-assets:prepare` 负责。
 */
export async function createSharedSystemAssetsSnapshot(): Promise<string> {
    const snapshotRoot = await mkdtemp(path.join(tmpdir(), SNAPSHOT_ROOT_PREFIX));
    try {
        await writeFixtureMarker(snapshotRoot, {
            schemaVersion: FIXTURE_MARKER_SCHEMA_VERSION,
            createdAt: new Date().toISOString(),
            pid: process.pid,
            runId: process.env[TEST_RUN_ID_ENV] ?? processRunId,
            purpose: "shared-system-snapshot",
            systemAssets: "isolated",
        });
        const applicationRoot = resolveApplicationRoot();
        const sourceSystemNbookRoot = resolveSystemNbookRoot();
        const targetSystemNbookRoot = path.join(snapshotRoot, "assets", "workspace", ".nbook");
        const keptArtifactNames = await readCurrentArtifactNames(path.join(sourceSystemNbookRoot, "agent", "profiles"));
        if (keptArtifactNames.size === 0) {
            // 没有可投影的 current artifact，测试里所有 system profile 相关断言都会以难以定位的
            // 方式失败。这里直接失败并指出修复命令，比让 13 个用例各自报奇怪的错好得多。
            throw new Error(
                `系统 Profile 尚未编译（${path.join(sourceSystemNbookRoot, "agent", "profiles")} 的 manifest 没有 loaded entry）。`
                + "请先运行 `bun run system-assets:prepare` 再跑测试。",
            );
        }
        await ensurePublishedSystemProfilesFresh(path.join(sourceSystemNbookRoot, "agent", "profiles"));
        await mkdir(path.dirname(targetSystemNbookRoot), {recursive: true});
        await cp(sourceSystemNbookRoot, targetSystemNbookRoot, {
            recursive: true,
            force: true,
            filter: systemAssetsProjectionFilter(sourceSystemNbookRoot, keptArtifactNames),
        });
        // snapshot 内要执行 `workspace node ...` 之类的子进程，bun 会 realpath 后向上找
        // package.json / tsconfig.json / node_modules，所以 snapshot 根也要挂全套链接。
        await linkApplicationFiles(applicationRoot, snapshotRoot);
        return snapshotRoot;
    } catch (error) {
        await removeFixtureTree(snapshotRoot).catch(() => undefined);
        throw error;
    }
}

/**
 * 保证已发布的 system profile release 相对当前源码是新鲜的，必要时就地重编一次。
 *
 * snapshot 是纯投影，不重编；一旦 `server/**`、`packages/**` 等依赖在发布之后被改过，
 * 投影出来的 manifest 会整体判成 `dependency_changed`，所有 system profile 变 stale，
 * user-assets sync 直接跳过 profile —— 表现为一堆「期望非空却拿到 []」的断言失败，极难定位。
 *
 * 编译刻意放在**仓库根**（此时 cwd 就是仓库根）而不是 snapshot 或 fixture 内：
 * 依赖路径按 cwd 相对记录，只有在仓库根编译出来的 manifest 才能被任意 fixture 复用；
 * 而且临时 root 下的裸包解析本就不可靠。
 *
 * 只探测第一个 profile：14 个内置 profile 共享绝大部分依赖图，够用且省掉 14 倍哈希开销。
 */
async function ensurePublishedSystemProfilesFresh(profileRoot: string): Promise<void> {
    const {ProfileFreshnessChecker} = await import("nbook/server/agent/profiles/profile-freshness-checker");
    const checker = new ProfileFreshnessChecker();
    const probeFreshness = async (): Promise<{fresh: boolean; detail: string} | null> => {
        const manifest = await readProfileArtifactManifest(profileRoot).catch(() => null);
        const probe = manifest?.profiles[0];
        if (!probe) {
            return null;
        }
        const result = await checker.validate(profileRoot, probe, {checkDependencies: true});
        const detail = result.dependency ? `${result.reason}: ${result.dependency.path}` : result.reason ?? "unknown";
        return {fresh: result.fresh, detail: `${probe.fileName}，${detail}`};
    };

    const before = await probeFreshness();
    if (before?.fresh) {
        return;
    }

    // 必须开子进程：把 14 个 profile 的 esbuild 依赖图拉进 vitest 主进程会直接 OOM
    // （实测 heap 打满在 mark-compact）。这里复用与 `bun run system-assets:prepare`
    // 完全相同的入口，避免测试侧另立一套编译路径。
    await new Promise<void>((resolvePromise, rejectPromise) => {
        execFile(
            "bun",
            ["scripts/build/prepare-system-assets.ts"],
            {cwd: process.cwd(), encoding: "utf-8"},
            (error, _stdout, stderr) => {
                if (error) {
                    rejectPromise(new Error(`系统 assets 重编失败：${stderr || error.message}`));
                    return;
                }
                resolvePromise();
            },
        );
    });

    const after = await probeFreshness();
    if (after && !after.fresh) {
        throw new Error(
            `系统 Profile 重编后仍然不新鲜（${after.detail}）。`
            + "请手动运行 `bun run system-assets:prepare` 查看真实编译错误。",
        );
    }
}

/**
 * 读取 profile root 当前 manifest 引用的 artifact / type artifact 文件名集合。
 * manifest 缺失或损坏时返回空集合，投影会退化成"只带源码"，不会把 orphan 带进来。
 */
export async function readCurrentArtifactNames(profileRoot: string): Promise<ReadonlySet<string>> {
    const names = new Set<string>();
    const manifest = await readProfileArtifactManifest(profileRoot).catch(() => null);
    if (!manifest) {
        return names;
    }
    for (const item of manifest.profiles) {
        for (const fileName of [item.artifactFileName, item.typeFileName]) {
            if (fileName) {
                names.add(path.basename(fileName));
            }
        }
    }
    return names;
}

/**
 * 系统 `.nbook` 投影过滤器：只保留源码、manifest 和 manifest 当前引用的 artifact。
 *
 * 排除 orphan artifact、`.staging`、发布锁和 skill 派生 `node_modules`。
 * 这些都是可重建产物，把它们纳入测试模板正是磁盘被乘法放大的根因。
 */
export function systemAssetsProjectionFilter(
    systemNbookRoot: string,
    keptArtifactNames: ReadonlySet<string>,
): (source: string) => boolean {
    const root = path.resolve(systemNbookRoot);
    const stagingRoot = path.join(root, "agent", ".staging");
    const compiledRoot = path.join(root, "agent", "profiles", PROFILE_COMPILED_DIR_NAME);
    const artifactsRoot = path.join(compiledRoot, PROFILE_COMPILED_ARTIFACTS_DIR_NAME);
    return (source: string): boolean => {
        const absolute = path.resolve(source);
        // skill 依赖安装产物是派生物，不进模板。
        if (path.basename(absolute) === "node_modules") {
            return false;
        }
        if (absolute === stagingRoot || absolute.startsWith(`${stagingRoot}${path.sep}`)) {
            return false;
        }
        if (!absolute.startsWith(`${compiledRoot}${path.sep}`)) {
            return true;
        }
        const relative = path.relative(compiledRoot, absolute);
        if (relative === PROFILE_COMPILED_MANIFEST_FILE || relative === PROFILE_COMPILED_ARTIFACTS_DIR_NAME) {
            return true;
        }
        if (!absolute.startsWith(`${artifactsRoot}${path.sep}`)) {
            // `.publish.lock` 与历史扁平 artifact 一律不进模板。
            return false;
        }
        return keptArtifactNames.has(path.basename(absolute));
    };
}

/**
 * 用硬链接把 snapshot 的 system assets 投影到 fixture root。
 *
 * 目录逐级真实创建，文件一律硬链接；硬链接是真实目录项，子进程 realpath 不会穿透到
 * snapshot，同时 14 个约 27 MiB 的 artifact 不产生任何额外字节。
 * 跨卷等无法建链接的情况回退到普通复制。
 *
 * 语义前提：共享模式下测试**只读** system assets。会写 system assets 的测试必须显式
 * 申请 `systemAssets: "isolated"`，否则会经由硬链接改到所有 fixture 共享的那份内容。
 */
async function linkTreeWithHardLinks(sourceRoot: string, targetRoot: string): Promise<void> {
    await mkdir(targetRoot, {recursive: true});
    const entries = await readdir(sourceRoot, {withFileTypes: true});
    for (const entry of entries) {
        const source = path.join(sourceRoot, entry.name);
        const target = path.join(targetRoot, entry.name);
        if (entry.isDirectory()) {
            await linkTreeWithHardLinks(source, target);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        try {
            await link(source, target);
        } catch {
            await copyFile(source, target);
        }
    }
}

/**
 * 删除 fixture root。
 *
 * root 下含指向仓库本体的 junction（`node_modules`、`server`、`app` 等），
 * 必须先 `lstat` 判定 reparse point 只解链接本身。Windows junction 在 Node 中
 * 同样报告 `isSymbolicLink() === true`，跟随它递归删除会删掉仓库源码。
 */
export async function removeFixtureTree(root: string): Promise<void> {
    const entries = await readdir(root, {withFileTypes: true}).catch(() => []);
    const failures: unknown[] = [];
    for (const entry of entries) {
        const target = path.join(root, entry.name);
        try {
            const stats = await lstat(target);
            if (stats.isSymbolicLink()) {
                // 必须带 recursive：Windows 目录 junction 不能用非递归 rm 解除（会 EFAULT/EPERM）。
                // `fs.rm` 对 symlink/junction 只解链接、不进入目标，所以这里不会删到仓库本体。
                await rm(target, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
                continue;
            }
            await rm(target, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
        } catch (error) {
            failures.push(error);
        }
    }
    // 无论前面是否失败都必须尝试删除 root 本体。
    await rm(root, {recursive: true, force: true, maxRetries: 10, retryDelay: 100}).catch((error: unknown) => failures.push(error));
    if (failures.length > 0) {
        throw new AggregateError(failures, `fixture root 清理存在失败项：${root}`);
    }
}

/**
 * 回收上一次运行留下的 fixture root。
 *
 * 判定链上任何一步无法证明安全，一律保留并报告，绝不删除：
 * 必须是真实目录（不跟随同名 symlink）→ marker 可读且 schema 一致 →
 * 超过保守窗口 → owner 进程已不活跃。
 */
export async function sweepStaleFixtureRoots(now: number = Date.now()): Promise<FixtureSweepReport> {
    const report: FixtureSweepReport = {removed: [], retained: [], failures: []};
    const tempRoot = tmpdir();
    const entries = await readdir(tempRoot, {withFileTypes: true}).catch(() => []);
    for (const entry of entries) {
        if (!entry.name.startsWith(FIXTURE_ROOT_PREFIX) && !entry.name.startsWith(SNAPSHOT_ROOT_PREFIX)) {
            continue;
        }
        const root = path.join(tempRoot, entry.name);
        const stats = await lstat(root).catch(() => null);
        if (!stats || stats.isSymbolicLink() || !stats.isDirectory()) {
            report.retained.push({root, reason: "unreadable"});
            continue;
        }
        const marker = await readFixtureMarker(root);
        if (!marker) {
            report.retained.push({root, reason: "no_marker"});
            continue;
        }
        if (marker.schemaVersion !== FIXTURE_MARKER_SCHEMA_VERSION) {
            report.retained.push({root, reason: "schema_mismatch"});
            continue;
        }
        const createdAt = Date.parse(marker.createdAt);
        if (!Number.isFinite(createdAt) || now - createdAt < FIXTURE_STALE_WINDOW_MS) {
            report.retained.push({root, reason: "within_window"});
            continue;
        }
        if (isProcessAlive(marker.pid)) {
            report.retained.push({root, reason: "owner_alive"});
            continue;
        }
        try {
            await removeFixtureTree(root);
            report.removed.push(root);
        } catch (error) {
            report.failures.push({root, message: error instanceof Error ? error.message : String(error)});
        }
    }
    return report;
}

/** 写入 owner marker。 */
async function writeFixtureMarker(root: string, marker: TestWorkspaceFixtureMarker): Promise<void> {
    await writeFile(path.join(root, FIXTURE_MARKER_FILE), `${JSON.stringify(marker, null, 4)}\n`, "utf8");
}

/** 读取并逐字段窄化 owner marker；任何字段不合法都返回 null，交由调用方保留目录。 */
async function readFixtureMarker(root: string): Promise<TestWorkspaceFixtureMarker | null> {
    const text = await readFile(path.join(root, FIXTURE_MARKER_FILE), "utf8").catch(() => null);
    if (text === null) {
        return null;
    }
    let value: unknown;
    try {
        // marker 是磁盘上的外部数据，解析前形态未知，这里是 unknown 的正当用法。
        value = JSON.parse(text) as unknown;
    } catch {
        return null;
    }
    if (typeof value !== "object" || value === null) {
        return null;
    }
    const candidate = value as Partial<Record<keyof TestWorkspaceFixtureMarker, unknown>>;
    if (typeof candidate.schemaVersion !== "number"
        || typeof candidate.createdAt !== "string"
        || typeof candidate.pid !== "number"
        || typeof candidate.runId !== "string"
        || typeof candidate.purpose !== "string"
        || (candidate.systemAssets !== "shared" && candidate.systemAssets !== "isolated")) {
        return null;
    }
    return {
        schemaVersion: candidate.schemaVersion,
        createdAt: candidate.createdAt,
        pid: candidate.pid,
        runId: candidate.runId,
        purpose: candidate.purpose,
        systemAssets: candidate.systemAssets,
    };
}

/**
 * 判断 owner 进程是否仍活跃。
 * ESRCH 表示进程不存在；EPERM 表示存在但无权限，视为存活。无法判定一律视为存活。
 */
function isProcessAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) {
        return true;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return !(typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH");
    }
}

// 这些条目必须覆盖 profile manifest 里依赖路径的全部顶层前缀：
// 依赖按 cwd 相对记录（`normalizeArtifactPath`），fixture 内解析不到就会被判成
// dependency_changed，进而让所有 system profile 变 stale、sync 直接跳过。
// 当前实测前缀为 node_modules / server / shared / packages / assets / tsconfig.json。
const linkedApplicationEntries = [
    {name: "app", type: "junction" as const},
    {name: "server", type: "junction" as const},
    {name: "shared", type: "junction" as const},
    {name: "packages", type: "junction" as const},
    {name: "reference", type: "junction" as const},
    {name: "docs", type: "junction" as const},
    {name: "node_modules", type: "junction" as const},
    {name: ".nuxt", type: "junction" as const},
    {name: "package.json", type: "file" as const},
    {name: "tsconfig.json", type: "file" as const},
    {name: "nuxt.config.ts", type: "file" as const},
];

async function linkApplicationFiles(applicationRoot: string, isolatedRoot: string): Promise<void> {
    for (const entry of linkedApplicationEntries) {
        const source = path.join(applicationRoot, entry.name);
        const target = path.join(isolatedRoot, entry.name);
        await symlink(source, target, entry.type).catch((error) => {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
                return;
            }
            throw error;
        });
    }
}
