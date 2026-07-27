import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {initProjectDatabase, writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {closeWorkspaceTreeIndex} from "nbook/server/workspace-files/project-workspace-index";
import {writeWorkspaceTextFile} from "nbook/server/workspace-files/workspace-files";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {normalizeProjectPath, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {isProjectOpen} from "nbook/server/workspace-files/project-session";
import {invalidateNovelListCache, listNovels} from "nbook/server/utils/novel-chapter";

describe("Project 列表只读 manifest", () => {
    const originalCwd = process.cwd();
    let root: string;
    let workspaceRoot: AbsoluteFsPath;

    beforeEach(async () => {
        root = path.join(os.tmpdir(), "neuro-book-novel-list-test", randomUUID());
        await fs.mkdir(path.join(root, "assets", "workspace", ".nbook"), {recursive: true});
        process.chdir(root);
        workspaceRoot = absoluteFsPath(path.join(root, "workspace"));
        invalidateNovelListCache();
    });

    afterEach(async () => {
        invalidateNovelListCache();
        await closeWorkspaceTreeIndex(absoluteFsPath(path.join(root, "workspace", "novel-a")));
        await closeWorkspaceTreeIndex(absoluteFsPath(path.join(root, "workspace", "novel-b")));
        process.chdir(originalCwd);
        await removeDirectoryWithRetry(root);
    });

    it("列表项只包含 manifest 元数据，不含任何内容统计字段", async () => {
        await writeProjectManifest(workspaceRoot, "workspace/novel-a", {
            kind: "novel",
            title: "小说 A",
            summary: "摘要 A",
        });

        const [novel] = await listNovels();

        expect(novel).toEqual({
            id: "workspace/novel-a",
            title: "小说 A",
            summary: "摘要 A",
            workspaceSlug: "novel-a",
            projectPath: "workspace/novel-a",
            manifestError: undefined,
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
        });
    });

    it("列表读取使用短 TTL 缓存，失效后重新读取 manifest", async () => {
        await writeProjectManifest(workspaceRoot, "workspace/novel-a", {
            kind: "novel",
            title: "初始标题",
            summary: "",
        });

        const first = createTimingRecorder();
        await listNovels({timingSink: first.sink});
        await writeProjectManifest(workspaceRoot, "workspace/novel-a", {
            kind: "novel",
            title: "改后标题",
            summary: "",
        });

        // 缓存未失效：仍返回旧标题。
        const cachedDiagnostics: {projectListCache?: string} = {};
        const cached = await listNovels({diagnostics: cachedDiagnostics});
        expect(cached[0]?.title).toBe("初始标题");
        expect(cachedDiagnostics.projectListCache).toBe("hit");

        invalidateNovelListCache();
        const refreshedDiagnostics: {projectListCache?: string} = {};
        const refreshed = await listNovels({diagnostics: refreshedDiagnostics});
        expect(refreshed[0]?.title).toBe("改后标题");
        expect(refreshedDiagnostics.projectListCache).toBe("miss");
    });

    /**
     * Phase 4B 退出条件：列表请求不得成为 File Index、Project SQLite 或 Agent session store 的持有者。
     *
     * 这里用 timing 分段作为判据——统计链的每一段都有独立 mark，只要它们从不出现，
     * 对应的扫描/查询就从未发生；再补一条 ProjectSession 未被打开的断言。
     */
    it("连续 100 次列表读取不触碰 File Index、Project SQLite 或 Agent session", async () => {
        for (const slug of ["novel-a", "novel-b"]) {
            const projectPath = `workspace/${slug}`;
            await writeProjectManifest(workspaceRoot, projectPath, {
                kind: "novel",
                title: slug,
                summary: "",
            });
            // 真实内容与真实 SQLite：旧统计链会扫描前者、打开后者。
            await writeMarkdown(workspaceRoot, projectPath, "manuscript/001.md", {
                entryType: "chapter",
                title: "第一章",
            }, "正文内容");
            await initProjectDatabase(workspaceRoot, projectPath);
        }
        invalidateNovelListCache();

        const recorder = createTimingRecorder();
        for (let index = 0; index < 100; index += 1) {
            invalidateNovelListCache();
            await listNovels({timingSink: recorder.sink});
        }

        const names = new Set(timingNames(recorder.marks));
        expect([...names].sort()).toEqual(["projects.manifests", "projects.total"]);
        for (const marker of ["projects.stats.workspace", "projects.stats.plot", "projects.stats.pending", "projects.sessions", "projects.filter"]) {
            expect(names.has(marker)).toBe(false);
        }
        expect(isProjectOpen("workspace/novel-a")).toBe(false);
        expect(isProjectOpen("workspace/novel-b")).toBe(false);
    });
});

describe("JsonlSessionRepository projectPath filter", () => {
    let root: string;
    let repo: JsonlSessionRepository;

    beforeEach(() => {
        root = path.join(os.tmpdir(), "neuro-book-session-filter-test", randomUUID());
        repo = new JsonlSessionRepository(root);
    });

    afterEach(async () => {
        await removeDirectoryWithRetry(root);
    });

    it("按 projectPath 筛选 session，并在摘要中保留 projectPath", async () => {
        const target = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: "workspace",
            workspaceKey: "global",
            projectPath: "workspace/novel-a",
        });
        await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: "workspace",
            workspaceKey: "global",
            projectPath: "workspace/novel-b",
        });

        const sessions = await repo.listSessions({projectPath: "workspace/novel-a"});

        expect(sessions).toHaveLength(1);
        expect(sessions[0]).toMatchObject({
            sessionId: target.metadata.sessionId,
            projectPath: "workspace/novel-a",
        });
    });
});

async function writeMarkdown(
    workspaceRoot: AbsoluteFsPath,
    projectPath: string,
    filePath: string,
    frontmatter: Record<string, string>,
    body: string,
): Promise<void> {
    const yaml = Object.entries(frontmatter)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join("\n");
    const projectRoot = resolveProjectWorkspaceRoot(workspaceRoot, normalizeProjectPath(projectPath));
    await writeWorkspaceTextFile(projectRoot, filePath, `---\n${yaml}\n---\n\n${body}`);
}

type TimingMark = {
    name: string;
    durationMs: number;
};

function createTimingRecorder(): {marks: TimingMark[]; sink: {mark(name: string, durationMs: number): void}} {
    const marks: TimingMark[] = [];
    return {
        marks,
        sink: {
            mark(name, durationMs) {
                marks.push({name, durationMs});
            },
        },
    };
}

function timingNames(marks: readonly TimingMark[]): string[] {
    return marks.map((mark) => mark.name);
}

async function removeDirectoryWithRetry(target: string): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
            await fs.rm(target, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
            return;
        } catch (error) {
            const code = typeof error === "object" && error !== null && "code" in error ? error.code : "";
            if (code !== "EBUSY" || attempt === 19) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
    }
}
