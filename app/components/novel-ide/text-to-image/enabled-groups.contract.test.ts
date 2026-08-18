// @vitest-environment jsdom
// 启用分组 UI 契约：数量标题、非纯颜色标识、请求中状态、唯一启用与零启用警示。
import {createApp, nextTick, type App, type Component} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import TextToImageCharacterSection from "nbook/app/components/novel-ide/text-to-image/TextToImageCharacterSection.vue";

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
    for (let round = 0; round < 8; round += 1) {
        await nextTick();
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
    const button = [...root.querySelectorAll("button")].find((item) => (item.textContent ?? "").includes(text));
    if (!button) throw new Error(`未找到包含“${text}”的按钮`);
    return button as HTMLButtonElement;
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

const heroCharacter = () => ({
    characterId: "hero",
    files: [{
        visualId: "visual-hero",
        fileName: "visual.json",
        createdAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T00:00:00.000Z",
        source: "manual" as const,
        active: true,
    }],
});

function stubLibrary(groups: GroupFixture[], activationHandler?: (body: {enabledGroupIds: string[]}) => Promise<unknown> | unknown): void {
    let current = JSON.parse(JSON.stringify(groups)) as GroupFixture[];
    fetchMock = vi.fn(async (url: string, options: Record<string, unknown> = {}) => {
        if (url === "/api/text-to-image/character-library") {
            return {groups: JSON.parse(JSON.stringify(current))};
        }
        if (url === "/api/text-to-image/character-library/files") {
            const query = options.query as {visualId: string};
            const file = current[0]?.characters[0]?.files[0]!;
            return {
                visual: {
                    schema: "nbook.character-visual/v1",
                    visualId: query.visualId,
                    characterId: "hero",
                    character: {cnName: "hero"},
                    outfits: [],
                    photos: [],
                },
                file,
                files: current[0]?.characters[0]?.files ?? [],
            };
        }
        if (url === "/api/text-to-image/character-library.activation") {
            const body = options.body as {enabledGroupIds: string[]};
            const result = activationHandler ? await activationHandler(body) : {enabled: true};
            void result;
            current = current.map((group) => ({...group, enabled: body.enabledGroupIds.includes(group.groupId)}));
            return {groups: current.map(({characters: _characters, ...group}) => group)};
        }
        throw new Error(`未接住的请求：${url}`);
    });
    vi.stubGlobal("$fetch", fetchMock);
}

describe("启用分组 UI 契约", () => {
    it("标题显示已启用数量，卡片有非纯颜色标识，零启用组出现警示", async () => {
        stubLibrary([
            makeGroup("default", "默认分组", [heroCharacter()], true),
            makeGroup("group-late", "后期", [], false),
        ]);
        const mount = mountComponent(TextToImageCharacterSection, {projectRoot: "p1"});
        await settle();

        expect(mount.root.textContent).toContain("启用");
        buttonByText(mount.root, "当前启用角色分组").click();
        await settle();

        expect(mount.root.textContent).toContain("已启用 1 / 2 个分组");
        const defaultCard = [...mount.root.querySelectorAll("button[role='checkbox']")].find((item) => (item.textContent ?? "").includes("默认分组")) as HTMLButtonElement;
        const lateCard = [...mount.root.querySelectorAll("button[role='checkbox']")].find((item) => (item.textContent ?? "").includes("后期")) as HTMLButtonElement;
        expect(defaultCard.getAttribute("aria-checked")).toBe("true");
        expect(defaultCard.textContent).toContain("已启用");
        expect(lateCard.getAttribute("aria-checked")).toBe("false");
        expect(lateCard.textContent).toContain("未启用");
        expect(mount.root.textContent).not.toContain("正文不会自动注入角色");

        // 关闭默认分组后出现零启用警示。
        let resolveActivation: (value: unknown) => void = () => undefined;
        const deferred = new Promise<unknown>((resolve) => {
            resolveActivation = resolve;
        });
        fetchMock.mockImplementation(async (url: string, options: Record<string, unknown> = {}) => {
            if (url === "/api/text-to-image/character-library") {
                return {groups: [
                    makeGroup("default", "默认分组", [heroCharacter()], true),
                    makeGroup("group-late", "后期", [], false),
                ]};
            }
            if (url === "/api/text-to-image/character-library.activation") {
                return deferred;
            }
            throw new Error(`未接住的请求：${url}`);
        });
        defaultCard.click();
        await settle();
        expect(defaultCard.textContent).toContain("正在更新…");
        resolveActivation({groups: [{groupId: "default", enabled: false}, {groupId: "group-late", enabled: false}]});
        await settle();
        expect(mount.root.textContent).toContain("已启用 0 / 2 个分组");
        expect(mount.root.textContent).toContain("正文不会自动注入角色，只生成场景内容");
    });

    it("更新期间只有目标卡片显示 pending，成功后以 API 返回状态更新", async () => {
        stubLibrary([
            makeGroup("default", "默认分组", [heroCharacter()], true),
            makeGroup("group-late", "后期", [], false),
        ]);
        const mount = mountComponent(TextToImageCharacterSection, {projectRoot: "p1"});
        await settle();
        buttonByText(mount.root, "当前启用角色分组").click();
        await settle();

        let resolveActivation: (value: unknown) => void = () => undefined;
        const deferred = new Promise<unknown>((resolve) => {
            resolveActivation = resolve;
        });
        const captured: {body: {enabledGroupIds: string[]} | null} = {body: null};
        fetchMock.mockImplementation(async (url: string, options: Record<string, unknown> = {}) => {
            if (url === "/api/text-to-image/character-library") {
                return {groups: [
                    makeGroup("default", "默认分组", [heroCharacter()], true),
                    makeGroup("group-late", "后期", [], false),
                ]};
            }
            if (url === "/api/text-to-image/character-library.activation") {
                captured.body = options.body as {enabledGroupIds: string[]};
                return deferred;
            }
            throw new Error(`未接住的请求：${url}`);
        });

        const lateCard = [...mount.root.querySelectorAll("button[role='checkbox']")].find((item) => (item.textContent ?? "").includes("后期")) as HTMLButtonElement;
        lateCard.click();
        await settle();

        expect(captured.body?.enabledGroupIds).toEqual(["default", "group-late"]);
        expect(lateCard.textContent).toContain("正在更新…");
        const defaultCard = [...mount.root.querySelectorAll("button[role='checkbox']")].find((item) => (item.textContent ?? "").includes("默认分组")) as HTMLButtonElement;
        expect(defaultCard.textContent).not.toContain("正在更新…");

        // 服务端实际返回与本地推测不同：以 API 返回为准（这里模拟服务端拒绝启用后期组）。
        resolveActivation({groups: [{groupId: "default", enabled: true}, {groupId: "group-late", enabled: false}]});
        await settle();
        expect(mount.root.textContent).toContain("已启用 1 / 2 个分组");
        expect(lateCard.textContent).toContain("未启用");
    });

    it("唯一启用时“仅启用此组”显示当前唯一启用并禁用；双击只提交一次", async () => {
        let activationCalls = 0;
        let resolveActivation: (value: unknown) => void = () => undefined;
        const deferred = new Promise<unknown>((resolve) => {
            resolveActivation = resolve;
        });
        stubLibrary([
            makeGroup("default", "默认分组", [heroCharacter()], true),
            makeGroup("group-late", "后期", [], false),
        ], () => {
            activationCalls += 1;
            return deferred;
        });
        const mount = mountComponent(TextToImageCharacterSection, {projectRoot: "p1"});
        await settle();
        buttonByText(mount.root, "当前启用角色分组").click();
        await settle();

        const onlyButtons = [...mount.root.querySelectorAll("button")].filter((item) => /仅启用|唯一启用/u.test(item.textContent ?? ""));
        expect(onlyButtons).toHaveLength(2);
        const soleButton = onlyButtons.find((item) => (item.textContent ?? "").includes("当前唯一启用")) as HTMLButtonElement;
        expect(soleButton).toBeTruthy();
        expect(soleButton.disabled).toBe(true);

        const lateOnly = onlyButtons.find((item) => (item.textContent ?? "").includes("后期")) as HTMLButtonElement;
        lateOnly.click();
        lateOnly.click();
        await settle();
        expect(activationCalls).toBe(1);
        resolveActivation({groups: [{groupId: "default", enabled: false}, {groupId: "group-late", enabled: true}]});
        await settle();
        expect(mount.root.textContent).toContain("已启用 1 / 2 个分组");
    });

    it("侧栏分组节点同时显示可读的“启用”标识", async () => {
        stubLibrary([
            makeGroup("default", "默认分组", [heroCharacter()], true),
            makeGroup("group-late", "后期", [], false),
        ]);
        const mount = mountComponent(TextToImageCharacterSection, {projectRoot: "p1"});
        await settle();

        const sidebarButtons = [...mount.root.querySelectorAll("aside button")].filter((item) => (item.textContent ?? "").includes("默认分组"));
        expect(sidebarButtons.length).toBeGreaterThan(0);
        expect(sidebarButtons[0]!.textContent).toContain("启用");
        const lateButtons = [...mount.root.querySelectorAll("aside button")].filter((item) => (item.textContent ?? "").includes("后期"));
        expect(lateButtons[0]!.textContent).not.toContain("启用");
    });
});
