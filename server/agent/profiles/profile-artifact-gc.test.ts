import {mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    PROFILE_ARTIFACT_COMPILER_VERSION,
    PROFILE_COMPILED_ARTIFACT_GC_GRACE_MS,
    PROFILE_COMPILED_ARTIFACT_GC_MIN_AGE_MS,
    PROFILE_COMPILED_ARTIFACTS_DIR_NAME,
    PROFILE_COMPILED_MANIFEST_FILE,
    PROFILE_COMPILED_PUBLISH_LOCK,
    pruneCompiledArtifacts,
    type ProfileArtifactManifest,
    type ProfileArtifactManifestItem,
} from "nbook/server/agent/profiles/profile-artifact-compiler";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

/** 建一个 `.compiled` 目录，写入若干 artifact，返回目录路径。 */
async function createCompiledDir(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "nbook-profile-gc-"));
    roots.push(root);
    const compiledDir = join(root, ".compiled");
    await mkdir(join(compiledDir, PROFILE_COMPILED_ARTIFACTS_DIR_NAME), {recursive: true});
    await writeFile(join(compiledDir, PROFILE_COMPILED_MANIFEST_FILE), "{}\n", "utf8");
    return compiledDir;
}

/**
 * 写一个指定字节数的 artifact 并把 mtime 设为「距今 ageMs 毫秒之前」。
 * GC 的驱逐序完全由 mtime 决定，所以测试必须能精确控制它。
 */
async function writeArtifact(compiledDir: string, sha: string, bytes: number, ageMs: number): Promise<string> {
    const filePath = join(compiledDir, PROFILE_COMPILED_ARTIFACTS_DIR_NAME, `${sha}.mjs`);
    await writeFile(filePath, "x".repeat(bytes), "utf8");
    const when = (Date.now() - ageMs) / 1000;
    await utimes(filePath, when, when);
    return filePath;
}

/** 构造只含 loaded entry 的 manifest；GC 的可达集合来自 `profiles`。 */
function manifestWith(shas: string[]): ProfileArtifactManifest {
    const profiles: ProfileArtifactManifestItem[] = shas.map((sha, index) => ({
        status: "loaded",
        fileName: `builtin/p${index}.profile.tsx`,
        profileKey: `p${index}`,
        sourceSha256: `source-${sha}`,
        sourceBytes: 1,
        dependencyHash: "dep",
        artifactFileName: `${PROFILE_COMPILED_ARTIFACTS_DIR_NAME}/${sha}.mjs`,
        artifactSha256: sha,
        artifactBytes: 1,
        dependencies: [],
    }));
    return {
        compilerVersion: PROFILE_ARTIFACT_COMPILER_VERSION,
        generatedAt: new Date(0).toISOString(),
        profilesRoot: "assets/workspace/.nbook/agent/profiles",
        entries: profiles,
        profiles,
    };
}

async function artifactNames(compiledDir: string): Promise<string[]> {
    return (await readdir(join(compiledDir, PROFILE_COMPILED_ARTIFACTS_DIR_NAME))).sort();
}

