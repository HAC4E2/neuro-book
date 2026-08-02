import {spawn} from "node:child_process";
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

    it("proper-lockfile sentinel 会让独立进程等到当前 Project mutation 释放", async () => {
        const root = await createProject("cross-process");
        const lockTarget = path.join(
            root,
            ".nbook",
            "text-to-image",
            "references",
            ".mutation-lock-target",
        );
        let childOutput = "";
        let childError = "";
        let childExit: Promise<number | null> | undefined;

        await withTextToImageReferenceMutationLock("cross-process", async () => {
            const child = spawn(process.execPath, ["-e", `
                const {lock} = require("proper-lockfile");
                process.stdout.write("attempting\\n");
                (async () => {
                    try {
                        const unexpectedRelease = await lock(process.env.NBOOK_TEST_REFERENCE_LOCK_TARGET, {
                            realpath: false,
                            retries: 0,
                        });
                        await unexpectedRelease();
                        throw new Error("child unexpectedly acquired the held lock");
                    } catch (error) {
                        if (!error || error.code !== "ELOCKED") throw error;
                        process.stdout.write("blocked\\n");
                    }
                    const release = await lock(process.env.NBOOK_TEST_REFERENCE_LOCK_TARGET, {
                        realpath: false,
                        stale: 30000,
                        update: 10000,
                        retries: {retries: 50, factor: 1.2, minTimeout: 20, maxTimeout: 250, randomize: true},
                    });
                    process.stdout.write("entered\\n");
                    await release();
                })().catch((error) => {
                    process.stderr.write(String(error && error.stack || error));
                    process.exitCode = 1;
                });
            `], {
                cwd: process.cwd(),
                env: {
                    ...process.env,
                    NBOOK_TEST_REFERENCE_LOCK_TARGET: lockTarget,
                },
                stdio: ["ignore", "pipe", "pipe"],
            });
            child.stdout.setEncoding("utf8");
            child.stderr.setEncoding("utf8");
            child.stdout.on("data", (chunk: string) => {
                childOutput += chunk;
            });
            child.stderr.on("data", (chunk: string) => {
                childError += chunk;
            });
            childExit = new Promise((resolve, reject) => {
                child.once("error", reject);
                child.once("exit", resolve);
            });

            await waitForOutput(() => childOutput.includes("blocked\n"));
            expect(childOutput).toBe("attempting\nblocked\n");
        });

        expect(await childExit).toBe(0);
        expect(childError).toBe("");
        expect(childOutput).toBe("attempting\nblocked\nentered\n");
    }, 15_000);

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

/** 等待子进程发出已准备竞争锁的信号，避免依赖固定启动耗时。 */
async function waitForOutput(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (!predicate()) {
        if (Date.now() >= deadline) {
            throw new Error("子进程未在限时内准备好锁竞争");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}
