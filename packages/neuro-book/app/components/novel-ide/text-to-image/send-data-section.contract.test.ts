// @vitest-environment jsdom
// 发送数据选择态契约：已保存/未保存两层状态、dirty 警示、数量徽标、ARIA 与离开保护。
import {createApp, defineComponent, h, nextTick, ref, type App, type Ref} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import TextToImageSendDataSection from "nbook/app/components/novel-ide/text-to-image/TextToImageSendDataSection.vue";

type Mounted = {
    root: HTMLElement;
    app: App;
    exposed: Record<string, unknown> | undefined;
    unmount: () => void;
};

const mounts: Mounted[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    for (const mount of mounts.splice(0)) mount.unmount();
    vi.unstubAllGlobals();
});

function mountComponent(component: Parameters<typeof createApp>[0], props: Record<string, unknown>): Mounted {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp(component, props);
    app.mount(host);
    const mount = {
        root: host,
        app,
        exposed: app._instance?.exposed as Record<string, unknown> | undefined,
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

function rowByTitle(root: HTMLElement, title: string): HTMLButtonElement {
    const button = [...root.querySelectorAll("button[role='checkbox']")].find((item) => (item.textContent ?? "").includes(title));
    if (!button) throw new Error(`未找到包含“${title}”的选项行`);
    return button as HTMLButtonElement;
}

const sendDataResponse = () => ({
    sendData: {
        lorebookPaths: [],
        characterIds: [],
        characterSelections: [],
        outfitSelections: [],
    },
    lorebookEntries: [{path: "lorebook/world/index.md", title: "世界设定"}],
    characters: [{
        characterId: "hero",
        groupId: "default",
        visualId: "123e4567-e89b-42d3-a456-426614174000",
        cnName: "英雄",
        enName: "Hero",
        outfits: [{name: "校服", cnName: "校服", enName: "Uniform"}],
    }],
});

describe("发送数据选择态契约", () => {
    it("已保存与页面内勾选分开表达：勾选后出现未保存警示，保存前保存按钮禁用", async () => {
        fetchMock = vi.fn(async (url: string, options: Record<string, unknown> = {}) => {
            if (url === "/api/text-to-image/project-send-data" && !options.method) return sendDataResponse();
            if (url === "/api/text-to-image/project-send-data" && options.method === "PUT") {
                return {sendData: (options.body as {sendData: unknown}).sendData};
            }
            throw new Error(`未接住的请求：${url}`);
        });
        vi.stubGlobal("$fetch", fetchMock);
        const mount = mountComponent(TextToImageSendDataSection, {projectRoot: "p1"});
        await settle();

        expect(mount.root.textContent).toContain("Lorebook 条目");
        expect(buttonByText(mount.root, "保存选择").disabled).toBe(true);
        const row = rowByTitle(mount.root, "世界设定");
        expect(row.getAttribute("aria-checked")).toBe("false");
        expect(row.textContent).toContain("未固定发送");

        row.click();
        await settle();

        expect(row.getAttribute("aria-checked")).toBe("true");
        expect(row.textContent).toContain("固定发送");
        expect(mount.root.textContent).toContain("有未保存更改，尚不会发送给 LLM");
        expect(buttonByText(mount.root, "保存选择").disabled).toBe(false);
        expect(mount.root.textContent).toContain("已选 1 / 1");

        buttonByText(mount.root, "保存选择").click();
        await settle();

        expect(mount.root.textContent).not.toContain("有未保存更改");
        expect(buttonByText(mount.root, "保存选择").disabled).toBe(true);
        expect(mount.root.textContent).toContain("发送数据已保存");
    });

    it("三栏标题与数量、徽标文案区分固定发送和未固定发送", async () => {
        fetchMock = vi.fn(async (url: string) => {
            if (url === "/api/text-to-image/project-send-data") return sendDataResponse();
            throw new Error(`未接住的请求：${url}`);
        });
        vi.stubGlobal("$fetch", fetchMock);
        const mount = mountComponent(TextToImageSendDataSection, {projectRoot: "p1"});
        await settle();

        expect(mount.root.textContent).toContain("角色固定发送列表");
        expect(mount.root.textContent).toContain("已选 0 / 1");
        rowByTitle(mount.root, "英雄").click();
        await settle();
        expect(rowByTitle(mount.root, "英雄").textContent).toContain("固定发送");
        rowByTitle(mount.root, "校服").click();
        await settle();
        expect(rowByTitle(mount.root, "校服").textContent).toContain("固定发送服装");
        expect(mount.root.textContent).toContain("启用角色分组”负责正文自动扫描；本页负责无条件固定发送");
    });

    it("保存失败保留编辑状态，允许重试", async () => {
        let failPut = true;
        fetchMock = vi.fn(async (url: string, options: Record<string, unknown> = {}) => {
            if (url === "/api/text-to-image/project-send-data" && !options.method) return sendDataResponse();
            if (url === "/api/text-to-image/project-send-data" && options.method === "PUT") {
                if (failPut) {
                    failPut = false;
                    throw new Error("保存失败");
                }
                return {sendData: (options.body as {sendData: unknown}).sendData};
            }
            throw new Error(`未接住的请求：${url}`);
        });
        vi.stubGlobal("$fetch", fetchMock);
        const mount = mountComponent(TextToImageSendDataSection, {projectRoot: "p1"});
        await settle();

        const row = rowByTitle(mount.root, "世界设定");
        row.click();
        await settle();
        buttonByText(mount.root, "保存选择").click();
        await settle();

        expect(row.getAttribute("aria-checked")).toBe("true");
        expect(mount.root.textContent).toContain("有未保存更改");
        expect(buttonByText(mount.root, "保存选择").disabled).toBe(false);

        buttonByText(mount.root, "保存选择").click();
        await settle();
        expect(mount.root.textContent).not.toContain("有未保存更改");
    });

    it("Project 快速切换时旧响应不覆盖新 Project 状态", async () => {
        const resolvers: Array<{projectRoot: string; resolve: (value: unknown) => void}> = [];
        const calls: string[] = [];
        fetchMock = vi.fn(async (url: string, options: Record<string, unknown> = {}) => {
            if (url === "/api/text-to-image/project-send-data") {
                const projectRoot = (options.query as {projectRoot: string}).projectRoot;
                calls.push(projectRoot);
                return new Promise((resolve) => {
                    resolvers.push({projectRoot, resolve});
                });
            }
            throw new Error(`未接住的请求：${url}`);
        });
        vi.stubGlobal("$fetch", fetchMock);

        const TestHost = defineComponent({
            setup(_props, {expose}) {
                const projectRoot = ref("p1");
                expose({projectRoot});
                return {projectRoot};
            },
            render(this: {projectRoot: string}) {
                return h(TextToImageSendDataSection, {projectRoot: this.projectRoot});
            },
        });
        const mount = mountComponent(TestHost, {});
        const hostRef = mount.exposed?.projectRoot as Ref<string>;
        await settle();

        hostRef.value = "p2";
        await settle();
        // 旧 Project 的迟到响应此刻才返回，不得覆盖 p2。
        const late = resolvers.find((item) => item.projectRoot === "p1")!;
        late.resolve({
            ...sendDataResponse(),
            lorebookEntries: [{path: "lorebook/old/index.md", title: "旧世界"}],
        });
        await settle();
        expect(mount.root.textContent).not.toContain("旧世界");

        const fresh = resolvers.find((item) => item.projectRoot === "p2")!;
        fresh.resolve({
            ...sendDataResponse(),
            lorebookEntries: [{path: "lorebook/new/index.md", title: "新世界"}],
        });
        await settle();
        expect(mount.root.textContent).toContain("新世界");
        expect(calls).toEqual(["p1", "p2"]);
    });

    it("离开保护：保存、放弃、取消三选一，放弃后回到已保存快照", async () => {
        fetchMock = vi.fn(async (url: string, options: Record<string, unknown> = {}) => {
            if (url === "/api/text-to-image/project-send-data" && !options.method) return sendDataResponse();
            if (url === "/api/text-to-image/project-send-data" && options.method === "PUT") {
                return {sendData: (options.body as {sendData: unknown}).sendData};
            }
            throw new Error(`未接住的请求：${url}`);
        });
        vi.stubGlobal("$fetch", fetchMock);
        const mount = mountComponent(TextToImageSendDataSection, {projectRoot: "p1"});
        await settle();

        rowByTitle(mount.root, "世界设定").click();
        await settle();

        const guard = mount.exposed?.guard as (message: string) => Promise<boolean>;
        const pending = guard("离开前请先处理未保存修改");
        await settle();
        expect(mount.root.textContent).toContain("有未保存的发送数据");

        buttonByText(mount.root, "放弃").click();
        await settle();
        await expect(pending).resolves.toBe(true);
        expect(rowByTitle(mount.root, "世界设定").getAttribute("aria-checked")).toBe("false");
        expect(mount.root.textContent).not.toContain("有未保存更改");
    });

    it("Project 切换取消后，旧页面保存仍写入原 Project，不进入新 Project", async () => {
        const putProjects: string[] = [];
        fetchMock = vi.fn(async (url: string, options: Record<string, unknown> = {}) => {
            if (url === "/api/text-to-image/project-send-data" && !options.method) {
                return (options.query as {projectRoot: string}).projectRoot === "p2"
                    ? {...sendDataResponse(), lorebookEntries: [{path: "lorebook/new/index.md", title: "新世界"}]}
                    : sendDataResponse();
            }
            if (url === "/api/text-to-image/project-send-data" && options.method === "PUT") {
                putProjects.push((options.body as {projectRoot: string}).projectRoot);
                return {sendData: (options.body as {sendData: unknown}).sendData};
            }
            throw new Error(`未接住的请求：${url}`);
        });
        vi.stubGlobal("$fetch", fetchMock);

        const TestHost = defineComponent({
            setup(_props, {expose}) {
                const projectRoot = ref("p1");
                expose({projectRoot});
                return {projectRoot};
            },
            render(this: {projectRoot: string}) {
                return h(TextToImageSendDataSection, {projectRoot: this.projectRoot});
            },
        });
        const mount = mountComponent(TestHost, {});
        const hostRef = mount.exposed?.projectRoot as Ref<string>;
        await settle();

        rowByTitle(mount.root, "世界设定").click();
        await settle();
        hostRef.value = "p2";
        await settle();

        expect(mount.root.textContent).toContain("有未保存的发送数据");
        buttonByText(mount.root, "取消").click();
        await settle();

        expect(mount.root.textContent).toContain("Project 切换已取消");
        expect(mount.root.textContent).not.toContain("新世界");
        buttonByText(mount.root, "保存选择").click();
        await settle();
        expect(mount.root.textContent).toContain("Project 已切换");
        expect(putProjects).toEqual([]);
    });
});
