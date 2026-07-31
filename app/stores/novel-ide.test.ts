import {createPinia, defineStore, setActivePinia} from "pinia";
import {computed, ref, watch} from "vue";
import {beforeAll, beforeEach, describe, expect, it, vi} from "vitest";

type FetchMock = ReturnType<typeof vi.fn>;

describe("useNovelIdeStore deleteProject", () => {
    beforeAll(() => {
        const globals = globalThis as typeof globalThis & Record<string, unknown>;
        globals.defineStore = defineStore;
        globals.ref = ref;
        globals.computed = computed;
        globals.watch = watch;
        globals.piniaPluginPersistedstate = {
            sessionStorage: () => ({}),
        };
    });

    beforeEach(() => {
        setActivePinia(createPinia());
        (globalThis as typeof globalThis & {$fetch: typeof globalThis.$fetch}).$fetch = createFetchMock() as unknown as typeof globalThis.$fetch;
    });

    it("删除非当前书后清理对应 workspace session", async () => {
        const {useNovelIdeStore} = await import("nbook/app/stores/novel-ide");
        const store = useNovelIdeStore();
        store.currentProjectRoot = "current-book";
        store.novels = [
            projectFixture("current-book"),
            projectFixture("deleted-book"),
        ];
        store.workspaceSessions = {
            "novel:current-book": createWorkspaceSession("manuscript/current.md"),
            "novel:deleted-book": createWorkspaceSession("manuscript/deleted.md"),
        };

        await store.deleteProject("deleted-book");

        expect(store.workspaceSessions["novel:deleted-book"]).toBeUndefined();
        expect(store.workspaceSessions["novel:current-book"]).toBeDefined();
        expect(store.currentProjectRoot).toBe("current-book");
    });

    it("删除当前 Project 后进入未选择状态，不自动激活列表中的其它 Project", async () => {
        const {useNovelIdeStore} = await import("nbook/app/stores/novel-ide");
        const store = useNovelIdeStore();
        store.currentProjectRoot = "deleted-book";
        store.novels = [
            projectFixture("deleted-book"),
            projectFixture("next-book"),
        ];
        store.activeWorkspaceTabPath = "manuscript/deleted.md";
        store.workspaceTabs = [{
            path: "manuscript/deleted.md",
            title: "旧标签",
            editorKind: "markdown" as const,
            viewMode: "rich" as const,
            pinned: false,
            preview: false,
            dirty: false,
        }];
        store.workspaceSessions = {
            "novel:deleted-book": createWorkspaceSession("manuscript/deleted.md"),
            "novel:next-book": createWorkspaceSession("manuscript/next.md"),
        };

        await store.deleteProject("deleted-book");

        expect(store.workspaceSessions["novel:deleted-book"]).toBeUndefined();
        expect(store.workspaceSessions["novel:next-book"]).toBeDefined();
        expect(store.currentProjectRoot).toBe("");
        expect(store.activeWorkspaceTabPath).not.toBe("manuscript/deleted.md");
        expect(globalThis.$fetch).not.toHaveBeenCalledWith("/api/workspace-files/tree", expect.anything());
    });

    it("初始化主入口不发送 include-only 查询", async () => {
        const {useNovelIdeStore} = await import("nbook/app/stores/novel-ide");
        const store = useNovelIdeStore();
        store.currentProjectRoot = "current-book";

        await store.initializeWorkspace();

        expect(globalThis.$fetch).toHaveBeenCalledWith("/api/projects");
        expect(store.currentProjectRoot).toBe("current-book");
    });

    it("初始化发现 Current Project 已缺失时进入未选择状态，不回退到第一项", async () => {
        const {useNovelIdeStore} = await import("nbook/app/stores/novel-ide");
        const store = useNovelIdeStore();
        store.currentProjectRoot = "missing-book";

        await store.initializeWorkspace();

        expect(store.currentProjectRoot).toBe("");
        expect(globalThis.$fetch).not.toHaveBeenCalledWith("/api/workspace-files/tree", expect.anything());
    });

    it("新建 Project 后刷新列表时包含新 Project，避免 route 规范化回旧书", async () => {
        const {useNovelIdeStore} = await import("nbook/app/stores/novel-ide");
        const store = useNovelIdeStore();

        const createdId = await store.createProject("新 Project", "");

        expect(createdId).toBe("created-book");
        expect(globalThis.$fetch).toHaveBeenCalledWith("/api/projects");
        expect(store.novels.some((novel) => novel.projectRoot === "created-book")).toBe(true);
    });
});

function createFetchMock(): FetchMock {
    let createdProjectVisible = false;
    return vi.fn(async (url: string, options?: {method?: string}) => {
        if (url === "/api/projects" && "method" in (options ?? {}) && (options as {method?: string}).method === "POST") {
            createdProjectVisible = true;
            return {revision: 2, project: projectFixture("created-book")};
        }
        if (url === "/api/projects/item") {
            return {success: true};
        }
        if (url === "/api/projects") {
            // 列表接口返回全量 manifest，不再接受 include/exclude/limit 裁剪参数。
            const novels = [
                projectFixture("next-book"),
                projectFixture("current-book"),
                projectFixture("ming-ding-zhi-shi-2"),
            ];
            if (createdProjectVisible) {
                novels.push(projectFixture("created-book"));
            }
            return {revision: 1, projects: novels};
        }
        if (url === "/api/workspace-files/tree") {
            return {
                nodes: [],
                issues: [],
                revision: 1,
                validatedAt: new Date().toISOString(),
            };
        }
        throw new Error(`Unexpected fetch: ${url}`);
    });
}

function projectFixture(projectRoot: string) {
    return {
        projectRoot,
        kind: "novel" as const,
        title: projectRoot,
        summary: "",
        manifestUpdatedAt: "2026-01-01T00:00:00.000Z",
    };
}

function createWorkspaceSession(path: string) {
    return {
        activeWorkspaceTabPath: path,
        workspaceTabs: [{
            path,
            title: path,
            editorKind: "markdown" as const,
            viewMode: "rich" as const,
            pinned: false,
            preview: false,
            dirty: false,
        }],
        workspaceBuffers: {},
        monacoFontSizeOverridesByPath: {},
    };
}
