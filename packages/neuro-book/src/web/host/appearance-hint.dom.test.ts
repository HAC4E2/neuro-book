/**
 * 加载页的明暗提示（runtime.browser-host 启动序列第 1 步）：宿主写下的提示与 index.html 内联脚本读的是同一份约定。
 * 内联脚本不能 import，两份 index.html 各抄一份：这里核对两份完全一致，并在 happy-dom 里执行它，读宿主真实写下的值。
 * 浏览器里的第一帧颜色由 `e2e/browser-host.e2e.ts` 验证。
 */

import {readFileSync} from "node:fs";
import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, it} from "vitest";

import {HOST_APPEARANCE_KEY, rememberDocumentAppearance} from "./appearance-hint";

const WEB = join(import.meta.dirname, "..");

function inlineScript(file: string): string {
    const html = readFileSync(join(WEB, file), "utf8");
    const match = /<script>([\s\S]*?)<\/script>/u.exec(html);
    if (match?.[1] === undefined) throw new Error(`${file} 里没有内联脚本`);
    return match[1];
}

const root = document.documentElement;
const THEME = {"--panel-surface": "rgb(45, 41, 37)", "--text-main": "rgb(239, 233, 223)", "--text-muted": "rgb(145, 138, 126)", "--accent-main": "rgb(10, 132, 255)"};

function applyTheme(appearance: string, colors: Record<string, string>): void {
    root.dataset.nbAppearance = appearance;
    for (const [name, value] of Object.entries(colors)) root.style.setProperty(name, value);
}

function runInlineScript(): void {
    new Function(inlineScript("index.html"))();
}

beforeEach(() => {
    window.localStorage.clear();
    root.removeAttribute("style");
    root.removeAttribute("data-nb-appearance");
    root.removeAttribute("data-host-appearance");
});

afterEach(() => {
    root.removeAttribute("style");
});

describe("加载页的明暗提示", () => {
    it("两份 index.html 的内联脚本一字不差，读的键就是宿主写的键", () => {
        expect(inlineScript("testing/index.html")).toBe(inlineScript("index.html"));
        expect(inlineScript("index.html")).toContain(`"${HOST_APPEARANCE_KEY}"`);
    });

    it("宿主记下文档根当前的明暗与颜色，主题变了跟着改；内联脚本读回后写到根上", async () => {
        const warnings: string[] = [];
        applyTheme("light", {...THEME, "--panel-surface": "rgb(255, 252, 245)"});
        const stop = rememberDocumentAppearance({root, storage: () => window.localStorage, warn: (message) => warnings.push(message)});
        expect(JSON.parse(window.localStorage.getItem(HOST_APPEARANCE_KEY) ?? "null")).toMatchObject({appearance: "light", background: "rgb(255, 252, 245)"});

        applyTheme("dark", THEME);
        await Promise.resolve();
        expect(JSON.parse(window.localStorage.getItem(HOST_APPEARANCE_KEY) ?? "null")).toEqual({appearance: "dark", background: "rgb(45, 41, 37)", text: "rgb(239, 233, 223)", muted: "rgb(145, 138, 126)", accent: "rgb(10, 132, 255)"});
        stop();

        root.removeAttribute("style");
        runInlineScript();
        expect(root.getAttribute("data-host-appearance")).toBe("dark");
        expect(root.style.colorScheme).toBe("dark");
        expect(root.style.getPropertyValue("--host-loading-background")).toBe("rgb(45, 41, 37)");
        expect(root.style.getPropertyValue("--host-loading-accent")).toBe("rgb(10, 132, 255)");
        expect(warnings).toEqual([]);
    });

    it("还没写主题时不记；本地存储不可用时只说一次，不抛错", async () => {
        const warnings: string[] = [];
        const stop = rememberDocumentAppearance({root, storage: () => window.localStorage, warn: (message) => warnings.push(message)});
        expect(window.localStorage.getItem(HOST_APPEARANCE_KEY)).toBeNull();
        stop();

        const denied = (): Storage => {
            throw new DOMException("denied", "SecurityError");
        };
        const stopDenied = rememberDocumentAppearance({root, storage: denied, warn: (message) => warnings.push(message)});
        applyTheme("dark", THEME);
        await Promise.resolve();
        applyTheme("light", THEME);
        await Promise.resolve();
        stopDenied();
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("SecurityError");
    });

    it("内联脚本不认坏的记录：明暗不合法、读不出或有一项颜色格式不对，就整条不用、什么都不写（按系统明暗）", () => {
        window.localStorage.setItem(HOST_APPEARANCE_KEY, "{坏");
        runInlineScript();
        expect(root.hasAttribute("data-host-appearance")).toBe(false);

        window.localStorage.setItem(HOST_APPEARANCE_KEY, JSON.stringify({appearance: "dim", background: "rgb(1, 2, 3)"}));
        runInlineScript();
        expect(root.hasAttribute("data-host-appearance")).toBe(false);

        window.localStorage.setItem(HOST_APPEARANCE_KEY, JSON.stringify({appearance: "dark", background: "red; display: none", text: "#efe9df", muted: "#918a7e", accent: "#0a84ff"}));
        runInlineScript();
        expect(root.hasAttribute("data-host-appearance")).toBe(false);
        expect(root.style.getPropertyValue("--host-loading-text")).toBe("");
    });
});
