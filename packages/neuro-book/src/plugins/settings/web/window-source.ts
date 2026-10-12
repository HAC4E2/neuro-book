/**
 * 设置窗口的数据来源：分区目录与 page 的交付状态（`sections.ts`），以及用户编辑的写入路径（docs/specs/settings/
 * configuration.md 输出 19）。由配置核心入口提供给 `nbook.settings` 自己的其它浏览器入口，不是公开接口：
 *
 * - 设置窗口要工作台的通知与浮层，挂窗口的入口因此不能是配置核心入口（工作台依赖配置核心，静态环把可选依赖也算在内），
 *   只能经服务拿到核心入口里的配置实例与分区注册表。
 * - 用户编辑以核心入口自己的身份发出，拥有者据此放行，写的是任何已声明项。门面只发给 `nbook.settings` 自己、没有经过
 *   代理的调用方；别的插件解析这个键，门面工厂抛错，解析以初始化失败结束。
 */

import {providePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {ProvidedService} from "@notnotype/nb-runtime/plugins";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {WindowPluginRetry} from "nbook/shared/host";
import type {SettingLayer, SettingWriteResult} from "nbook/shared/settings";

import type {SettingsInstance} from "../shared/instance";
import {userEditProblem} from "../shared/layers";
import type {DeclaredSetting, LayerEdit} from "../shared/layers";
import type {LayerEditor} from "../shared/remote-link";
import type {SettingsPageDelivery, SettingsPageLoad, SettingsSectionEntry, SettingsSectionRegistry} from "./sections";

export interface SettingsWindowSource {
    /** 已接受的分区声明，按分区 id 的码元顺序。 */
    sections(): ReadonlyArray<SettingsSectionEntry>;
    /** 分区的交付状态；在 computed 里读会随交付变化重算。 */
    delivery(sectionId: string): SettingsPageDelivery;
    load(sectionId: string): Promise<SettingsPageLoad>;
    retry(sectionId: string): Promise<WindowPluginRetry>;
    /** 把任何已声明项的这一层设为 `value`；成功返回时本窗口已应用写后的层快照。 */
    edit(key: string, layer: SettingLayer, value: unknown): Promise<SettingWriteResult>;
    /** 从这一层删掉这个键（恢复默认、移除本作品的设置）。 */
    unset(key: string, layer: SettingLayer): Promise<SettingWriteResult>;
}

export const settingsWindowSourceKey: ServiceKey<SettingsWindowSource> = defineServiceKey<SettingsWindowSource>("nbook.settings/window-source");

export interface SettingsWindowSourceOptions {
    readonly sections: SettingsSectionRegistry;
    readonly declarations: ReadonlyMap<string, DeclaredSetting>;
    /** 窗口没有绑定作品时没有项目层。 */
    readonly editors: {readonly user: LayerEditor; readonly project?: LayerEditor};
    readonly instance: SettingsInstance;
}

export function createSettingsWindowSource(options: SettingsWindowSourceOptions): SettingsWindowSource {
    const write = async (key: string, layer: SettingLayer, edit: LayerEdit): Promise<SettingWriteResult> => {
        // 核对顺序同声明者的写入（输出 11），只是不看声明者；调用方身份由拥有者核对。
        const problem = userEditProblem(key, options.declarations.get(key), edit, layer);
        if (problem !== null) return {ok: false, ...problem};
        const editor = options.editors[layer];
        if (editor === undefined) return {ok: false, code: "no-project", detail: "这个窗口没有绑定作品，没有项目层"};
        // 先复制一份：排队与传输期间调用方再改原对象不影响这次写入。
        const result = await editor.edit(key, edit.kind === "set" ? {kind: "set", value: structuredClone(edit.value)} : edit);
        if (!result.ok) return result;
        options.instance.accept(layer, result.snapshot);
        return {ok: true};
    };
    return {
        sections: () => options.sections.catalog,
        delivery: (sectionId) => options.sections.delivery(sectionId),
        load: (sectionId) => options.sections.load(sectionId),
        retry: (sectionId) => options.sections.retry(sectionId),
        edit: (key, layer, value) => write(key, layer, {kind: "set", value}),
        unset: (key, layer) => write(key, layer, {kind: "delete"}),
    };
}

/** 只发给 `owner` 插件自己、没有经过代理的调用方（见模块头）。 */
export function provideSettingsWindowSource(source: SettingsWindowSource, owner: string): ProvidedService<SettingsWindowSource> {
    return providePerConsumer(settingsWindowSourceKey, (consumer) => {
        if (consumer.plugin !== owner || consumer.via !== null) throw new TypeError(`${settingsWindowSourceKey.name} 只提供给 ${owner} 自己的入口，调用方是 ${consumer.plugin ?? "宿主"}`);
        return {...source};
    });
}
