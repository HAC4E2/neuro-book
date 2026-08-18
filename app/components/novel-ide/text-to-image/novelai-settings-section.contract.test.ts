// @vitest-environment jsdom
import {createApp, nextTick, type App} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import TextToImageNovelAiSettingsSection from "nbook/app/components/novel-ide/text-to-image/TextToImageNovelAiSettingsSection.vue";
import type {TextToImageProviderDto} from "nbook/shared/dto/text-to-image.dto";

type Mounted = {root: HTMLElement; app: App; unmount: () => void};

const mounts: Mounted[] = [];

beforeEach(() => {
    vi.stubGlobal("useI18n", () => ({t: (value: string) => value}));
});

afterEach(() => {
    for (const mount of mounts.splice(0)) mount.unmount();
    vi.unstubAllGlobals();
});

function provider(overrides: Partial<TextToImageProviderDto> = {}): TextToImageProviderDto {
    return {
        id: 1,
        kind: "novelai",
        name: "NovelAI",
        baseUrl: "https://image.novelai.net",
        model: "nai-diffusion-4-5-full",
        hasCredential: true,
        credentialRevision: 1,
        settings: {
            baseUrl: "https://image.novelai.net",
            requestIntervalMs: 15_000,
            model: "nai-diffusion-4-5-full",
            promptReplaceText: "x=替换|y",
        },
        createdAt: "2026-08-16T00:00:00.000Z",
        updatedAt: "2026-08-16T00:00:00.000Z",
        ...overrides,
    };
}

async function settle(): Promise<void> {
    for (let round = 0; round < 8; round += 1) {
        await nextTick();
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

function mount(providers: TextToImageProviderDto[]): Mounted {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp(TextToImageNovelAiSettingsSection, {providers});
    app.mount(host);
    const mounted = {
        root: host,
        app,
        unmount: () => {
            app.unmount();
            host.remove();
        },
    };
    mounts.push(mounted);
    return mounted;
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
    const found = [...root.querySelectorAll("button")].find((item) => (item.textContent ?? "").includes(text));
    if (!found) throw new Error("未找到按钮：" + text);
    return found as HTMLButtonElement;
}

describe("NovelAI API Key 三态合同", () => {
    it("已保存只显示不可选中遮罩，不把明文填入输入框", async () => {
        const mounted = mount([provider({hasCredential: true})]);
        await settle();

        expect(mounted.root.textContent).toContain("已保存并使用中");
        expect(mounted.root.textContent).toContain("········");
        expect(mounted.root.textContent).not.toContain("secret-token");
        const mask = mounted.root.querySelector("[aria-label='API Key 已保存并使用中']") as HTMLElement | null;
        expect(mask).not.toBeNull();
        expect(mask?.tagName).not.toBe("INPUT");
        expect(button(mounted.root, "替换 Key")).toBeTruthy();
        expect(button(mounted.root, "删除 Key")).toBeTruthy();
    });

    it("替换模式输入新 Key 并只发一次 replace 请求，成功后清空草稿", async () => {
        const fetchMock = vi.fn(async (url: string, options: Record<string, unknown> = {}) => {
            if (url === "/api/text-to-image/reference-images") return {items: []};
            if (url === "/api/text-to-image/providers/1" && options.method === "PUT") {
                const body = options.body as {credentialUpdate: {mode: string; value: string}; settings: Record<string, unknown>};
                expect(body.credentialUpdate).toEqual({mode: "replace", value: "new-token"});
                expect(JSON.stringify(body)).not.toContain("········");
                return provider({hasCredential: true, credentialRevision: 2});
            }
            throw new Error("未接住的请求：" + url);
        });
        vi.stubGlobal("$fetch", fetchMock);
        const mounted = mount([provider({hasCredential: true})]);
        await settle();

        button(mounted.root, "替换 Key").click();
        await settle();
        const input = mounted.root.querySelector("input[type='password']") as HTMLInputElement;
        expect(input).not.toBeNull();
        input.value = "new-token";
        input.dispatchEvent(new Event("input"));
        button(mounted.root, "保存新 Key").click();
        await settle();

        expect(fetchMock.mock.calls.filter((call) => call[0] === "/api/text-to-image/providers/1" && (call[1] as Record<string, unknown>).method === "PUT")).toHaveLength(1);
        expect(mounted.root.textContent).toContain("已保存并使用中");
        expect(mounted.root.textContent).not.toContain("new-token");
    });

    it("未配置显示添加 Key，删除后保留 Provider 显示未配置", async () => {
        const fetchMock = vi.fn(async (url: string) => {
            if (url === "/api/text-to-image/reference-images") return {items: []};
            if (url === "/api/text-to-image/providers/1/credential") return {ok: true};
            throw new Error("未接住的请求：" + url);
        });
        vi.stubGlobal("$fetch", fetchMock);
        const mounted = mount([provider({hasCredential: true})]);
        await settle();

        button(mounted.root, "删除 Key").click();
        await settle();
        expect(mounted.root.textContent).toContain("删除后，排队任务和新请求将不能使用该 Provider");
        const confirmButtons = [...mounted.root.querySelectorAll("button")].filter((item) => (item.textContent ?? "").includes("common.confirm"));
        expect(confirmButtons.length).toBeGreaterThan(0);
        confirmButtons[0]!.click();
        await settle();
        expect(mounted.root.textContent).toContain("未配置 API Key");
        expect(mounted.root.textContent).toContain("添加 Key");
    });
});
