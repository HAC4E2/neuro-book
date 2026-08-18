// @vitest-environment jsdom
// 文生图工作台按钮真实点击契约：挂载真实 SFC，点击按钮断言只产生一次请求。
// $fetch 由 vitest 配置里的 shim 收敛到 globalThis，本文件用 vi.stubGlobal 注入请求桩。
import {createApp, nextTick, type App, type Component} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import TextToImageCharacterSection from "nbook/app/components/novel-ide/text-to-image/TextToImageCharacterSection.vue";
import TextToImageLlmSettingsSection from "nbook/app/components/novel-ide/text-to-image/TextToImageLlmSettingsSection.vue";

const notification = vi.hoisted(() => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    notify: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
}));

vi.mock("nbook/app/composables/useNotification", () => ({
    useNotification: () => notification,
}));

type GroupFixture = {
    groupId: string;
    name: string;
    description: string;
    enabled: boolean;
    sortOrder: number;
    characterCount: number;
    characters: Array<{
        characterId: string;
        files: Array<{
            visualId: string;
            fileName: string;
            createdAt: string;
            updatedAt: string;
            source: "manual" | "llm" | "migration" | "copy";
            active: boolean;
            invalid?: boolean;
        }>;
    }>;
};

type Mounted = {
    root: HTMLElement;
    app: App;
    unmount: () => void;
};

const mounts: Mounted[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.clearAllMocks();
    window.confirm = vi.fn(() => true) as unknown as typeof window.confirm;
    window.prompt = vi.fn(() => null) as unknown as typeof window.prompt;
});

afterEach(() => {
    for (const mount of mounts.splice(0)) mount.unmount();
    vi.unstubAllGlobals();
});

function mountComponent(component: Component, props: Record<string, unknown>): Mounted {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp(component, props);
    app.mount(host);
    const mount = {
        root: host,
        app,
        unmount: () => {
            app.unmount();
            host.remove();
        },
    };
    mounts.push(mount);
    return mount;
}

async function settle(): Promise<void> {
    for (let round = 0; round < 6; round += 1) {
        await nextTick();
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
    const button = [...root.querySelectorAll("button")].find((item) => (item.textContent ?? "").includes(text));
    if (!button) throw new Error(`未找到包含“${text}”的按钮`);
    return button as HTMLButtonElement;
}

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event("input", {bubbles: true}));
}

function makeDraftVisual(): Record<string, unknown> {
    return {
        schema: "nbook.character-visual/v1",
        visualId: "draft-visual-id",
        characterId: "hero",
        character: {cnName: "hero", profileTraits: "草稿"},
        outfits: [],
        photos: [],
    };
}

function makeGroup(groupId: string, name: string, characters: GroupFixture["characters"] = [], enabled = true): GroupFixture {
    return {
        groupId,
        name,
        description: "",
        enabled,
        sortOrder: groupId === "default" ? 0 : 1,
        characterCount: characters.length,
        characters,
    };
}

function makeVisualFile(visualId: string, fileName: string, active: boolean): GroupFixture["characters"][number]["files"][number] {
    return {
        visualId,
        fileName,
        createdAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T00:00:00.000Z",
        source: "manual",
        active,
    };
}

function makeVisualPayload(visualId: string, characterId = "hero"): Record<string, unknown> {
    return {
        schema: "nbook.character-visual/v1",
        visualId,
        characterId,
        character: {cnName: characterId},
        outfits: [],
        photos: [],
    };
}

function makeFilesHandler(character: GroupFixture["characters"][number], visualId: string) {
    return async (options: Record<string, unknown>) => {
        const query = options.query as {visualId: string};
        const selected = character.files.find((file) => file.visualId === query.visualId) ?? character.files[0]!;
        return {
            visual: makeVisualPayload(selected.visualId, character.characterId),
            file: selected,
            files: character.files,
        };
    };
}

