import {mkdtemp, readdir, readFile, rm, copyFile, mkdir, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename, join, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {compileProfileArtifacts} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {Fragment, jsx} from "nbook/profile-sdk/jsx-runtime";

const builtinRoot = resolve("assets/workspace/.nbook/agent/profiles/builtin");
const templateRoot = resolve("assets/workspace/.nbook/agent/profile-templates");
const temporaryRoots: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Profile SDK 稳定入口", () => {
    it("内置 Profile 与模板不再依赖 server 深层路径", async () => {
        const files = [
            ...await readdir(builtinRoot),
            ...await readdir(templateRoot),
        ].filter((fileName) => fileName.endsWith(".tsx"));
        const violations: string[] = [];
        for (const fileName of files) {
            const root = fileName.endsWith(".profile.tsx") ? builtinRoot : templateRoot;
            const source = await readFile(join(root, fileName), "utf8");
            if (source.includes("nbook/server/")) {
                violations.push(`${fileName}: server deep import`);
            }
            if (!source.includes("@jsxImportSource nbook/profile-sdk")) {
                violations.push(`${fileName}: unstable JSX runtime`);
            }
        }
        expect(violations).toEqual([]);
    });

    it("SDK JSX runtime 可直接构造 Profile DSL 节点", () => {
        expect(Fragment).toBeDefined();
        expect(jsx("System", {children: "ok"})).toMatchObject({
            kind: "System",
            children: ["ok"],
        });
    });

    it("编译器拒绝 Profile 绕过 SDK 导入 server 实现", async () => {
        const temporaryRoot = await mkdtemp(join(tmpdir(), "nbook-profile-sdk-gate-"));
        temporaryRoots.push(temporaryRoot);
        const profileRoot = join(temporaryRoot, "profiles");
        await mkdir(profileRoot, {recursive: true});
        await writeFile(join(profileRoot, "deep.profile.tsx"), `
/** @jsxImportSource nbook/profile-sdk */
import {Type, defineAgentProfile, builtin, toolset, ProfilePrompt, System} from "nbook/profile-sdk";
import type {ProfilePrepareContext} from "nbook/server/agent/profiles/types";

export default defineAgentProfile({
    manifest: {key: "deep", name: "deep"},
    initialSchema: Type.Object({}),
    tools: toolset(builtin.file.read),
    context(_ctx: ProfilePrepareContext) {
        return <ProfilePrompt><System>deep</System></ProfilePrompt>;
    },
});
`, "utf8");

        const result = await compileProfileArtifacts({
            profileRoot,
            stagingRoot: join(temporaryRoot, "staging"),
            skipFresh: true,
            rootLabel: "profile-sdk-gate",
            orphanBudgetPolicy: "product",
        });

        expect(result.manifest.entries).toHaveLength(1);
        expect(result.manifest.entries[0]).toMatchObject({
            status: "compile_failed",
            issues: [{
                code: "compile_failed",
                message: expect.stringContaining("Profile SDK 违规"),
            }],
        });
    });

    it("编译器拒绝 Profile 导入 Authoring Kit 未提供的第三方包", async () => {
        const temporaryRoot = await mkdtemp(join(tmpdir(), "nbook-profile-sdk-package-gate-"));
        temporaryRoots.push(temporaryRoot);
        const profileRoot = join(temporaryRoot, "profiles");
        await mkdir(profileRoot, {recursive: true});
        await writeFile(join(profileRoot, "package.profile.ts"), `
import {z} from "zod";
import {Type, defineAgentProfile} from "nbook/profile-sdk";

export default defineAgentProfile({
    manifest: {key: "package", name: z.string().parse("package")},
    initialSchema: Type.Object({}),
    context() { return []; },
});
`, "utf8");

        const result = await compileProfileArtifacts({
            profileRoot,
            stagingRoot: join(temporaryRoot, "staging"),
            skipFresh: true,
            rootLabel: "profile-sdk-package-gate",
            orphanBudgetPolicy: "product",
        });

        expect(result.manifest.entries[0]).toMatchObject({
            status: "compile_failed",
            issues: [{message: expect.stringContaining("- zod")}],
        });
    });

    it("14 个内置 Profile 只通过 SDK 完成空目标编译", async () => {
        const temporaryRoot = await mkdtemp(join(tmpdir(), "nbook-profile-sdk-"));
        temporaryRoots.push(temporaryRoot);
        const profileRoot = join(temporaryRoot, "profiles");
        const stagingRoot = join(temporaryRoot, "staging");
        await mkdir(profileRoot, {recursive: true});
        const sourceFiles = (await readdir(builtinRoot)).filter((fileName) => fileName.endsWith(".profile.tsx"));
        await Promise.all(sourceFiles.map((fileName) => copyFile(join(builtinRoot, fileName), join(profileRoot, basename(fileName)))));

        const result = await compileProfileArtifacts({
            profileRoot,
            stagingRoot,
            skipFresh: true,
            rootLabel: "profile-sdk-contract",
            orphanBudgetPolicy: "product",
        });

        expect(result.manifest.entries).toHaveLength(14);
        expect(result.manifest.entries.filter((entry) => entry.status === "compile_failed")).toEqual([]);
        expect(result.compiled).toHaveLength(14);
    }, 120_000);
});
