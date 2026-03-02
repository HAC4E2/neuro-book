/**
 * IDE 可选主题。
 */
export type IdeTheme = "sepia" | "light" | "dark";

/**
 * 主题变量集合。
 */
export type ThemeVars = Record<`--${string}`, string>;

/**
 * 主题宿主类名。
 */
export const IDE_THEME_HOST_CLASS = "novel-ide-theme";

/**
 * IDE 主题变量。
 * 这里是主题值的唯一来源，页面与组件只消费这些变量。
 */
export const themeTokens: Record<IdeTheme, ThemeVars> = {
    sepia: {
        "--bg-main": "#f4ecd8",
        "--bg-panel": "#fdf6e3",
        "--bg-sidebar": "#ebe0c8",
        "--bg-hover": "#e3d5b8",
        "--bg-active": "#d9c9a8",
        "--bg-input": "#ebe0c8",
        "--text-main": "#433422",
        "--text-secondary": "#786450",
        "--text-muted": "#b8a896",
        "--text-inverse": "#ffffff",
        "--border-color": "#d6c7a9",
        "--border-color-hover": "#cfbc96",
        "--accent-main": "#d97743",
        "--accent-bg": "rgba(217, 119, 67, 0.15)",
        "--accent-text": "#b85a2a",
        "--toolbar-bg": "rgba(253, 246, 227, 0.92)",
        "--prompt-bg": "#fdf6e3",
        "--prompt-border": "#d6c7a9",
        "--agent-bg": "#f8efdc",
        "--editor-canvas-bg": "#fbf5e7",
        "--editor-shell-bg": "color-mix(in srgb, #fdf6e3 88%, transparent)",
        "--editor-head-bg": "color-mix(in srgb, #f4ecd8 92%, white)",
        "--editor-preview-bg": "#fbf5e7",
        "--editor-gutter-bg": "#fdf6e3",
        "--source-bg": "#fdf6e3",
        "--source-text": "#586e75",
        "--source-muted": "#93a1a1",
    },
    light: {
        "--bg-main": "#f6f8fa",
        "--bg-panel": "#ffffff",
        "--bg-sidebar": "#f0f2f5",
        "--bg-hover": "#e6e8ec",
        "--bg-active": "#dce0e5",
        "--bg-input": "#f3f4f6",
        "--text-main": "#111827",
        "--text-secondary": "#4b5563",
        "--text-muted": "#9ca3af",
        "--text-inverse": "#ffffff",
        "--border-color": "#e5e7eb",
        "--border-color-hover": "#d1d5db",
        "--accent-main": "#3b82f6",
        "--accent-bg": "rgba(59, 130, 246, 0.12)",
        "--accent-text": "#2563eb",
        "--toolbar-bg": "rgba(255, 255, 255, 0.9)",
        "--prompt-bg": "#ffffff",
        "--prompt-border": "#e5e7eb",
        "--agent-bg": "#ffffff",
        "--editor-canvas-bg": "#ffffff",
        "--editor-shell-bg": "rgba(255, 255, 255, 0.88)",
        "--editor-head-bg": "rgba(246, 248, 250, 0.95)",
        "--editor-preview-bg": "#ffffff",
        "--editor-gutter-bg": "#f8f9fa",
        "--source-bg": "#f8f9fa",
        "--source-text": "#1f2937",
        "--source-muted": "#94a3b8",
    },
    dark: {
        "--bg-main": "#09090b",
        "--bg-panel": "#111113",
        "--bg-sidebar": "#0d0e10",
        "--bg-hover": "#1f1f22",
        "--bg-active": "#27272b",
        "--bg-input": "#18181b",
        "--text-main": "#ededed",
        "--text-secondary": "#a1a1aa",
        "--text-muted": "#71717a",
        "--text-inverse": "#000000",
        "--border-color": "#27272a",
        "--border-color-hover": "#3f3f46",
        "--accent-main": "#f59e0b",
        "--accent-bg": "rgba(245, 158, 11, 0.12)",
        "--accent-text": "#fbbf24",
        "--toolbar-bg": "rgba(17, 17, 19, 0.9)",
        "--prompt-bg": "#111113",
        "--prompt-border": "#27272a",
        "--agent-bg": "#111113",
        "--editor-canvas-bg": "#141416",
        "--editor-shell-bg": "rgba(17, 17, 19, 0.9)",
        "--editor-head-bg": "rgba(14, 14, 16, 0.95)",
        "--editor-preview-bg": "#141416",
        "--editor-gutter-bg": "#0c0c0e",
        "--source-bg": "#0c0c0e",
        "--source-text": "#d4d4d8",
        "--source-muted": "#52525b",
    },
};

/**
 * 当前主题系统涉及的全部 CSS 变量名。
 */
export const themeVarKeys = Object.keys(themeTokens.sepia) as Array<keyof typeof themeTokens.sepia>;
