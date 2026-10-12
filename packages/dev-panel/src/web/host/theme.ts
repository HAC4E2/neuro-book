import {applyColorway, installTheme} from "@notnotype/nb-ui";
import nbookTheme from "@notnotype/nb-ui/themes/nbook";
import type {Appearance} from "./prefs.js";

/** 不经 Nuxt 装 nbook 主题：装主题模块（带 vars.css），在 `<html>` 上写主题与明暗，再套配色。 */
let installed = false;
const media = typeof window === "undefined" ? null : window.matchMedia("(prefers-color-scheme: dark)");

export function resolvedAppearance(appearance: Appearance): "light" | "dark" {
    if (appearance !== "system") return appearance;
    return media?.matches ? "dark" : "light";
}

export function applyAppearance(appearance: Appearance): void {
    if (!installed) {
        installTheme(nbookTheme);
        installed = true;
    }
    const root = document.documentElement;
    const resolved = resolvedAppearance(appearance);
    root.dataset.nbTheme = "nbook";
    root.dataset.nbAppearance = resolved;
    applyColorway(root, nbookTheme.colorways![resolved === "light" ? "nbook-light" : "nbook-dark"]!);
}

/** 跟随系统时，系统切换明暗也跟着切；返回解除监听的函数。 */
export function followSystem(current: () => Appearance): () => void {
    if (!media) return () => undefined;
    const listener = () => {
        if (current() === "system") applyAppearance("system");
    };
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
}
