/**
 * 交给 xterm 主题的颜色串（t15）。xterm 只认它解析得了的颜色：`color-mix()` 这类写法会被静默丢掉、退回缺省色
 * （2026-10-14 实测：滑块配色写成 color-mix 时显示的仍是缺省的前景色 20%）。所以带透明度的颜色一律拼成 8 位十六进制。
 * 本文件不用 DOM 类型（L1 测试在 Node 类型下导入它）。
 */

/** `#rgb` 或 `#rrggbb` 加上透明度（0 到 1）拼成 `#rrggbbaa`；别的写法回 `undefined`，由 xterm 用缺省色。 */
export function hexWithAlpha(color: string, alpha: number): string | undefined {
    const value = color.trim().toLowerCase();
    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/u.exec(value);
    const full = short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : /^#[0-9a-f]{6}$/u.test(value) ? value : null;
    if (!full) return undefined;
    const byte = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
    return `${full}${byte.toString(16).padStart(2, "0")}`;
}
