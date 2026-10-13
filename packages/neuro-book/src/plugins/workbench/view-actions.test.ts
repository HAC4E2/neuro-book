/**
 * 视图标题动作（docs/specs/workbench/views.md 输出 10）经外壳的 chrome 求值与执行：真实内核的浏览器实例装上命令系统与
 * 公开状态。可用与否、不可用的原因跟着命令自己的 `when`，按下态跟着 `toggled` 的公开键；执行时 `args: "instance"`
 * 带上被点的视图实例，其余是 `{}`；视图实例还没建立时，要实例的动作不可用、点了不执行，其余照常。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";

import {ref} from "@vue/reactivity";
import {Type} from "typebox";

import {createApplication} from "@notnotype/nb-runtime/application";
import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {COMMANDS_POINT, commandServiceKey, MenuItemRegistry} from "nbook/plugins/commands/shared/contracts";
import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import {commandsPlugin} from "nbook/plugins/commands/shared/plugin";
import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {standaloneSettings} from "nbook/plugins/settings/testing/standalone";
import {PUBLIC_STATE_POINT, publicStateKey} from "nbook/plugins/state/shared/contracts";
import type {PublicStateService} from "nbook/plugins/state/shared/contracts";
import {statePlugin} from "nbook/plugins/state/shared/plugin";

import type {ViewAction} from "./shared/views";
import {ActivityItemRegistry} from "./web/items/activity-items";
import {ItemRegistry} from "./web/items/registry";
import {createShellChrome} from "./web/titlebar/titlebar-source";

const silent = {error: () => undefined};
let tmp = "";
const started: Application[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-workbench", "view-actions");
});

afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const ACT: ViewAction = {command: "example.flags.act", icon: "i-act", title: {"zh-CN": "动作", "en-US": "Act"}, args: "instance"};
const TOGGLE: ViewAction = {command: "example.flags.toggle", icon: "i-toggle", title: {"zh-CN": "开关", "en-US": "Toggle"}, toggled: "example.flags/on"};

/** 声明两个公开键、贡献两条命令的测试插件；命令收到的参数记进 `calls`。 */
function example(enabled: ReturnType<typeof ref<boolean>>, on: ReturnType<typeof ref<boolean>>, calls: unknown[]): PluginDefinition {
    const record = {run: (args: unknown) => {
        calls.push(args);
        return {ok: true as const, value: null};
    }};
    const declaration = (when?: string) => ({
        title: {"zh-CN": "例子", "en-US": "Example"},
        description: "example",
        args: Type.Object({viewId: Type.Optional(Type.String()), generation: Type.Optional(Type.Integer())}, {additionalProperties: false}),
        effect: "read" as const,
        ...(when === undefined ? {} : {when: {requires: [when]}}),
    });
    return {
        id: "example.flags",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            contributions: [
                {capability: PUBLIC_STATE_POINT, id: "example.flags/enabled", declaration: {type: "boolean", unready: false, reason: {"zh-CN": "现在不能做", "en-US": "Not now"}}},
                {capability: PUBLIC_STATE_POINT, id: "example.flags/on", declaration: {type: "boolean", unready: false}},
                {capability: COMMANDS_POINT, id: ACT.command, declaration: declaration("example.flags/enabled")},
                {capability: COMMANDS_POINT, id: TOGGLE.command, declaration: declaration()},
            ],
            activate: () => ({contributions: {
                [PUBLIC_STATE_POINT]: {"example.flags/enabled": {kind: "bound", read: () => enabled.value}, "example.flags/on": {kind: "bound", read: () => on.value}},
                [COMMANDS_POINT]: {[ACT.command]: record, [TOGGLE.command]: record},
            }}),
        }],
    };
}

async function start(plugins: ReadonlyArray<PluginDefinition>): Promise<{commands: CommandService; state: PublicStateService; signal: AbortSignal}> {
    const identity = {location: "browser", instanceId: "view-actions"};
    const store = createDiagnosticsStore({identity});
    const diagnostics = createDiagnosticsPlugin({location: "browser", store, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    const settings = standaloneSettings("browser", tmp);
    const services: {current: {commands: CommandService; state: PublicStateService; signal: AbortSignal} | null} = {current: null};
    const consumer: PluginDefinition = {
        id: "example.consumer",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: commandServiceKey}, {key: publicStateKey}],
            activate: (context) => {
                services.current = {commands: context.services.require(commandServiceKey), state: context.services.require(publicStateKey), signal: context.signal};
                return {};
            },
        }],
    };
    const application = createApplication(
        {identity, stopSignal: new AbortController().signal, emergency: () => undefined},
        {capabilities: settings.capabilities, plugins: [diagnostics, statePlugin, ...settings.plugins, commandsPlugin, ...plugins, consumer], requiredPlugins: [diagnostics.id, commandsPlugin.id], gates: []},
    );
    started.push(application);
    expect((await application.startup).status).toBe("available");
    if (services.current === null) throw new Error("没有拿到命令与公开状态服务");
    return services.current;
}

describe("视图标题动作（views.md 输出 10）", () => {
    it("可用与否跟着命令的 when、不可用时带原因；按下态跟着 toggled 的公开键；执行时 instance 动作带上视图实例，其余是 {}", async () => {
        const enabled = ref(false);
        const on = ref(false);
        const calls: unknown[] = [];
        const {commands, state, signal} = await start([example(enabled, on, calls)]);
        const items = () => new ItemRegistry([], state, () => undefined, signal);
        const chrome = createShellChrome({commands, state, statusItems: items(), titleItems: items(), activityItems: new ActivityItemRegistry([], state, signal), titlebarMenu: new MenuItemRegistry([], signal), platform: "other", signal});

        const instance = {viewId: "example.view", generation: 3};
        expect(chrome.viewActions([ACT, TOGGLE], "zh-CN", instance).map((entry) => [entry.title, entry.disabledReason, entry.pressed])).toEqual([["动作", "现在不能做", undefined], ["开关", null, false]]);
        enabled.value = true;
        on.value = true;
        expect(chrome.viewActions([ACT, TOGGLE], "en-US", instance).map((entry) => [entry.title, entry.disabledReason, entry.pressed])).toEqual([["Act", null, undefined], ["Toggle", null, true]]);

        chrome.runViewAction(ACT, instance);
        chrome.runViewAction(TOGGLE, instance);
        await Promise.resolve();
        expect(calls).toEqual([{viewId: "example.view", generation: 3}, {}]);

        // 视图还在加载、实例没建立：要实例的动作不可用并说明，点了不执行；不要实例的照常。
        expect(chrome.viewActions([ACT, TOGGLE], "zh-CN", null).map((entry) => [entry.title, entry.disabledReason])).toEqual([["动作", "视图还没加载好"], ["开关", null]]);
        chrome.runViewAction(ACT, null);
        chrome.runViewAction(TOGGLE, null);
        await Promise.resolve();
        expect(calls).toEqual([{viewId: "example.view", generation: 3}, {}, {}]);
    });
});
