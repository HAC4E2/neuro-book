/**
 * `nbook.settings` 的浏览器入口：不存配置，订阅服务端的用户层与（绑定项目时）项目实例的项目层，在本窗口合成有效值，
 * 按调用方提供配置服务；写入以调用方的身份经远程服务转给层的拥有者（docs/specs/settings/configuration.md）。配置核心
 * 入口同时拥有设置分区贡献点 `settings.sections`、贡献“外观”分区，并把分区注册表与用户编辑的写入路径交给本插件
 * 自己的其它入口（docs/specs/settings/settings-window.md）。
 *
 * 配置核心入口 `browser` 只依赖宿主能力与诊断，工作台、命令系统都依赖它；用到命令面板选择服务的“切换界面语言”与要工作台
 * 通知的设置窗口各在另一个入口里，免得配置核心经工作台、命令系统绕回自己（服务装配的静态环把可选依赖也算在内）。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {Type} from "typebox";

import {computed} from "@vue/reactivity";

import {COMMANDS_POINT} from "nbook/plugins/commands/shared/contracts";
import type {CommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {PUBLIC_STATE_POINT} from "nbook/plugins/state/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {notificationsKey, quickPickKey} from "nbook/plugins/workbench/shared/contracts";

import {clockKey, windowConnectionKey, windowPluginsKey} from "nbook/shared/host";
import {windowProjectKey} from "nbook/shared/projects";
import {bindingsOf, definePublicState} from "nbook/shared/store/public";
import type {SettingLayer} from "nbook/shared/settings";

import {descriptor} from "../plugin";
import {displayLocale, localeSetting, OPEN_SETTINGS_COMMAND, projectSettingsContract, SETTINGS_SECTIONS_POINT, settingsKey, switchSetting, userSettingsContract} from "../shared/contracts";
import type {SettingsSectionDeclaration} from "../shared/contracts";
import {createSettingsInstance, FIRST_SNAPSHOT_MS, provideSettings, recordTo} from "../shared/instance";
import {acceptedSettings, sectionsPoint, settingsPoint} from "../shared/point";
import {remoteLayerEditor, remoteLayerLink} from "../shared/remote-link";
import type {SettingsSectionImplementation} from "./contracts";
import {SettingsSectionRegistry} from "./sections";
import {createSettingsWindow} from "./settings-window";
import type {SettingsWindowSizeStore} from "./settings-window";
import {settingsWindowSizeStore, sizeStorePort} from "./window-size";
import {createSettingsWindowSource, provideSettingsWindowSource, settingsWindowSourceKey} from "./window-source";

export const SWITCH_LOCALE_COMMAND = "nbook.settings.switch-locale";

/** 写用户层（界面语言只允许用户层）；Agent 带参数即可切换，plan、discuss 模式下按命令系统的规则只读。 */
export const SWITCH_LOCALE_DECLARATION: CommandDeclaration = {
    title: {"zh-CN": "切换界面语言", "en-US": "Change Display Language"},
    category: {"zh-CN": "设置", "en-US": "Settings"},
    description: "Change the display language of all windows. Without arguments, the user picks one; with { locale }, it is set directly.",
    args: Type.Object({locale: Type.Optional(Type.Union([Type.Literal("zh-CN"), Type.Literal("en-US")]))}, {additionalProperties: false}),
    effect: "write",
    expose: {agent: "auto"},
};

/**
 * 打开设置窗口（settings-window.md 输出 15）。只读：打开窗口不改数据；不对 Agent 开放，它是给人看的窗口。分区不在左栏里为
 * `invalid-args`、窗口没有绑定作品却要本作品标签为 `unavailable`，两种都不打开。
 */
export const OPEN_SETTINGS_DECLARATION: CommandDeclaration = {
    title: {"zh-CN": "打开设置", "en-US": "Open Settings"},
    category: {"zh-CN": "设置", "en-US": "Settings"},
    description: "Open the settings window of this page, or focus it when it is already open. { section } jumps to a section id; { layer: \"user\" | \"project\" } switches between user and book settings.",
    args: Type.Object({
        section: Type.Optional(Type.String()),
        layer: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("project")])),
    }, {additionalProperties: false}),
    effect: "read",
    keybinding: "Mod+,",
    expose: {agent: "never"},
};

