/**
 * 设置窗口的尺寸（docs/specs/settings/settings-window.md“副作用与数据”）：`nbook.settings` 的一条 user/local 记录，同一
 * 客户端的各个页面共用。记录读不到或坏了时显示缺省尺寸，不阻止打开。保存暂停（确定失败、结果未知）期间只改显示，
 * 尺寸不是要用户处理的数据，不重试也不提示。
 */

import {computed} from "@vue/reactivity";
import {Type} from "typebox";

import {defineRecord} from "nbook/shared/storage";
import {defineStore} from "nbook/shared/store/store";

import {DEFAULT_SETTINGS_WINDOW_SIZE, MIN_SETTINGS_WINDOW_SIZE} from "./settings-window";
import type {SettingsWindowSize, SettingsWindowSizeStore} from "./settings-window";

const SizeSchema = Type.Object({
    width: Type.Integer({minimum: MIN_SETTINGS_WINDOW_SIZE.width}),
    height: Type.Integer({minimum: MIN_SETTINGS_WINDOW_SIZE.height}),
}, {additionalProperties: false});

export const SETTINGS_WINDOW_SIZE_RECORD = defineRecord({key: "settings.window-size", scope: "user", locality: "local", version: 1, schema: SizeSchema});

export const settingsWindowSizeStore = defineStore("settings-window-size", ({persist}) => {
    const size = persist(SETTINGS_WINDOW_SIZE_RECORD, {initial: DEFAULT_SETTINGS_WINDOW_SIZE});
    return {
        state: {size},
        actions: {
            remember: (next: SettingsWindowSize): void => {
                if (size.save.state === "failed" || size.save.state === "unknown") size.show(next);
                else void size.commit(() => next);
            },
        },
    };
});

export type SettingsWindowSizeRecordStore = ReturnType<typeof settingsWindowSizeStore.create>;

/** 窗口模型要的尺寸端口：显示值（没记过时是缺省尺寸）与写入。 */
export function sizeStorePort(store: SettingsWindowSizeRecordStore): SettingsWindowSizeStore {
    return {remembered: computed(() => store.state.size.display), remember: (next) => store.actions.remember(next)};
}
