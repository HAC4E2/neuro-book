import {mkdtemp, mkdir, rm, stat, symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const mockedRuntime = vi.hoisted(() => ({
    roots: new Map<string, string>(),
    assertProjectOpen: vi.fn(),
}));

vi.mock("nbook/server/text-to-image/compat", () => ({
    resolveWorkspaceRootInput: async ({projectPath}: {projectPath: string}) => {
        const root = mockedRuntime.roots.get(projectPath);
        if (!root) {
            throw new Error(`unknown project: ${projectPath}`);
        }
        return root;
    },
}));

vi.mock("nbook/server/workspace-files/project-session", () => ({
    assertProjectOpen: mockedRuntime.assertProjectOpen,
}));

import {
    assertTextToImageReferenceMutationScope,
    TextToImageReferenceLockError,
    withTextToImageReferenceMutationLock,
} from "nbook/server/text-to-image/reference-asset-lock";

const temporaryDirectories: string[] = [];

beforeEach(() => {
    mockedRuntime.roots.clear();
    mockedRuntime.assertProjectOpen.mockReset();
});

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {recursive: true, force: true})));
});

describe("文生图引用资产项目锁", () => {
    it("同一 Project 跨调用串行，不同 Project 可并发", async () => {
        const firstRoot = await createProject("first");
        const secondRoot = await createProject("second");
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        let firstEntered!: () => void;
        const entered = new Promise<void>((resolve) => {
            firstEntered = resolve;
        });
        const order: string[] = [];

        const first = withTextToImageReferenceMutationLock("first", async () => {
            order.push("first:start");
            firstEntered();
            await firstGate;
            order.push("first:end");
        });
        await entered;
        const sameProject = withTextToImageReferenceMutationLock("first", async () => {
            order.push("same:start");
        });
        const otherProject = withTextToImageReferenceMutationLock("second", async (scope) => {
            assertTextToImageReferenceMutationScope(scope, {projectPath: "second", projectRoot: secondRoot});
            order.push("other:start");
        });

        await otherProject;
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(order).toEqual(["first:start", "other:start"]);
        expect(firstRoot).not.toBe(secondRoot);

        releaseFirst();
        await Promise.all([first, sameProject]);
        expect(order).toEqual(["first:start", "other:start", "first:end", "same:start"]);
        expect((await stat(path.join(
            firstRoot,
            ".nbook",
            "text-to-image",
            "references",
            ".mutation-lock-target",
        ))).isFile()).toBe(true);
    });

    it("scope 只在回调内有效，并严格绑定 Project 与 root", async () => {
        const root = await createProject("scope-project");
        let captured: Parameters<typeof assertTextToImageReferenceMutationScope>[0] | undefined;

        await withTextToImageReferenceMutationLock("scope-project", async (scope) => {
            captured = scope;
            expect(Object.isFrozen(scope)).toBe(true);
            expect(() => assertTextToImageReferenceMutationScope(scope, {
                projectPath: "scope-project",
                projectRoot: root,
            })).not.toThrow();
            expect(() => assertTextToImageReferenceMutationScope(scope, {
                projectPath: "other-project",
                projectRoot: root,
            })).toThrow(TextToImageReferenceLockError);
            expect(() => assertTextToImageReferenceMutationScope({} as never, {
                projectPath: "scope-project",
                projectRoot: root,
            })).toThrow(TextToImageReferenceLockError);
        });

        expect(() => assertTextToImageReferenceMutationScope(captured!, {
            projectPath: "scope-project",
            projectRoot: root,
        })).toThrow(TextToImageReferenceLockError);
    });

    it("嵌套获取锁会确定性失败，不会自锁等待", async () => {
        await createProject("nested");

        await expect(withTextToImageReferenceMutationLock("nested", async () => {
            await withTextToImageReferenceMutationLock("nested", async () => {});
        })).rejects.toMatchObject({code: "REFERENCE_MUTATION_LOCK_NESTED"});
    });

    it("引用根目录是越界 symlink/junction 时 fail closed", async () => {
        const root = await createProject("linked");
        const outside = await createTemporaryDirectory("outside");
        const textToImageRoot = path.join(root, ".nbook", "text-to-image");
        await mkdir(textToImageRoot, {recursive: true});
        await symlink(
            outside,
            path.join(textToImageRoot, "references"),
            process.platform === "win32" ? "junction" : "dir",
        );

        await expect(withTextToImageReferenceMutationLock("linked", async () => {})).rejects.toBeInstanceOf(
            TextToImageReferenceLockError,
        );
    });
});

async function createProject(projectPath: string): Promise<string> {
    const root = await createTemporaryDirectory(projectPath);
    await mkdir(path.join(root, ".nbook"), {recursive: true});
    mockedRuntime.roots.set(projectPath, root);
    return root;
}

async function createTemporaryDirectory(label: string): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), `nbook-reference-lock-${label}-`));
    temporaryDirectories.push(directory);
    return directory;
}
