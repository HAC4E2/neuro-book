import {mkdir, readFile, readdir, rename as fsRename, rm, rm as fsRm, symlink, writeFile} from "node:fs/promises";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {
    getSystemAssetInstallPaths,
    seedSystemAssets,
} from "nbook/server/workspace-files/system-asset-installation";

describe("State Root system asset installation", () => {
    const roots: string[] = [];

    afterEach(async () => {
        for (const root of roots.splice(0)) {
            await import("node:fs/promises").then(({rm}) => rm(root, {recursive: true, force: true}));
        }
    });

    it("将 source seed 安装到隔离的 State Root install root，并重复执行幂等", async () => {
        const root = testHostPath("tmp", "system-asset-installation", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        await mkdir(path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "profiles"), {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference", "agent"), {recursive: true});
        await writeFile(path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "profiles", "builtin.profile.tsx"), "profile", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "agent", "README.md"), "reference", "utf8");
        await mkdir(path.join(stateRoot, "workspace", ".nbook"), {recursive: true});
        await writeFile(path.join(stateRoot, "workspace", ".nbook", "user.txt"), "keep", "utf8");

        const first = await seedSystemAssets({applicationRoot, stateRoot});
        const paths = getSystemAssetInstallPaths(stateRoot);
        expect(first.seeded).toBe(true);
        expect(paths.installRoot).toBe(path.join(stateRoot, "workspace", ".nbook", "agent"));
        expect(paths.systemNbookRoot).toBe(path.join(stateRoot, "workspace", ".nbook"));
        expect(paths.systemReferenceRoot).toBe(path.join(stateRoot, "workspace", ".nbook", "reference"));
        expect(paths.manifestPath).toBe(path.join(paths.installRoot, "installed.json"));
        expect(paths.referenceManifestPath).toBe(path.join(paths.systemReferenceRoot, "reference-manifest.json"));
        await expect(readFile(path.join(paths.installRoot, "profiles", "builtin.profile.tsx"), "utf8")).resolves.toBe("profile");
        await expect(readFile(path.join(paths.systemReferenceRoot, "agent", "README.md"), "utf8")).resolves.toBe("reference");
        await expect(readFile(path.join(stateRoot, "workspace", ".nbook", "user.txt"), "utf8")).resolves.toBe("keep");

        const second = await seedSystemAssets({applicationRoot, stateRoot});
        expect(second.seeded).toBe(false);
        await expect(readFile(paths.manifestPath, "utf8")).resolves.toContain("system-asset-install/v2");
        await expect(readFile(paths.referenceManifestPath, "utf8")).resolves.toContain("system-reference-install/v1");
    });

    it("安装根被外部修改时拒绝覆盖并保持 fail-closed", async () => {
        const root = testHostPath("tmp", "system-asset-installation-conflict", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        await mkdir(path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "skills", "conflict"), {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        await writeFile(path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "skills", "conflict", "skill.md"), "seed", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");

        await seedSystemAssets({applicationRoot, stateRoot});
        const paths = getSystemAssetInstallPaths(stateRoot);
        await writeFile(path.join(paths.installRoot, "skills", "conflict", "skill.md"), "edited", "utf8");
        await expect(seedSystemAssets({applicationRoot, stateRoot})).rejects.toThrow("system install package 内容已被修改");
        await expect(readFile(path.join(paths.installRoot, "skills", "conflict", "skill.md"), "utf8")).resolves.toBe("edited");
    });
    it("ledger 未记录的本地包不被同 id Seed 接管", async () => {
        const root = testHostPath("tmp", "system-asset-installation-local", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        const seedRoot = path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "skills");
        await mkdir(path.join(seedRoot, "bundled"), {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        await writeFile(path.join(seedRoot, "bundled", "skill.md"), "bundled", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");
        await seedSystemAssets({applicationRoot, stateRoot});

        const paths = getSystemAssetInstallPaths(stateRoot);
        await mkdir(path.join(paths.installRoot, "skills", "local"), {recursive: true});
        await writeFile(path.join(paths.installRoot, "skills", "local", "skill.md"), "local", "utf8");
        const currentManifest = JSON.parse(await readFile(paths.manifestPath, "utf8")) as {assets: Array<Record<string, unknown>>};
        currentManifest.assets = currentManifest.assets.filter((entry) => entry.id !== "local");
        await writeFile(paths.manifestPath, `${JSON.stringify(currentManifest)}\n`, "utf8");
        await mkdir(path.join(seedRoot, "local"), {recursive: true});
        await writeFile(path.join(seedRoot, "local", "skill.md"), "local", "utf8");

        await seedSystemAssets({applicationRoot, stateRoot});
        await expect(readFile(path.join(paths.installRoot, "skills", "local", "skill.md"), "utf8")).resolves.toBe("local");
        const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8")) as {assets: Array<{id: string; origin: {kind: string}}>};
        expect(manifest.assets.find((entry) => entry.id === "local")?.origin.kind).toBe("local");
    });

    it("Seed 删除 bundled 包时保留磁盘内容并写入 removed tombstone", async () => {
        const root = testHostPath("tmp", "system-asset-installation-tombstone", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        const seedPackage = path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "skills", "retired");
        await mkdir(seedPackage, {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        await writeFile(path.join(seedPackage, "skill.md"), "retired", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");
        await seedSystemAssets({applicationRoot, stateRoot});
        const paths = getSystemAssetInstallPaths(stateRoot);

        await fsRm(seedPackage, {recursive: true, force: true});
        await seedSystemAssets({applicationRoot, stateRoot});
        await expect(readFile(path.join(paths.installRoot, "skills", "retired", "skill.md"), "utf8")).resolves.toBe("retired");
        const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8")) as {assets: Array<{id: string; state: string}>};
        expect(manifest.assets.find((entry) => entry.id === "retired")?.state).toBe("removed");

        await mkdir(seedPackage, {recursive: true});
        await writeFile(path.join(seedPackage, "skill.md"), "new seed must not win", "utf8");
        await seedSystemAssets({applicationRoot, stateRoot});
        await expect(readFile(path.join(paths.installRoot, "skills", "retired", "skill.md"), "utf8")).resolves.toBe("retired");
    });
    it("State Install Root 删除 bundled package 时拒绝 Seed 静默复活", async () => {
        const root = testHostPath("tmp", "system-asset-installation-missing", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        const seedPackage = path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "skills", "deleted");
        await mkdir(seedPackage, {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        await writeFile(path.join(seedPackage, "skill.md"), "seed", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");
        await seedSystemAssets({applicationRoot, stateRoot});
        const paths = getSystemAssetInstallPaths(stateRoot);
        await rm(path.join(paths.installRoot, "skills", "deleted"), {recursive: true, force: true});
        await expect(seedSystemAssets({applicationRoot, stateRoot})).rejects.toThrow("system install bundled package 缺失或被删除");
    });
    it("提交前移动旧包失败时保留未触碰的 current 单元", async () => {
        const root = testHostPath("tmp", "system-asset-installation-preserve-current", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        const seedRoot = path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "profiles");
        await mkdir(seedRoot, {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        const seedProfile = path.join(seedRoot, "builtin.profile.tsx");
        await writeFile(seedProfile, "key: builtin\nv1", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");
        await seedSystemAssets({applicationRoot, stateRoot});

        await writeFile(seedProfile, "key: builtin\nv2", "utf8");
        const paths = getSystemAssetInstallPaths(stateRoot);
        let blocked = false;
        await expect(seedSystemAssets({applicationRoot, stateRoot}, {
            rm: async (target, options) => {
                if (!blocked && path.resolve(target).startsWith(path.resolve(path.join(paths.installRoot, "profiles")))) {
                    blocked = true;
                    throw new Error("injected current removal failure");
                }
                await fsRm(target, options);
            },
        })).rejects.toThrow("system install root 安装失败");
        await expect(readFile(path.join(paths.installRoot, "profiles", "builtin.profile.tsx"), "utf8")).resolves.toContain("v1");
    });

    it("发布中途失败时恢复完整 previous 并保留事务残留诊断", async () => {
        const root = testHostPath("tmp", "system-asset-installation-recovery", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        const seedRoot = path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "profiles");
        await mkdir(seedRoot, {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        const firstProfile = path.join(seedRoot, "first.profile.tsx");
        const secondProfile = path.join(seedRoot, "second.profile.tsx");
        await writeFile(firstProfile, "key: first\nv1", "utf8");
        await writeFile(secondProfile, "key: second\nv1", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");
        await seedSystemAssets({applicationRoot, stateRoot});

        await writeFile(firstProfile, "key: first\nv2", "utf8");
        await writeFile(secondProfile, "key: second\nv2", "utf8");
        const paths = getSystemAssetInstallPaths(stateRoot);
        let moveCount = 0;
        await expect(seedSystemAssets({applicationRoot, stateRoot}, {
            rename: async (oldPath, newPath) => {
                if (oldPath.includes(".agent-assets.staging-") && path.resolve(newPath).startsWith(path.resolve(paths.installRoot))) {
                    moveCount += 1;
                    if (moveCount === 2) throw new Error("injected second package move failure");
                }
                await fsRename(oldPath, newPath);
            },
        })).rejects.toThrow("system install root 安装失败");

        await expect(readFile(path.join(paths.installRoot, "profiles", "first.profile.tsx"), "utf8")).resolves.toContain("v1");
        await expect(readFile(path.join(paths.installRoot, "profiles", "second.profile.tsx"), "utf8")).resolves.toContain("v1");
        const entriesAfterFailure = await readdir(paths.systemNbookRoot);
        expect(entriesAfterFailure.some((entry) => entry.startsWith(".agent-assets.previous-"))).toBe(true);

        const recovered = await seedSystemAssets({applicationRoot, stateRoot});
        expect(recovered.seeded).toBe(true);
        await expect(readFile(path.join(paths.installRoot, "profiles", "first.profile.tsx"), "utf8")).resolves.toContain("v2");
        await expect(readFile(path.join(paths.installRoot, "profiles", "second.profile.tsx"), "utf8")).resolves.toContain("v2");
    });

    it("Reference 事务与 Agent install root 使用兄弟路径和独立 manifest", async () => {
        const root = testHostPath("tmp", "system-asset-installation-reference", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        await mkdir(path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "skills", "skill"), {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        await writeFile(path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "skills", "skill", "skill.md"), "skill", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "book.md"), "book", "utf8");

        const result = await seedSystemAssets({applicationRoot, stateRoot});
        const paths = getSystemAssetInstallPaths(stateRoot);
        expect(result.referenceManifest.schema).toBe("system-reference-install/v1");
        expect(path.dirname(paths.systemReferenceRoot)).toBe(paths.systemNbookRoot);
        expect(path.dirname(paths.installRoot)).toBe(paths.systemNbookRoot);
        expect(paths.lockPath).toBe(path.join(paths.systemNbookRoot, ".agent-assets.install.lock"));
        await expect(readFile(path.join(paths.installRoot, "skills", "skill", "skill.md"), "utf8")).resolves.toBe("skill");
    });


    it.each([
        [null, "seed 必须是对象"],
        [[], "seed 必须是对象"],
        [{unknown: "x"}, "seed 包含未知字段：unknown"],
        [{seedNbookRoot: "  "}, "seed.seedNbookRoot 必须是非空字符串"],
        [{seedReferenceRoot: null}, "seed.seedReferenceRoot 必须是非空字符串"],
        [{kind: "bundled"}, "seed.kind 必须是 source 或 product"],
    ] as const)("拒绝非法 seed 输入 %#", async (seed, message) => {
        const root = testHostPath("tmp", "system-asset-installation-input", crypto.randomUUID());
        roots.push(root);
        await expect(seedSystemAssets({
            applicationRoot: path.join(root, "application"),
            stateRoot: path.join(root, "state"),
            seed: seed as never,
        })).rejects.toThrow(message);
    });
    it("缺少固定 workflow entry 的 Seed 立即 fail-closed", async () => {
        const root = testHostPath("tmp", "system-asset-installation-workflow-input", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        await mkdir(path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "workflows", "broken"), {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        await writeFile(path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "workflows", "broken", "workflow.md"), "invalid", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");
        await expect(seedSystemAssets({applicationRoot, stateRoot})).rejects.toThrow("system assets workflow package 缺少 workflow.ts");
    });
    it("Seed 中的 Agent package 符号链接立即 fail-closed", async () => {
        const root = testHostPath("tmp", "system-asset-installation-symlink", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        const agentRoot = path.join(applicationRoot, "assets", "workspace", ".nbook", "agent");
        await mkdir(path.join(agentRoot, "skills", "real"), {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        await writeFile(path.join(agentRoot, "skills", "real", "SKILL.md"), "real", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");
        try {
            await symlink(path.join(agentRoot, "skills", "real"), path.join(agentRoot, "skills", "linked"));
        } catch (error) {
            if (isSymlinkUnsupportedError(error)) return;
            throw error;
        }
        await expect(seedSystemAssets({applicationRoot, stateRoot})).rejects.toThrow("不允许特殊文件或符号链接");
    });
    it("Seed 的 managed parent root 符号链接立即 fail-closed", async () => {
        const root = testHostPath("tmp", "system-asset-installation-parent-symlink", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        const agentRoot = path.join(applicationRoot, "assets", "workspace", ".nbook", "agent");
        const outsideRoot = path.join(root, "outside-skills");
        await mkdir(agentRoot, {recursive: true});
        await mkdir(outsideRoot, {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        await writeFile(path.join(outsideRoot, "SKILL.md"), "outside", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");
        try {
            await symlink(outsideRoot, path.join(agentRoot, "skills"));
        } catch (error) {
            if (isSymlinkUnsupportedError(error)) return;
            throw error;
        }
        await expect(seedSystemAssets({applicationRoot, stateRoot})).rejects.toThrow("system assets skills root 必须是真实目录");
    });
    it("Seed 的 profiles parent root 符号链接立即 fail-closed", async () => {
        const root = testHostPath("tmp", "system-asset-installation-profiles-symlink", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        const agentRoot = path.join(applicationRoot, "assets", "workspace", ".nbook", "agent");
        const outsideRoot = path.join(root, "outside-profiles");
        await mkdir(agentRoot, {recursive: true});
        await mkdir(outsideRoot, {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        await writeFile(path.join(outsideRoot, "outside.profile.tsx"), "export default {};\n", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");
        try {
            await symlink(outsideRoot, path.join(agentRoot, "profiles"));
        } catch (error) {
            if (isSymlinkUnsupportedError(error)) return;
            throw error;
        }
        await expect(seedSystemAssets({applicationRoot, stateRoot})).rejects.toThrow("system assets profiles root 必须是真实目录");
    });

function isSymlinkUnsupportedError(error: unknown): boolean {
    return process.platform === "win32"
        && typeof error === "object"
        && error !== null
        && "code" in error
        && ["EPERM", "EACCES", "ENOSYS"].includes(String(error.code));
}
});
