/**
 * 外壳的标题栏、状态栏与活动栏底部要的数据（docs/specs/ui/workbench-shell.md 外壳四输出 28–35、输出 40）：应用菜单、命令搜索
 * 的快捷键、两侧的条目与活动栏底部的条目。都是响应式读取：命令增减经 `onDidChange` 推进版本号；命令的可用性与勾选状态读
 * 公开状态，在 computed 里读会随值变化重算。组件只拿这里算好的数据，执行一律经命令服务。
 */

import {shallowRef} from "@vue/reactivity";

import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import type {PublicStateService} from "nbook/plugins/state/shared/contracts";
import type {DisplayLocale} from "nbook/shared/localized-text";

import {formatKeybinding} from "../commands/keymap";
import type {KeyPlatform} from "../commands/keymap";
import {OPEN_COMMANDS_ID} from "../commands/open-commands";
import type {ActivityItemRegistry, ShownActivityItem} from "../items/activity-items";
import type {ItemRegistry, StripEntry} from "../items/registry";
import {buildMenus, TITLEBAR_MENUS} from "./menu-model";
import type {MenuGroup} from "./menu-model";

/** 交给活动栏的一个底部条目：再带上命令此刻不可用的原因（有命令且不可用时）。 */
export type ActivityEntry = ShownActivityItem & {readonly disabledReason: string | null};

export interface ShellChrome {
    menus(locale: DisplayLocale): MenuGroup[];
    /** 命令面板的快捷键，按平台写好；没有声明时为 null。 */
    searchShortcut(): string | null;
    statusEntries(locale: DisplayLocale): StripEntry[];
    titleEntries(locale: DisplayLocale): StripEntry[];
    activityEntries(locale: DisplayLocale): ActivityEntry[];
    /** 点了一个条目：按它声明的命令执行；条目已不在（入口停止）时什么都不做。 */
    runItem(itemId: string): void;
}

export interface ShellChromeOptions {
    readonly commands: CommandService;
    readonly state: Pick<PublicStateService, "read">;
    readonly statusItems: ItemRegistry;
    readonly titleItems: ItemRegistry;
    readonly activityItems: ActivityItemRegistry;
    readonly platform: KeyPlatform;
    readonly signal: AbortSignal;
}

export function createShellChrome(options: ShellChromeOptions): ShellChrome {
    const {commands, state} = options;
    const version = shallowRef(0);
    const release = commands.onDidChange(() => {
        version.value += 1;
    });
    options.signal.addEventListener("abort", () => release(), {once: true});

    /** 命令此刻不可用的原因；没有命令或可用时为 null。 */
    const disabledReason = (item: {readonly title: string; readonly command: {readonly id: string} | null}): string | null => {
        if (item.command === null) return null;
        const enabled = commands.isEnabled(item.command.id);
        return enabled.ok ? (enabled.value ? null : item.title) : enabled.reason;
    };
    const entries = (registry: ItemRegistry, locale: DisplayLocale): StripEntry[] => {
        void version.value;
        return registry.shown(locale).map((item) => ({...item, disabledReason: disabledReason(item)}));
    };

    return {
        menus: (locale) => {
            void version.value;
            return buildMenus(TITLEBAR_MENUS, {
                commands: commands.list(),
                isEnabled: (id) => commands.isEnabled(id),
                checked: (key) => {
                    const read = state.read(key);
                    return read.status === "ready" && read.value === true;
                },
                desktop: false,
                locale,
                platform: options.platform,
            });
        },
        searchShortcut: () => {
            void version.value;
            const command = commands.get(OPEN_COMMANDS_ID);
            return command.ok && command.value.keybinding !== undefined ? formatKeybinding(command.value.keybinding, options.platform) : null;
        },
        statusEntries: (locale) => entries(options.statusItems, locale),
        titleEntries: (locale) => entries(options.titleItems, locale),
        activityEntries: (locale) => {
            void version.value;
            return options.activityItems.shown(locale).map((item) => ({...item, disabledReason: disabledReason(item)}));
        },
        runItem: (itemId) => {
            const item = [...options.statusItems.shown("en-US"), ...options.titleItems.shown("en-US"), ...options.activityItems.shown("en-US")].find((entry) => entry.id === itemId);
            if (item?.command == null) return;
            void commands.execute(item.command.id, item.command.args, {source: "user"});
        },
    };
}
