/**
 * 面板的偏好（明暗、左栏各组的展开）：只在这一处读写 localStorage，组件不碰浏览器存储。
 * 键都带 `nbdev-panel:` 前缀；读写都包 try/catch（隐私模式、存储被禁用时照常工作，只是记不住）。
 * localStorage 按来源分开：`127.0.0.1:4400` 与 `localhost:4400` 各有一份，可以接受。
 */

const PREFIX = "nbdev-panel:";

export type Appearance = "system" | "light" | "dark";

function read(key: string): string | null {
    try {
        return window.localStorage.getItem(`${PREFIX}${key}`);
    } catch (error) {
        console.warn(`读不了面板偏好 ${key}，按缺省处理`, error);
        return null;
    }
}

function write(key: string, value: string): void {
    try {
        window.localStorage.setItem(`${PREFIX}${key}`, value);
    } catch (error) {
        console.warn(`存不了面板偏好 ${key}，这次改动只在本页有效`, error);
    }
}

export function readAppearance(): Appearance {
    const value = read("appearance");
    return value === "light" || value === "dark" ? value : "system";
}

export function writeAppearance(value: Appearance): void {
    write("appearance", value);
}

/** 左栏各组的展开状态；没记过的组缺省展开。 */
export function readNavOpen(): Record<string, boolean> {
    const value = read("nav-open");
    if (!value) return {};
    try {
        const parsed = JSON.parse(value) as unknown;
        return typeof parsed === "object" && parsed !== null ? parsed as Record<string, boolean> : {};
    } catch (error) {
        console.warn("面板偏好 nav-open 不是合法 JSON，按缺省处理", error);
        return {};
    }
}

export function writeNavOpen(value: Record<string, boolean>): void {
    write("nav-open", JSON.stringify(value));
}
