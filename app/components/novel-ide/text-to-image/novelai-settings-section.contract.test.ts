// @vitest-environment jsdom
import {createApp, nextTick, type App} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import TextToImageNovelAiSettingsSection from "nbook/app/components/novel-ide/text-to-image/TextToImageNovelAiSettingsSection.vue";
import {
    TextToImageNovelAiSettingsSchema,
    type TextToImageNovelAiGenerationRecipe,
    type TextToImageNovelAiSettings,
    type TextToImageProviderDto,
} from "nbook/shared/dto/text-to-image.dto";

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

function mount(
    providers: TextToImageProviderDto[],
    onSaveProvider?: (input: Record<string, unknown>) => void,
): Mounted {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp(TextToImageNovelAiSettingsSection, {providers, onSaveProvider});
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

function fieldByLabel<T extends HTMLInputElement | HTMLSelectElement>(root: HTMLElement, text: string, selector: string): T {
    const label = [...root.querySelectorAll("label")].find((item) => (
        [...item.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() === text)
    ));
    const field = label?.querySelector(selector);
    if (!field) throw new Error(`未找到字段：${text}`);
    return field as T;
}

function setInput(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event("input", {bubbles: true}));
}

function v5Settings(promptGuidance = 5, steps = 19): TextToImageNovelAiSettings {
    return TextToImageNovelAiSettingsSchema.parse({
        model: "nai-diffusion-5-full",
        sampler: "k_euler_ancestral",
        noiseSchedule: "native",
        promptGuidance,
        promptGuidanceRescale: 0,
        steps,
    });
}

function recipeFrom(
    settings: TextToImageNovelAiSettings,
    overrides: Partial<TextToImageNovelAiGenerationRecipe> = {},
): TextToImageNovelAiGenerationRecipe {
    return {
        model: settings.model,
        sampler: settings.sampler,
        noiseSchedule: settings.noiseSchedule,
        promptGuidance: settings.promptGuidance,
        promptGuidanceRescale: settings.promptGuidanceRescale,
        aiDefaultCharacterPosition: settings.aiDefaultCharacterPosition,
        variety: settings.variety,
        decrisp: settings.decrisp,
        width: settings.width,
        height: settings.height,
        steps: settings.steps,
        seed: settings.seed,
        positiveQualityPreset: settings.positiveQualityPreset,
        negativeQualityPreset: settings.negativeQualityPreset,
        positive: settings.fixedPositivePrompt,
        positiveEnd: settings.fixedPositivePromptEnd,
        negative: settings.fixedNegativePrompt,
        furryDataset: settings.furryDataset,
        vibe: {...settings.vibe},
        characterReference: {...settings.characterReference},
        vibeGroup: {...settings.vibeGroup},
        ...overrides,
    };
}