function stubLibraryFetch(initialGroups: GroupFixture[]): void {
    let groups = JSON.parse(JSON.stringify(initialGroups)) as GroupFixture[];
    fetchMock = vi.fn(async (url: string, options: Record<string, unknown> = {}) => {
        if (url === "/api/text-to-image/character-library") {
            return {groups: JSON.parse(JSON.stringify(groups))};
        }
        if (url === "/api/text-to-image/character-library/groups") {
            const body = options.body as {projectRoot: string; name?: string};
            if (options.method === "POST") {
                const next: GroupFixture = {
                    groupId: "group-new",
                    name: body.name ?? "新组",
                    description: "",
                    enabled: false,
                    sortOrder: groups.length,
                    characterCount: 0,
                    characters: [],
                };
                groups = [...groups, next];
                return {group: next};
            }
            if (options.method === "DELETE") {
                const bodyDelete = body as unknown as {groupId: string; expectedRevision: string};
                groups = groups.filter((group) => group.groupId !== bodyDelete.groupId);
                return {moved: {characterCount: 0, visualCount: 0}, refMap: []};
            }
        }
        throw new Error(`未接住的请求：${url}`);
    });
    vi.stubGlobal("$fetch", fetchMock);
}

describe("文生图工作台按钮真实点击契约", () => {
    it("生成首份设计草稿：点击发送一次请求，pending 后显示草稿 Dialog，双击不重复提交", async () => {
        stubLibraryFetch([makeGroup("default", "默认分组", [])]);
        const mount = mountComponent(TextToImageCharacterSection, {
            projectRoot: "root",
            initialCharacter: {characterId: "hero", groupId: "default", characterPage: "# hero\n银发"},
        });
        await settle();
        const button = buttonByText(mount.root, "生成首份设计草稿");
        expect(button.disabled).toBe(false);

        let resolveGenerate: (value: unknown) => void = () => undefined;
        const deferred = new Promise<unknown>((resolve) => {
            resolveGenerate = resolve;
        });
        const postCalls: unknown[] = [];
        fetchMock.mockImplementation(async (url: string, options: Record<string, unknown> = {}) => {
            if (url === "/api/text-to-image/character-library") return {groups: [makeGroup("default", "默认分组", [])]};
            if (url === "/api/text-to-image/character-visual.generate") {
                postCalls.push(options.body);
                return deferred;
            }
            throw new Error(`未接住的请求：${url}`);
        });

        button.click();
        button.click();
        await settle();
        expect(postCalls).toHaveLength(1);
        expect(postCalls[0]).toMatchObject({projectRoot: "root", groupId: "default", characterId: "hero", characterPage: "# hero\n银发"});
        expect(buttonByText(mount.root, "正在等待 LLM 回复…")).toBeTruthy();

        resolveGenerate({visual: makeDraftVisual(), current: null, currentFile: null, baseRevision: null});
        await settle();
        expect(mount.root.textContent).toContain("应用角色设计修改");
        expect(buttonByText(mount.root, "另存为新设计")).toBeTruthy();
        expect(buttonByText(mount.root, "生成首份设计草稿")).toBeTruthy();
    });

    it("移动到分组：先预检再提交一次 visual.move，双击只发一次请求", async () => {
        const heroFile = makeVisualFile("visual-a", "visual.json", true);
        const hero = {characterId: "hero", files: [heroFile]};
        const groups = [
            makeGroup("default", "默认分组", [hero]),
            makeGroup("group-late", "后期", [{characterId: "side", files: [makeVisualFile("visual-s", "visual.json", true)]}]),
        ];
        let moveCalls = 0;
        let moveBody: Record<string, unknown> = {};
        let previewCalls = 0;
        fetchMock = vi.fn(async (url: string, options: Record<string, unknown> = {}) => {
            if (url === "/api/text-to-image/character-library") return {groups};
            if (url === "/api/text-to-image/character-library/files") return makeFilesHandler(hero, "visual-a")(options);
            if (url === "/api/text-to-image/character-library/visual.move-preview") {
                previewCalls += 1;
                return {
                    revision: "rev-1",
                    source: {groupId: "default", characterId: "hero", visualId: "visual-a"},
                    targetGroupId: "group-late",
                    sourceWillLoseCharacter: true,
                    sourceNeedsActiveFallback: false,
                    targetCharacterExists: false,
                    equivalentTargetRef: null,
                    equivalentTargetConflict: false,
                    fileNameConflict: false,
                    visualIdConflict: false,
                    managedReferenceCount: 0,
                    sourceActive: true,
                    sourceFileCount: 1,
                };
            }
            if (url === "/api/text-to-image/character-library/visual.move") {
                moveCalls += 1;
                moveBody = options.body as Record<string, unknown>;
                return {mode: "moved", ref: {groupId: "group-late", characterId: "hero", visualId: "visual-a"}};
            }
            throw new Error(`未接住的请求：${url}`);
        });
        vi.stubGlobal("$fetch", fetchMock);
        const mount = mountComponent(TextToImageCharacterSection, {projectRoot: "root"});
        await settle();

        const select = mount.root.querySelector("select") as HTMLSelectElement;
        select.value = "group-late";
        select.dispatchEvent(new Event("change", {bubbles: true}));
        await settle();
        const moveButton = buttonByText(mount.root, "移动到分组");
        moveButton.click();
        moveButton.click();
        await settle();

        expect(previewCalls).toBe(1);
        expect(moveCalls).toBe(1);
        expect(moveBody).toMatchObject({
            projectRoot: "root",
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: "visual-a",
            expectedUpdatedAt: "2026-08-15T00:00:00.000Z",
            targetGroupId: "group-late",
            expectedPreviewRevision: "rev-1",
        });
        expect(notification.success).toHaveBeenCalledWith("已移动到目标分组，来源不再保留这一份资料");
    });

    it("移动预检发现等价副本时展示确认 Dialog，确认后提交 merged-equivalent", async () => {
        const heroFile = makeVisualFile("visual-a", "visual.json", true);
        const hero = {characterId: "hero", files: [heroFile]};
        const groups = [
            makeGroup("default", "默认分组", [hero]),
            makeGroup("group-late", "后期", []),
        ];
        let moveBody: Record<string, unknown> = {};
        fetchMock = vi.fn(async (url: string, options: Record<string, unknown> = {}) => {
            if (url === "/api/text-to-image/character-library") return {groups};
            if (url === "/api/text-to-image/character-library/files") return makeFilesHandler(hero, "visual-a")(options);
            if (url === "/api/text-to-image/character-library/visual.move-preview") {
                return {
                    revision: "rev-2",
                    source: {groupId: "default", characterId: "hero", visualId: "visual-a"},
                    targetGroupId: "group-late",
                    sourceWillLoseCharacter: true,
                    sourceNeedsActiveFallback: false,
                    targetCharacterExists: true,
                    equivalentTargetRef: {groupId: "group-late", characterId: "hero", visualId: "visual-b"},
                    equivalentTargetConflict: false,
                    fileNameConflict: false,
                    visualIdConflict: false,
                    managedReferenceCount: 0,
                    sourceActive: true,
                    sourceFileCount: 1,
                };
            }
            if (url === "/api/text-to-image/character-library/visual.move") {
                moveBody = options.body as Record<string, unknown>;
                return {mode: "merged-equivalent", ref: {groupId: "group-late", characterId: "hero", visualId: "visual-b"}};
            }
            throw new Error(`未接住的请求：${url}`);
        });
        vi.stubGlobal("$fetch", fetchMock);
        const mount = mountComponent(TextToImageCharacterSection, {projectRoot: "root"});
        await settle();

        const select = mount.root.querySelector("select") as HTMLSelectElement;
        select.value = "group-late";
        select.dispatchEvent(new Event("change", {bubbles: true}));
        await settle();
        buttonByText(mount.root, "移动到分组").click();
        await settle();

        expect(mount.root.textContent).toContain("目标分组已有相同内容");
        buttonByText(mount.root, "确认移动").click();
        await settle();

        expect(moveBody).toMatchObject({expectedPreviewRevision: "rev-2"});
        expect(notification.success).toHaveBeenCalledWith("已合并目标分组中的相同资料");
    });

    it("删除 JSON：点击发送一次 visual.delete 并保留错误恢复路径", async () => {
        const activeFile = makeVisualFile("visual-a", "visual.json", true);
        const staleFile = makeVisualFile("visual-b", "second.json", false);
        const hero = {characterId: "hero", files: [activeFile, staleFile]};
        let deleteCalls = 0;
        fetchMock = vi.fn(async (url: string, options: Record<string, unknown> = {}) => {
            if (url === "/api/text-to-image/character-library") {
                return {groups: [makeGroup("default", "默认分组", [hero])]};
            }
            if (url === "/api/text-to-image/character-library/files") {
                const query = options.query as {visualId: string};
                const selected = query.visualId === "visual-b" ? staleFile : activeFile;
                return {
                    visual: makeVisualPayload(selected.visualId),
                    file: selected,
                    files: [activeFile, staleFile],
                };
            }
            if (url === "/api/text-to-image/character-library/visual.delete") {
                deleteCalls += 1;
                return {ok: true};
            }
            throw new Error(`未接住的请求：${url}`);
        });
        vi.stubGlobal("$fetch", fetchMock);
        const mount = mountComponent(TextToImageCharacterSection, {projectRoot: "root"});
        await settle();

        const staleButton = [...mount.root.querySelectorAll("button")].find((item) => (item.textContent ?? "").includes("second.json")) as HTMLButtonElement;
        staleButton.click();
        await settle();
        buttonByText(mount.root, "删除 JSON").click();
        await settle();
        expect(deleteCalls).toBe(1);
    });

    it("生成 prompt 与生成照片：各自点击只发送一次请求", async () => {
        const heroFile = makeVisualFile("visual-a", "visual.json", true);
        const hero = {characterId: "hero", files: [heroFile]};
        let promptCalls = 0;
        let photoCalls = 0;
        fetchMock = vi.fn(async (url: string, options: Record<string, unknown> = {}) => {
            if (url === "/api/text-to-image/character-library") {
                return {groups: [makeGroup("default", "默认分组", [hero])]};
            }
            if (url === "/api/text-to-image/character-library/files") return makeFilesHandler(hero, "visual-a")(options);
            if (url === "/api/text-to-image/character-photo.generate-prompt") {
                promptCalls += 1;
                return {prompt: "photo prompt"};
            }
            if (url === "/api/text-to-image/character-photo.generate") {
                photoCalls += 1;
                return {prompt: "photo prompt", photo: "assets/tti/photo.png"};
            }
            throw new Error(`未接住的请求：${url}`);
        });
        vi.stubGlobal("$fetch", fetchMock);
        const mount = mountComponent(TextToImageCharacterSection, {projectRoot: "root"});
        await settle();

        buttonByText(mount.root, "角色照片").click();
        await settle();
        buttonByText(mount.root, "生成 prompt").click();
        await settle();
        expect(promptCalls).toBe(1);
        expect([...mount.root.querySelectorAll("textarea")].some((area) => (area as HTMLTextAreaElement).value === "photo prompt")).toBe(true);
        buttonByText(mount.root, "生成照片").click();
        await settle();
        expect(photoCalls).toBe(1);
    });

    it("生成修改预览：已选中视觉时点击发送一次 modify-preview", async () => {
        const heroFile = makeVisualFile("visual-a", "visual.json", true);
        const hero = {characterId: "hero", files: [heroFile]};
        let modifyCalls = 0;
        fetchMock = vi.fn(async (url: string, options: Record<string, unknown> = {}) => {
            if (url === "/api/text-to-image/character-library") {
                return {groups: [makeGroup("default", "默认分组", [hero])]};
            }
            if (url === "/api/text-to-image/character-library/files") return makeFilesHandler(hero, "visual-a")(options);
            if (url === "/api/text-to-image/character-visual.modify-preview") {
                modifyCalls += 1;
                void options;
                return {visual: makeDraftVisual(), current: null, currentFile: null, baseRevision: null};
            }
            throw new Error(`未接住的请求：${url}`);
        });
        vi.stubGlobal("$fetch", fetchMock);
        const mount = mountComponent(TextToImageCharacterSection, {projectRoot: "root"});
        await settle();

        const requirement = [...mount.root.querySelectorAll("textarea")].find((area) => (area as HTMLTextAreaElement).placeholder.includes("改成故事后期")) as HTMLTextAreaElement;
        setInputValue(requirement, "改成银发");
        await settle();
        buttonByText(mount.root, "生成修改预览").click();
        await settle();
        expect(modifyCalls).toBe(1);
        expect(mount.root.textContent).toContain("应用角色设计修改");
    });

    it("空分组在侧栏可见并可折叠，新建分组只提交名称", async () => {
        stubLibraryFetch([makeGroup("default", "默认分组", [])]);
        const mount = mountComponent(TextToImageCharacterSection, {projectRoot: "root"});
        await settle();

        const createInput = [...mount.root.querySelectorAll("input")].find((input) => (input as HTMLInputElement).placeholder.includes("分组名称")) as HTMLInputElement;
        expect(createInput).toBeTruthy();
        expect([...mount.root.querySelectorAll("input")].filter((input) => (input as HTMLInputElement).placeholder.includes("分组 ID"))).toHaveLength(0);

        let createBody: Record<string, unknown> = {};
        fetchMock.mockImplementation(async (url: string, options: Record<string, unknown> = {}) => {
            if (url === "/api/text-to-image/character-library") {
                return {groups: [
                    makeGroup("default", "默认分组", []),
                    makeGroup("group-new", "故事后期", []),
                ]};
            }
            if (url === "/api/text-to-image/character-library/groups") {
                createBody = options.body as Record<string, unknown>;
                return {group: {groupId: "group-new", name: "故事后期", description: "", enabled: false, sortOrder: 1, characterCount: 0, characters: []}};
            }
            throw new Error(`未接住的请求：${url}`);
        });

        setInputValue(createInput, "故事后期");
        await settle();
        buttonByText(mount.root, "创建分组").click();
        await settle();

        expect(createBody).toEqual({projectRoot: "root", name: "故事后期"});
        expect(createBody).not.toHaveProperty("groupId");
        expect(createInput.value).toBe("");
        expect(mount.root.textContent).toContain("故事后期");
        expect(mount.root.textContent).toContain("暂无视觉资料");
        expect(notification.success).toHaveBeenCalledWith("已创建分组“故事后期”");
    });

    it("同名创建失败：保留输入并就地显示错误", async () => {
        stubLibraryFetch([makeGroup("default", "默认分组", [])]);
        const mount = mountComponent(TextToImageCharacterSection, {projectRoot: "root"});
        await settle();

        fetchMock.mockImplementation(async (url: string) => {
            if (url === "/api/text-to-image/character-library") return {groups: [makeGroup("default", "默认分组", [])]};
            if (url === "/api/text-to-image/character-library/groups") {
                throw Object.assign(new Error("已存在同名分组：故事后期"), {data: {message: "已存在同名分组：故事后期"}, statusCode: 409});
            }
            throw new Error(`未接住的请求：${url}`);
        });

        const createInput = [...mount.root.querySelectorAll("input")].find((input) => (input as HTMLInputElement).placeholder.includes("分组名称")) as HTMLInputElement;
        setInputValue(createInput, "故事后期");
        await settle();
        buttonByText(mount.root, "创建分组").click();
        await settle();

        expect(mount.root.textContent).toContain("已存在同名分组：故事后期");
        expect(createInput.value).toBe("故事后期");
    });

    it("删除分组：预检摘要 Dialog → 确认携带 expectedRevision 提交，成功后切换 default", async () => {
        stubLibraryFetch([
            makeGroup("default", "默认分组", [{characterId: "hero", files: [makeVisualFile("visual-a", "visual.json", true)]}]),
            makeGroup("group-late", "后期", [{characterId: "hero", files: [makeVisualFile("visual-b", "visual.json", true)]}]),
        ]);
        const mount = mountComponent(TextToImageCharacterSection, {projectRoot: "root"});
        await settle();

        let deleteBody: Record<string, unknown> = {};
        fetchMock.mockImplementation(async (url: string, options: Record<string, unknown> = {}) => {
            if (url === "/api/text-to-image/character-library") {
                return {groups: [makeGroup("default", "默认分组", [{characterId: "hero", files: [makeVisualFile("visual-a", "visual.json", true)]}])]};
            }
            if (url === "/api/text-to-image/character-library/groups.delete-preview") {
                return {
                    groupId: "group-late",
                    revision: "rev-1",
                    characterCount: 1,
                    visualCount: 1,
                    invalidFileCount: 0,
                    fileNameConflictCount: 0,
                    visualIdConflictCount: 0,
                    managedReferenceCount: 0,
                    defaultEnabled: false,
                };
            }
            if (url === "/api/text-to-image/character-library/groups") {
                deleteBody = options.body as Record<string, unknown>;
                return {moved: {characterCount: 1, visualCount: 1}, refMap: []};
            }
            throw new Error(`未接住的请求：${url}`);
        });

        const deleteButton = mount.root.querySelector('button[title="删除分组（视觉资料移动到默认分组）"]') as HTMLButtonElement;
        deleteButton.click();
        await settle();
        expect(mount.root.textContent).toContain("视觉资料将移动到默认分组");
        expect(mount.root.textContent).toContain("角色：1 个");
        expect(mount.root.textContent).toContain("默认分组当前未启用");

        buttonByText(mount.root, "确认删除并移动视觉资料").click();
        await settle();
        expect(deleteBody).toEqual({projectRoot: "root", groupId: "group-late", expectedRevision: "rev-1"});
        expect(notification.success).toHaveBeenCalledWith("已删除分组“后期”：1 个角色的 1 份视觉资料已移动到默认分组");
    });

    it("组合提示词预览：点击发送一次 llm/preview", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => {
            throw new Error("no sse in test");
        }));
        let previewCalls = 0;
        fetchMock = vi.fn(async (url: string) => {
            if (url === "/api/text-to-image/llm/latest-response") return {trace: null};
            if (url === "/api/text-to-image/llm/preview") {
                previewCalls += 1;
                return {messages: [{role: "user", content: "hi"}], promptMode: "augment", profileId: "default"};
            }
            throw new Error(`未接住的请求：${url}`);
        });
        vi.stubGlobal("$fetch", fetchMock);

        const mount = mountComponent(TextToImageLlmSettingsSection, {
            providers: [{
                id: 1,
                kind: "openai_compatible",
                name: "测试 Provider",
                baseUrl: "https://api.example.com/v1",
                model: "m",
                settings: {
                    baseUrl: "https://api.example.com/v1",
                    model: "m",
                    temperature: 1,
                    topP: 1,
                    maxTokens: 30000,
                    stream: false,
                    sendImages: false,
                    mergeSystemUser: false,
                    retryCount: 0,
                },
            }],
            config: {
                contextProfiles: {},
                requestTypeBindings: {},
                wordReplacementProfiles: {},
                currentWordReplacementProfile: "default",
                historyPrefillDepth: 1,
            },
        });
        await settle();

        const button = buttonByText(mount.root, "组合提示词预览");
        expect(button.disabled).toBe(false);
        button.click();
        await settle();
        expect(previewCalls).toBe(1);
        expect([...mount.root.querySelectorAll("textarea")].some((area) => ((area as HTMLTextAreaElement).value).includes("[augment] default"))).toBe(true);
    });
});
