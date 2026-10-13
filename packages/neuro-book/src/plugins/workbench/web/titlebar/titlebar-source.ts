/**
 * 外壳的标题栏、状态栏与活动栏底部要的数据（docs/specs/ui/workbench-shell.md 外壳四输出 28–35、输出 40）：应用菜单、命令搜索
 * 的快捷键、两侧的条目与活动栏底部的条目，以及视图标题动作（docs/specs/workbench/views.md 输出 10）。都是响应式读取：命令
 * 增减经 `onDidChange` 推进版本号；命令的可用性与勾选状态读公开状态，在 computed 里读会随值变化重算。组件只拿这里算好的
 * 数据，执行一律经命令服务。
 */

import {shallowRef} from "@vue/reactivity";

import {formatKeybinding} from "nbook/plugins/commands/shared/contracts";
import type {CommandService, KeyPlatform} from "nbook/plugins/commands/shared/contracts";
import type {PublicStateService} from "nbook/plugins/state/shared/contracts";
import {localize} from "nbook/shared/localized-text";
import type {DisplayLocale} from "nbook/shared/localized-text";

import type {ViewAction} from "../../shared/views";

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
    /**
     * 视图标题动作此刻的样子：可用与否看命令的 `when`（不可用时带原因），按下态看 `toggled` 的公开键。视图实例还没建立
     * （`instance` 为 null，视图第一次显示或重新交付、还在加载）时，要带实例的动作不可用。
     */
    viewActions(actions: ReadonlyArray<ViewAction>, locale: DisplayLocale, instance: ViewInstanceRef | null): ViewActionEntry[];
    /** 点了视图标题动作：执行它的命令，`args: "instance"` 时带上被点的视图实例；要实例而实例还没建立时不执行。 */
    runViewAction(action: ViewAction, instance: ViewInstanceRef | null): void;
}

/** 被点的视图实例：视图 id 与它这一次挂载的代际。 */
export interface ViewInstanceRef {
    readonly viewId: string;
    readonly generation: number;
}

const INSTANCE_LOADING = {"zh-CN": "视图还没加载好", "en-US": "The view has not loaded yet"};

export interface ViewActionEntry {
    readonly action: ViewAction;
    readonly title: string;
    /** 可用时为 null。 */
    readonly disabledReason: string | null;
    /** 按下态；没有声明 `toggled` 的动作没有这一项。 */
    readonly pressed?: boolean;
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
        viewActions: (actions, locale, instance) => {
            void version.value;
            return actions.map((action) => {
                const title = localize(action.title, locale);
                const enabled = commands.isEnabled(action.command);
                const read = action.toggled === undefined ? null : state.read(action.toggled);
                const waiting = action.args === "instance" && instance === null;
                return {
                    action,
                    title,
                    disabledReason: waiting ? localize(INSTANCE_LOADING, locale) : enabled.ok ? (enabled.value ? null : title) : enabled.reason,
                    ...(read === null ? {} : {pressed: read.status === "ready" && read.value === true}),
                };
            });
        },
        runViewAction: (action, instance) => {
            if (action.args !== "instance") {
                void commands.execute(action.command, {}, {source: "user"});
                return;
            }
            if (instance !== null) void commands.execute(action.command, {viewId: instance.viewId, generation: instance.generation}, {source: "user"});
        },
        runItem: (itemId) => {
            const item = [...options.statusItems.shown("en-US"), ...options.titleItems.shown("en-US"), ...options.activityItems.shown("en-US")].find((entry) => entry.id === itemId);
            if (item?.command == null) return;
            void commands.execute(item.command.id, item.command.args, {source: "user"});
        },
    };
}