/** 设置窗口的公开状态；限定名即 `SETTINGS_WINDOW_OPEN_KEY`。 */
export const settingsWindowState = definePublicState(descriptor.id, {
    windowOpen: {type: "boolean", unready: false, reason: {"zh-CN": "设置窗口没有打开", "en-US": "The settings window is not open"}},
});

export const APPEARANCE_SECTION = "nbook.appearance";

/** 外观分区：工作台的主题、明暗（小组 ui）与本插件的界面语言（小组 language）按 `section` 指向它。 */
export const APPEARANCE_SECTION_DECLARATION: SettingsSectionDeclaration = {
    title: {"zh-CN": "外观", "en-US": "Appearance"},
    description: {"zh-CN": "界面的主题、明暗与语言", "en-US": "Theme, appearance and language of the interface"},
    icon: "i-lucide-palette",
    category: "app",
    order: 10,
    kind: "list",
    groups: [
        {id: "ui", title: {"zh-CN": "界面", "en-US": "Interface"}},
        {id: "language", title: {"zh-CN": "语言", "en-US": "Language"}},
    ],
};

/** list 分区没有要实现的东西，内核仍要求入口贡献给出实现（`web/contracts.ts`）。 */
const LIST_SECTION: SettingsSectionImplementation = Object.freeze({});

/**
 * 设置窗口的入口（settings-window.md）：持有窗口模型（开着与否、分区、标签、尺寸），贡献 `nbook.settings.open` 与公开键
 * `windowOpen`。依赖工作台的通知，所以不能是配置核心入口；命令随入口激活才进命令表，启动即激活。尺寸记录在窗口第一次
 * 读尺寸时才打开：没打开过设置的页面不读它。
 */
export const settingsWindowEntry = defineEntry({
    id: "window",
    location: "browser",
    activationEvents: ["onStartup"],
    dependencies: [{key: diagnosticsKey}, {key: settingsKey}, {key: settingsWindowSourceKey}, {key: notificationsKey}, {key: storageKey}, {key: windowProjectKey}],
    contributions: [{capability: COMMANDS_POINT, id: OPEN_SETTINGS_COMMAND, declaration: OPEN_SETTINGS_DECLARATION}, ...settingsWindowState.contributions],
    activate: (context) => {
        const diagnostics = context.services.require(diagnosticsKey);
        const settings = context.services.require(settingsKey);
        const storage = context.services.require(storageKey);
        const notifications = context.services.require(notificationsKey);
        const project = context.services.require(windowProjectKey).project;
        let sizePort: SettingsWindowSizeStore | null = null;
        const size = (): SettingsWindowSizeStore => (sizePort ??= sizeStorePort(settingsWindowSizeStore.create(context, {storage, diagnostics})));
        const remembered = computed(() => size().remembered.value);
        const settingsWindow = createSettingsWindow({
            source: context.services.require(settingsWindowSourceKey),
            settings,
            bound: project !== null,
            projectTitle: project?.name ?? null,
            locale: computed(() => displayLocale(settings)),
            size: {remembered, remember: (next) => size().remember(next)},
            notify: (input) => void notifications.notify(input),
            report: (message) => diagnostics.record({level: "warn", event: "settings.window", message, source: {plugin: descriptor.id}}),
        });
        context.scope.register({kind: "settings-window", label: `${descriptor.id} window`, value: settingsWindow, release: (value) => value.dispose()});
        const published = bindingsOf(settingsWindowState, {windowOpen: settingsWindow.open});
        const run = (args: unknown) => settingsWindow.openWindow(args as {readonly section?: string; readonly layer?: SettingLayer});
        return {
            contributions: {
                [COMMANDS_POINT]: {[OPEN_SETTINGS_COMMAND]: {run}},
                [PUBLIC_STATE_POINT]: Object.fromEntries(published.bindings),
            },
        };
    },
});

