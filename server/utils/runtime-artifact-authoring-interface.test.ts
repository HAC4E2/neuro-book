import {mkdir, mkdtemp, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {validateRuntimeArtifactAuthoring} from "nbook/server/utils/runtime-artifact-authoring-interface";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Runtime Artifact Authoring Interface", () => {
    it("递归验证 helper，并允许 SDK、相对模块和 Runtime builtin", async () => {
        const root = await fixtureRoot();
        await writeFile(join(root, "entry.ts"), [
            'import {Type} from "nbook/profile-sdk";',
            'export {value} from "./helper";',
            'void import("node:path");',
        ].join("\n"), "utf8");
        await writeFile(join(root, "helper.ts"), 'export const value = require("node:crypto");\n', "utf8");

        const graph = await validateRuntimeArtifactAuthoring({
            kind: "profile",
            root,
            entry: join(root, "entry.ts"),
            allowedSdkSpecifiers: ["nbook/profile-sdk", "nbook/profile-sdk/writing"],
        });

        expect(graph.files).toHaveLength(2);
        expect(graph.files.some((file) => file.endsWith("helper.ts"))).toBe(true);
    });

    it.each([
        ['import value from "zod";', "zod"],
        ['import value = require("zod");', "zod"],
        ['import "C:/outside.ts";', "C:/outside.ts"],
        ['const value = import(packageName);', "dynamic import 必须使用字符串字面量"],
        ['const value = require(packageName);', "require 必须使用字符串字面量"],
    ])("拒绝 helper 中的非法模块形式：%s", async (helperSource, expected) => {
        const root = await fixtureRoot();
        await writeFile(join(root, "entry.ts"), 'export * from "./helper";\n', "utf8");
        await writeFile(join(root, "helper.ts"), `${helperSource}\nexport const value = true;\n`, "utf8");

        await expect(validateRuntimeArtifactAuthoring({
            kind: "variable",
            root,
            entry: join(root, "entry.ts"),
            allowedSdkSpecifiers: ["nbook/variable-sdk"],
        })).rejects.toThrow(expected);
    });

    it("拒绝相对路径越界", async () => {
        const parent = await fixtureRoot();
        const root = join(parent, "authoring");
        await mkdir(root);
        await writeFile(join(parent, "outside.ts"), "export const outside = true;\n", "utf8");
        await writeFile(join(root, "entry.ts"), 'export * from "../outside";\n', "utf8");

        await expect(validateRuntimeArtifactAuthoring({
            kind: "profile",
            root,
            entry: join(root, "entry.ts"),
            allowedSdkSpecifiers: ["nbook/profile-sdk"],
        })).rejects.toThrow("realpath 越界");
    });

    it("拒绝 symlink realpath 逃出 authoring root", async () => {
        const parent = await fixtureRoot();
        const root = join(parent, "authoring");
        const outside = join(parent, "outside");
        await Promise.all([mkdir(root), mkdir(outside)]);
        await writeFile(join(outside, "helper.ts"), "export const outside = true;\n", "utf8");
        await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
        await writeFile(join(root, "entry.ts"), 'export * from "./linked/helper";\n', "utf8");

        await expect(validateRuntimeArtifactAuthoring({
            kind: "profile",
            root,
            entry: join(root, "entry.ts"),
            allowedSdkSpecifiers: ["nbook/profile-sdk"],
        })).rejects.toThrow("realpath 越界");
    });
});

/** 创建自动清理的 authoring fixture root。 */
async function fixtureRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "nbook-authoring-interface-"));
    roots.push(root);
    return root;
}