describe("NovelAI V5 参数持久化合同", () => {
    it("旧 V5 设置缺少调优参数时才补入 V5 默认值", async () => {
        const mounted = mount([provider({settings: {
            baseUrl: "https://image.novelai.net",
            requestIntervalMs: 15_000,
            model: "nai-diffusion-5-full",
        }})]);
        await settle();

        expect(fieldByLabel<HTMLInputElement>(mounted.root, "Prompt Guidance", "input").value).toBe("7");
        expect(fieldByLabel<HTMLInputElement>(mounted.root, "Steps", "input").value).toBe("23");
    });

    it("载入和保存时保留用户设置的 Prompt Guidance 与 Steps", async () => {
        vi.stubGlobal("$fetch", vi.fn(async (url: string) => {
            if (url === "/api/text-to-image/reference-images") return {items: []};
            throw new Error("未接住的请求：" + url);
        }));
        const saveProvider = vi.fn();
        const mounted = mount([provider({settings: v5Settings(5, 19)})], saveProvider);
        await settle();

        const promptGuidance = fieldByLabel<HTMLInputElement>(mounted.root, "Prompt Guidance", "input");
        const steps = fieldByLabel<HTMLInputElement>(mounted.root, "Steps", "input");
        expect(promptGuidance.value).toBe("5");
        expect(steps.value).toBe("19");

        const name = mounted.root.querySelector("input[placeholder='例如：柔和厚涂']") as HTMLInputElement;
        setInput(name, "V5 自定义参数");
        await settle();
        button(mounted.root, "保存画风串").click();
        await settle();

        expect(saveProvider).toHaveBeenCalledTimes(1);
        const payload = saveProvider.mock.calls[0]![0] as {settings: TextToImageNovelAiSettings};
        expect(payload.settings.promptGuidance).toBe(5);
        expect(payload.settings.steps).toBe(19);
        const activeRecipe = payload.settings.generationRecipes[payload.settings.activeGenerationRecipeId];
        expect(activeRecipe?.promptGuidance).toBe(5);
        expect(activeRecipe?.steps).toBe(19);
    });

    it("切换已保存画风串时应用该画风串自己的 V5 参数", async () => {
        vi.stubGlobal("$fetch", vi.fn(async (url: string) => {
            if (url === "/api/text-to-image/reference-images") return {items: []};
            if (url === "/api/text-to-image/providers/1/active-generation-recipe") return {ok: true};
            throw new Error("未接住的请求：" + url);
        }));
        const base = v5Settings(5, 19);
        const settings: TextToImageNovelAiSettings = {
            ...base,
            generationRecipes: {
                "style-a": recipeFrom(base),
                "style-b": recipeFrom(base, {promptGuidance: 4.5, steps: 17}),
            },
            generationRecipeGroups: {default: {name: "默认", sortOrder: 0}},
            generationRecipeMeta: {
                "style-a": {name: "A", groupId: "default"},
                "style-b": {name: "B", groupId: "default"},
            },
            activeGenerationRecipeId: "style-a",
        };
        const mounted = mount([provider({settings})]);
        await settle();

        const recipeSelect = fieldByLabel<HTMLSelectElement>(mounted.root, "画风串", "select");
        recipeSelect.value = "style-b";
        recipeSelect.dispatchEvent(new Event("change", {bubbles: true}));
        await settle();

        expect(fieldByLabel<HTMLInputElement>(mounted.root, "Prompt Guidance", "input").value).toBe("4.5");
        expect(fieldByLabel<HTMLInputElement>(mounted.root, "Steps", "input").value).toBe("17");
    });

    it("只有用户主动切换到 V5 时才应用 V5 首次默认值", async () => {
        const mounted = mount([provider({
            settings: TextToImageNovelAiSettingsSchema.parse({
                model: "nai-diffusion-4-5-full",
                promptGuidance: 5,
                steps: 19,
            }),
        })]);
        await settle();

        const model = fieldByLabel<HTMLSelectElement>(mounted.root, "模型", "select");
        model.value = "nai-diffusion-5-full";
        model.dispatchEvent(new Event("change", {bubbles: true}));
        await settle();

        expect(fieldByLabel<HTMLInputElement>(mounted.root, "Prompt Guidance", "input").value).toBe("7");
        expect(fieldByLabel<HTMLInputElement>(mounted.root, "Steps", "input").value).toBe("23");
    });
});

describe("NovelAI API Key 三态合同", () => {
    it("提供 V5 Full/Curated 选项并说明首发参考图限制", async () => {
        const mounted = mount([provider({
            settings: {
                baseUrl: "https://image.novelai.net",
                requestIntervalMs: 15_000,
                model: "nai-diffusion-5-full",
            },
        })]);
        await settle();

        const modelOptions = [...mounted.root.querySelectorAll("option")]
            .filter((option) => option.value.startsWith("nai-diffusion-"))
            .map((option) => option.value);
        expect(modelOptions).toContain("nai-diffusion-5-full");
        expect(modelOptions).toContain("nai-diffusion-5-curated");
        expect(mounted.root.textContent).toContain("V5 首发版暂不支持 Vibe Transfer 和角色参考图");
        expect(mounted.root.textContent).toContain("官方提示词上限：1471");
    });

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
