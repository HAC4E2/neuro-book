/**
 * 键位的写法（docs/specs/workbench/commands.md 的键位裁决与“快捷键的显示”）：命令声明里的默认键位怎么解析、怎么按平台写给
 * 人看。放在命令插件的共用代码里：键位写在命令声明上，显示它的不只工作台（欢迎页、空编辑组的提示），而跨插件只能引用
 * 对方的 `shared/contracts.ts`。按键事件的分发归工作台（`workbench/web/commands/keymap.ts`）。
 *
 * 只认单击组合（修饰词 + 一个主键）：chord、重复修饰、空键在解析时拒绝，不静默降级。
 */

import type {CommandResult} from "./contracts";

export type KeyPlatform = "mac" | "other";

export type KeyModifiers = {ctrl: boolean; meta: boolean; alt: boolean; shift: boolean};

export type ParsedKeybinding = {key: string} & KeyModifiers;

/** 主键：字母、数字、逗号（`Mod+,` 打开设置，与常见编辑器一致）、Escape、Enter、Space 与 F1–F12。 */
const KEY_TOKEN = /^(?:[A-Z]|[0-9]|,|Escape|Enter|Space|F(?:[1-9]|1[0-2]))$/u;

function invalid(reason: string): CommandResult<ParsedKeybinding> {
    return {ok: false, code: "invalid-args", reason};
}

export function parseKeybinding(binding: string, platform: KeyPlatform): CommandResult<ParsedKeybinding> {
    const tokens = binding.split("+");
    const key = tokens[tokens.length - 1] ?? "";
    if (!KEY_TOKEN.test(key)) return invalid(`键位主键不支持：${binding}`);
    const modifiers: KeyModifiers = {ctrl: false, meta: false, alt: false, shift: false};
    let hasMod = false;
    for (const token of tokens.slice(0, -1)) {
        if (token === "Mod") {
            if (hasMod) return invalid(`键位修饰词重复：${binding}`);
            hasMod = true;
            continue;
        }
        const flag = token === "Ctrl" ? "ctrl" : token === "Meta" ? "meta" : token === "Alt" ? "alt" : token === "Shift" ? "shift" : null;
        if (flag === null) return invalid(`未登记的键位修饰词：${token}`);
        if (modifiers[flag]) return invalid(`键位修饰词重复：${binding}`);
        modifiers[flag] = true;
    }
    if (hasMod) {
        // Mod 映射后可能与显式修饰词重合（例如 Windows 上的 Mod+Ctrl）：拒绝而不是猜。
        const mapped = platform === "mac" ? "meta" : "ctrl";
        if (modifiers[mapped]) return invalid(`Mod 与显式修饰词在 ${platform} 上重复：${binding}`);
        modifiers[mapped] = true;
    }
    return {ok: true, value: {key, ...modifiers}};
}

/** macOS 的修饰键符号，按系统菜单的次序（Control、Option、Shift、Command）。 */
const MAC_MODIFIERS = [["ctrl", "⌃"], ["alt", "⌥"], ["shift", "⇧"], ["meta", "⌘"]] as const;
/** 其它平台的写法与次序。 */
const OTHER_MODIFIERS = [["ctrl", "Ctrl"], ["meta", "Meta"], ["alt", "Alt"], ["shift", "Shift"]] as const;

/**
 * 键位按平台写给人看（docs/specs/workbench/commands.md 的“快捷键的显示”）：macOS 用 `⌃⌥⇧⌘` 符号连写（`Mod+Shift+P`
 * 写作 `⇧⌘P`），其它平台写 `Ctrl+Shift+P`。命令面板、应用菜单与命令搜索按钮共用；解析不了的键位原样返回。
 */
export function formatKeybinding(binding: string, platform: KeyPlatform): string {
    const parsed = parseKeybinding(binding, platform);
    if (!parsed.ok) return binding;
    const key = parsed.value.key;
    if (platform === "mac") return MAC_MODIFIERS.filter(([flag]) => parsed.value[flag]).map(([, symbol]) => symbol).join("") + key;
    return [...OTHER_MODIFIERS.filter(([flag]) => parsed.value[flag]).map(([, name]) => name), key].join("+");
}

/** Mod 的平台口径：macOS 与 iOS 上是 Meta，其它平台是 Ctrl。`userAgentData` 只有 Chromium 系浏览器有，其余回退 `platform`。 */
export function currentKeyPlatform(): KeyPlatform {
    const browser = globalThis.navigator as {readonly userAgentData?: {readonly platform?: string}; readonly platform?: string} | undefined;
    const platform = browser?.userAgentData?.platform ?? browser?.platform ?? "";
    return /mac|iphone|ipad/iu.test(platform) ? "mac" : "other";
}
