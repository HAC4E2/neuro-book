/**
 * 外壳的标题栏与状态栏要的数据（docs/specs/ui/workbench-shell.md 外壳四输出 28–35）：应用菜单、命令搜索的快捷键、两侧
 * 的条目，以及视图标题动作（docs/specs/workbench/views.md 输出 10）。都是响应式读取：命令增减经 `onDidChange` 推进
 * 版本号；命令的可用性与勾选状态读公开状态，在 computed 里读会随值变化重算。组件只拿这里算好的数据，执行一律经命令服务。
 */

import {shallowRef} from "@vue/reactivity";

import {formatKeybinding} from "nbook/plugins/commands/shared/contracts";
import type {CommandService, KeyPlatform} from "nbook/plugins/commands/shared/contracts";
import type {PublicStateService} from "nbook/plugins/state/shared/contracts";
import {localize} from "nbook/shared/localized-text";
import type {DisplayLocale} from "nbook/shared/localized-text";

import type {ViewAction} from "../../shared/views";

import {OPEN_COMMANDS_ID} from "../commands/open-commands";
import type {ItemRegistry, StripEntry} from "../items/registry";
import {buildMenus, TITLEBAR_MENUS} from "./menu-model";
import type {MenuGroup} from "./menu-model";

export interface ShellChrome {
    menus(locale: DisplayLocale): MenuGroup[];
    /** 命令面板的快捷键，按平台写好；没有声明时为 null。 */
    searchShortcut(): string | null;
    statusEntries(locale: DisplayLocale): StripEntry[];
    titleEntries(locale: DisplayLocale): StripEntry[];
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

    const entries = (registry: ItemRegistry, locale: DisplayLocale): StripEntry[] => {
        void version.value;
        return registry.shown(locale).map((item) => {
            if (item.command === null) return {...item, disabledReason: null};
            const enabled = commands.isEnabled(item.command.id);
            return {...item, disabledReason: enabled.ok ? (enabled.value ? null : item.title) : enabled.reason};
        });
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
            const item = [...options.statusItems.shown("en-US"), ...options.titleItems.shown("en-US")].find((entry) => entry.id === itemId);
            if (item?.command == null) return;
            void commands.execute(item.command.id, item.command.args, {source: "user"});
        },
    };
}
