/**
 * 设置场景的配置层：内存里的层拥有者（docs/specs/settings/configuration.md 的层快照与写入合同），给 Lab 与组件测试的局部
 * 宿主用。真实的拥有者读写文件、跑在服务端与项目子进程里，浏览器里起不来；这里按同样的合同交出层快照、按同样的顺序核对
 * 写入（`writeProblem`、`userEditProblem`），场景可以把它切到无效、断开或让写入失败。
 *
 * 它同时充当窗口的连接：断开时结束订阅（实例把这一层记为不可达），重新连上时实例按连接回到在线重新订阅，与浏览器宿主
 * 的重连一样。
 */

import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";

import type {LayerLink} from "nbook/plugins/settings/shared/instance";
import {userEditProblem, writeProblem} from "nbook/plugins/settings/shared/layers";
import type {DeclaredSetting, LayerEdit, LayerSnapshot, LayerWriteResult} from "nbook/plugins/settings/shared/layers";
import type {LayerEditor} from "nbook/plugins/settings/shared/remote-link";
import type {WindowConnection, WindowConnectionState} from "nbook/shared/host";
import {freezeJson} from "nbook/shared/settings";
import type {SettingLayer, SettingsFailure} from "nbook/shared/settings";

export interface MemoryLayerOptions {
    readonly layer: SettingLayer;
    readonly declarations: ReadonlyMap<string, DeclaredSetting>;
    readonly connection: MemoryConnection;
    readonly values?: Readonly<Record<string, unknown>>;
    /** 一开始就无效：`values` 是上一份有效内容。 */
    readonly invalid?: string;
    /** 一开始就连不上。 */
    readonly unreachable?: boolean;
    /** 层快照带的文件路径；缺省不带。 */
    readonly path?: string;
}

export interface MemoryLayer {
    readonly link: LayerLink;
    readonly editor: LayerEditor;
    /** 之后的写入都以这个失败码结束；null 恢复正常。 */
    failWrites(code: SettingsFailure | null): void;
    /** 文件改坏（给原因）或修好（null）。 */
    setInvalid(detail: string | null): void;
    /** 连不上：结束订阅，写入为 unavailable；`false` 恢复，经连接回到在线让实例重新订阅。 */
    setUnreachable(unreachable: boolean): void;
    /** 当前文件里的键值，给测试核对。 */
    values(): Readonly<Record<string, unknown>>;
}

/** 窗口的连接状态：内存层断开、恢复时切换，实例据此重新订阅。 */
export interface MemoryConnection {
    readonly connection: WindowConnection;
    set(state: WindowConnectionState): void;
}

export function memoryConnection(): MemoryConnection {
    let current: WindowConnectionState = "online";
    const listeners = new Set<(state: WindowConnectionState) => void>();
    return {
        connection: {
            state: () => current,
            onChange: (listener) => {
                listeners.add(listener);
                return () => {
                    listeners.delete(listener);
                };
            },
        },
        set: (state) => {
            if (state === current) return;
            current = state;
            for (const listener of [...listeners]) listener(state);
        },
    };
}

let boots = 0;

export function memoryLayer(options: MemoryLayerOptions): MemoryLayer {
    const boot = `memory-${options.layer}-${String((boots += 1))}`;
    let seq = 0;
    let values: Readonly<Record<string, unknown>> = freezeJson({...options.values});
    let invalid: string | null = options.invalid ?? null;
    let unreachable = options.unreachable ?? false;
    let failure: SettingsFailure | null = null;
    const subscribers = new Set<{readonly onSnapshot: (snapshot: LayerSnapshot) => void; readonly onEnd: (reason: string, retry: boolean) => void}>();
    // 一开始就连不上：连接先离线，恢复时回到在线，实例才会重新订阅。
    if (unreachable) options.connection.set("offline");

    const snapshot = (): LayerSnapshot => {
        const located = options.path === undefined ? {} : {path: options.path};
        const revision = {boot, seq};
        return invalid === null
            ? {status: "ok", revision, values, problems: [], ...located}
            : {status: "invalid", revision, values, problems: [], detail: invalid, ...located};
    };

    const publish = (): LayerSnapshot => {
        seq += 1;
        const next = snapshot();
        for (const subscriber of [...subscribers]) subscriber.onSnapshot(next);
        return next;
    };

    const apply = (key: string, edit: LayerEdit, problem: {readonly code: SettingsFailure; readonly detail: string} | null): LayerWriteResult => {
        if (unreachable) return {ok: false, code: "unavailable", detail: "内存层已断开"};
        if (problem !== null) return {ok: false, ...problem};
        if (invalid !== null) return {ok: false, code: "layer-invalid", detail: `配置文件当前无效：${invalid}`};
        if (failure !== null) return {ok: false, code: failure, detail: "场景让写入失败"};
        const next = {...values};
        if (edit.kind === "set") next[key] = edit.value;
        else delete next[key];
        values = freezeJson(next);
        return {ok: true, snapshot: publish()};
    };

    return {
        link: {
            subscribe: async (onSnapshot, onEnd) => {
                if (unreachable) return {ok: false, code: "unavailable", detail: "内存层已断开", retry: true};
                const subscriber = {onSnapshot, onEnd};
                subscribers.add(subscriber);
                onSnapshot(snapshot());
                return {ok: true, release: () => void subscribers.delete(subscriber)};
            },
            write: async (consumer: ConsumerIdentity, key, edit) => apply(key, edit, writeProblem(consumer.plugin, key, options.declarations.get(key), edit, options.layer)),
        },
        editor: {
            edit: async (key, edit) => apply(key, edit, userEditProblem(key, options.declarations.get(key), edit, options.layer)),
        },
        failWrites: (code) => {
            failure = code;
        },
        setInvalid: (detail) => {
            invalid = detail;
            publish();
        },
        setUnreachable: (next) => {
            if (next === unreachable) return;
            unreachable = next;
            if (next) {
                for (const subscriber of [...subscribers]) subscriber.onEnd("disconnected", true);
                subscribers.clear();
                options.connection.set("offline");
            } else {
                options.connection.set("online");
            }
        },
        values: () => values,
    };
}