export const settingsBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    contributionPoints: [settingsPoint, sectionsPoint],
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        dependencies: [{key: diagnosticsKey}, {key: clockKey}, {key: windowConnectionKey}, {key: windowProjectKey}, {key: windowPluginsKey, required: false}],
        provides: [settingsKey, settingsWindowSourceKey],
        receives: [SETTINGS_SECTIONS_POINT],
        remoteDelegates: [userSettingsContract, projectSettingsContract],
        contributions: [{capability: SETTINGS_SECTIONS_POINT, id: APPEARANCE_SECTION, declaration: APPEARANCE_SECTION_DECLARATION}],
        activate: async (context) => {
            const bound = context.services.require(windowProjectKey).project !== null;
            const diagnostics = context.services.require(diagnosticsKey);
            const declarations = acceptedSettings(context.declarations);
            const instance = createSettingsInstance({
                layers: {
                    user: remoteLayerLink(context.remote, userSettingsContract),
                    ...(bound ? {project: remoteLayerLink(context.remote, projectSettingsContract)} : {}),
                },
                declarations,
                clock: context.services.require(clockKey),
                firstSnapshotMs: FIRST_SNAPSHOT_MS,
                connection: context.services.require(windowConnectionKey),
                record: recordTo(diagnostics, descriptor.id),
            });
            context.scope.register({kind: "settings-instance", label: `${descriptor.id} browser`, value: instance, release: (value) => value.close()});
            const plugins = await context.services.resolve(windowPluginsKey);
            const sections = new SettingsSectionRegistry(
                context.declarations.list<SettingsSectionDeclaration>(SETTINGS_SECTIONS_POINT),
                plugins.status === "resolved" ? plugins.instance : null,
                (message) => diagnostics.record({level: "warn", event: "settings.sections", message, source: {plugin: descriptor.id}}),
                context.signal,
            );
            const windowSource = createSettingsWindowSource({
                sections,
                declarations,
                editors: {
                    user: remoteLayerEditor(context.remote, userSettingsContract),
                    ...(bound ? {project: remoteLayerEditor(context.remote, projectSettingsContract)} : {}),
                },
                instance,
            });
            await instance.ready;
            return {
                services: [provideSettings(instance), provideSettingsWindowSource(windowSource, descriptor.id)],
                receivers: {[SETTINGS_SECTIONS_POINT]: sections.receiver()},
                contributions: {[SETTINGS_SECTIONS_POINT]: {[APPEARANCE_SECTION]: LIST_SECTION}},
            };
        },
    }), defineEntry({
        id: "commands",
        location: "browser",
        // 命令随贡献方入口激活才进命令表（还没有按命令触发的激活事件），启动即激活。
        activationEvents: ["onStartup"],
        dependencies: [{key: settingsKey}, {key: quickPickKey}],
        contributions: [{capability: COMMANDS_POINT, id: SWITCH_LOCALE_COMMAND, declaration: SWITCH_LOCALE_DECLARATION}],
        activate: (context) => {
            const settings = context.services.require(settingsKey);
            const quickPick = context.services.require(quickPickKey);
            const run = (args: unknown) => switchSetting({
                settings,
                quickPick,
                setting: localeSetting,
                value: (args as {readonly locale?: "zh-CN" | "en-US"}).locale,
                // 语言名用它自己的语言写，换到看不懂的语言后也找得回来。
                choices: [{id: "zh-CN", label: "简体中文"}, {id: "en-US", label: "English"}],
                title: SWITCH_LOCALE_DECLARATION.title,
            });
            return {contributions: {[COMMANDS_POINT]: {[SWITCH_LOCALE_COMMAND]: {run}}}};
        },
    }), settingsWindowEntry],
};

/**
 * 只有配置核心入口的浏览器定义：给不装工作台的测试实例与示例场地用。切换界面语言的入口要命令面板的选择服务，
 * 没有工作台时它受阻，会被当作启动失败；产品窗口总有工作台，装完整的 `settingsBrowserPlugin`。
 */
export const settingsBrowserCore: PluginDefinition = {...settingsBrowserPlugin, entries: settingsBrowserPlugin.entries.filter((entry) => entry.id === "browser")};