describe("Profile artifact GC", () => {
    it("current manifest 引用的 artifact 永不删除，哪怕远超字节预算", async () => {
        const compiledDir = await createCompiledDir();
        await writeArtifact(compiledDir, "current", 4096, 30 * 24 * 60 * 60 * 1000);

        const report = await pruneCompiledArtifacts(compiledDir, manifestWith(["current"]), "publish", 1);

        expect(await artifactNames(compiledDir)).toEqual(["current.mjs"]);
        expect(report.deletedFiles).toBe(0);
        expect(report.currentFiles).toBe(1);
        expect(report.orphanFiles).toBe(0);
    });

    it("超预算时从最久未被引用的 orphan 开始驱逐，直到回到预算内", async () => {
        const compiledDir = await createCompiledDir();
        const hour = 60 * 60 * 1000;
        await writeArtifact(compiledDir, "current", 100, hour);
        await writeArtifact(compiledDir, "oldest", 100, 5 * hour);
        await writeArtifact(compiledDir, "middle", 100, 3 * hour);
        await writeArtifact(compiledDir, "newest", 100, 2 * hour);

        // 预算只装得下一个 orphan（100 bytes），另外两个必须按 mtime 从旧到新驱逐。
        const report = await pruneCompiledArtifacts(compiledDir, manifestWith(["current"]), "publish", 100);

        expect(await artifactNames(compiledDir)).toEqual(["current.mjs", "newest.mjs"]);
        expect(report.deletedFiles).toBe(2);
        expect(report.overBudgetBytes).toBe(0);
    });

    it("未过最小安全年龄的 orphan 即使超预算也不驱逐，并如实上报 overBudgetBytes", async () => {
        const compiledDir = await createCompiledDir();
        await writeArtifact(compiledDir, "current", 100, 60 * 60 * 1000);
        // 刚落盘的 orphan 可能正被并发读者 import，地板优先于预算。
        await writeArtifact(compiledDir, "brandNew", 500, Math.floor(PROFILE_COMPILED_ARTIFACT_GC_MIN_AGE_MS / 2));

        const report = await pruneCompiledArtifacts(compiledDir, manifestWith(["current"]), "publish", 1);

        expect(await artifactNames(compiledDir)).toEqual(["brandNew.mjs", "current.mjs"]);
        expect(report.deletedFiles).toBe(0);
        expect(report.protectedBytes).toBe(500);
        expect(report.overBudgetBytes).toBe(499);
    });

    it("超过 grace 的 orphan 即使没超预算也回收", async () => {
        const compiledDir = await createCompiledDir();
        await writeArtifact(compiledDir, "current", 10, 60 * 60 * 1000);
        await writeArtifact(compiledDir, "expired", 10, PROFILE_COMPILED_ARTIFACT_GC_GRACE_MS + 60 * 1000);

        const report = await pruneCompiledArtifacts(compiledDir, manifestWith(["current"]), "publish", 1024 * 1024);

        expect(await artifactNames(compiledDir)).toEqual(["current.mjs"]);
        expect(report.deletedFiles).toBe(1);
    });

    it("manifest 没有任何 loaded entry 时跳过预算回收，不清空 artifacts 目录", async () => {
        const compiledDir = await createCompiledDir();
        const hour = 60 * 60 * 1000;
        await writeArtifact(compiledDir, "a", 1000, hour);
        await writeArtifact(compiledDir, "b", 1000, 2 * hour);
        const degenerate: ProfileArtifactManifest = {
            ...manifestWith([]),
            // 全量编译失败（例如宿主依赖临时缺失）时真实出现过的形态：账本非空但没有可加载 entry。
            entries: [{status: "compile_failed", fileName: "builtin/a.profile.tsx", profileKey: "a", sourceSha256: "s", sourceBytes: 1, issues: [{code: "compile_failed", message: "boom"}]}],
        };

        const report = await pruneCompiledArtifacts(compiledDir, degenerate, "publish", 1);

        expect(await artifactNames(compiledDir)).toEqual(["a.mjs", "b.mjs"]);
        expect(report.skippedDegenerate).toBe(true);
        expect(report.deletedFiles).toBe(0);
    });

    it("回收不会误伤 manifest.json 与 .publish.lock", async () => {
        const compiledDir = await createCompiledDir();
        const hour = 60 * 60 * 1000;
        // proper-lockfile 用 mkdir 语义，锁是目录且位于 `.compiled/` 下而不是 artifacts/ 下。
        await mkdir(join(compiledDir, PROFILE_COMPILED_PUBLISH_LOCK), {recursive: true});
        await writeArtifact(compiledDir, "orphan", 1000, hour);

        await pruneCompiledArtifacts(compiledDir, manifestWith([]), "publish", 1);

        await expect(stat(join(compiledDir, PROFILE_COMPILED_MANIFEST_FILE))).resolves.toBeTruthy();
        await expect(stat(join(compiledDir, PROFILE_COMPILED_PUBLISH_LOCK))).resolves.toBeTruthy();
    });

    it("把 current artifact 的 mtime 刷新成最后一次被引用的时间", async () => {
        const compiledDir = await createCompiledDir();
        const filePath = await writeArtifact(compiledDir, "current", 10, 30 * 24 * 60 * 60 * 1000);
        const before = (await stat(filePath)).mtimeMs;

        await pruneCompiledArtifacts(compiledDir, manifestWith(["current"]), "publish", 1024 * 1024);

        // 不刷新的话，一个被长期引用的 artifact 一旦脱离 current 就会带着最旧的 mtime，
        // 立刻成为最优先驱逐对象——恰恰是最可能马上被重新引用的那一个。
        expect((await stat(filePath)).mtimeMs).toBeGreaterThan(before);
    });
});
