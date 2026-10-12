/**
 * SettingsRow（同名 .md，docs/specs/settings/settings-window.md 输出 10–13、18）：按配置服务与标签算出已修改、恢复默认、
 * 覆盖提示、沿用与单独设置、停用。配置服务来自设置场景的局部宿主：产品里同一个配置实例，层的拥有者在内存里（同 Lab）。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {h} from "vue";

import {createSettingsHost} from "nbook/plugins/lab/web/fixtures/settings-scene/settings-host";
import type {HostLayer, SettingsHost} from "nbook/plugins/lab/web/fixtures/settings-scene/settings-host";
import {localeSetting} from "nbook/plugins/settings/shared/contracts";
import {appearanceSetting, themeSetting} from "nbook/plugins/workbench/shared/contracts";
import type {SettingDefinition, SettingLayer} from "nbook/shared/settings";

import SettingsRow from "./SettingsRow.vue";

const cleanup: Array<() => void> = [];
afterEach(() => {
    for (const dispose of cleanup.splice(0)) dispose();
    document.body.innerHTML = "";
});

function host(layers: {readonly user?: HostLayer; readonly project?: HostLayer}): SettingsHost {
    const created = createSettingsHost({
        settings: [
            {plugin: "nbook.workbench", definition: themeSetting},
            {plugin: "nbook.workbench", definition: appearanceSetting},
            {plugin: "nbook.settings", definition: localeSetting},
        ] as ReadonlyArray<{plugin: string; definition: SettingDefinition<unknown>}>,
        sections: [],
        ...layers,
        notify: () => undefined,
        report: () => undefined,
    });
    cleanup.push(() => created.dispose());
    return created;
}

function row(created: SettingsHost, setting: SettingDefinition<unknown>, layer: SettingLayer, extra: Record<string, unknown> = {}) {
    const plugin = setting.key.startsWith("nbook.workbench/") ? "nbook.workbench" : "nbook.settings";
    const wrapper = mount(SettingsRow, {
        props: {settings: created.service(plugin), setting, layer, locale: "zh-CN" as const, ...extra},
        slots: {default: (slot: {value: unknown; disabled: boolean}) => h("span", {"data-slot": "", "data-disabled": String(slot.disabled)}, JSON.stringify(slot.value))},
        attachTo: document.body,
    });
    cleanup.push(() => wrapper.unmount());
    return wrapper;
}

const slotOf = (wrapper: ReturnType<typeof row>) => wrapper.find("[data-slot]");

describe("SettingsRow", () => {
    it("用户标签：这一层写了才算已修改；恢复默认删掉这一层的键，控件回到默认值", async () => {
        const created = host({user: {values: {"nbook.workbench/appearance": "dark"}}});
        await flushPromises();
        const clean = row(created, themeSetting as SettingDefinition<unknown>, "user");
        expect(clean.attributes("data-settings-row-modified")).toBeUndefined();
        expect(clean.find("[data-settings-row-reset]").exists()).toBe(false);
        expect(slotOf(clean).text()).toBe("\"nbook\"");

        const modified = row(created, appearanceSetting as SettingDefinition<unknown>, "user");
        expect(modified.attributes("data-settings-row-modified")).toBe("");
        expect(slotOf(modified).text()).toBe("\"dark\"");
        await modified.find("[data-settings-row-reset]").trigger("click");
        await flushPromises();
        expect(created.user.values()).toEqual({});
        expect(modified.attributes("data-settings-row-modified")).toBeUndefined();
        expect(slotOf(modified).text()).toBe("\"light\"");
    });

    it("用户标签里本作品层写了：行下提示本作品的值与书名；没有书名时写“本作品”", async () => {
        const created = host({user: {values: {"nbook.workbench/appearance": "system"}}, project: {values: {"nbook.workbench/appearance": "light"}}});
        await flushPromises();
        const titled = row(created, appearanceSetting as SettingDefinition<unknown>, "user", {projectTitle: "雾港"});
        expect(titled.find("[data-settings-row-overridden]").text()).toBe("本作品单独设为了 浅色，这里的改动在《雾港》里不生效");
        const untitled = row(created, appearanceSetting as SettingDefinition<unknown>, "user");
        expect(untitled.find("[data-settings-row-overridden]").text()).toBe("本作品单独设为了 浅色，这里的改动在本作品里不生效");
        // 本作品没写的项没有提示。
        expect(row(created, themeSetting as SettingDefinition<unknown>, "user").find("[data-settings-row-overridden]").exists()).toBe(false);
    });

    it("本作品标签：没写时沿用用户设置，“在本作品里单独设置”写进本作品层；写了显示控件，“移除本作品的设置”回到沿用", async () => {
        const created = host({user: {values: {"nbook.workbench/theme": "macos"}}, project: {}});
        await flushPromises();
        const wrapper = row(created, themeSetting as SettingDefinition<unknown>, "project");
        expect(wrapper.attributes("data-settings-row-state")).toBe("inherit");
        expect(wrapper.find("[data-settings-row-inherited]").text()).toBe("沿用用户设置：macOS");
        expect(slotOf(wrapper).exists()).toBe(false);
        await wrapper.find("[data-settings-row-override]").trigger("click");
        await flushPromises();
        expect(created.project?.values()).toEqual({"nbook.workbench/theme": "macos"});
        expect(wrapper.attributes("data-settings-row-state")).toBe("edit");
        expect(wrapper.attributes("data-settings-row-modified")).toBe("");
        expect(slotOf(wrapper).text()).toBe("\"macos\"");
        await wrapper.find("[data-settings-row-remove]").trigger("click");
        await flushPromises();
        expect(created.project?.values()).toEqual({});
        expect(wrapper.attributes("data-settings-row-state")).toBe("inherit");
    });

    it("层文件无效时控件停用、显示上一份有效值，动作停用；层连不上同样；恢复后自动解除", async () => {
        const created = host({user: {values: {"nbook.workbench/appearance": "dark"}, invalid: "第 3 行：缺少逗号"}});
        await flushPromises();
        const wrapper = row(created, appearanceSetting as SettingDefinition<unknown>, "user");
        expect(wrapper.attributes("data-settings-row-blocked")).toBe("");
        expect(slotOf(wrapper).attributes("data-disabled")).toBe("true");
        expect(slotOf(wrapper).text()).toBe("\"dark\"");
        expect(wrapper.find<HTMLButtonElement>("[data-settings-row-reset]").element.disabled).toBe(true);
        created.user.setInvalid(null);
        await flushPromises();
        expect(slotOf(wrapper).attributes("data-disabled")).toBe("false");

        created.user.setUnreachable(true);
        await flushPromises();
        expect(slotOf(wrapper).attributes("data-disabled")).toBe("true");
        created.user.setUnreachable(false);
        await flushPromises();
        expect(slotOf(wrapper).attributes("data-disabled")).toBe("false");
        expect(slotOf(wrapper).text()).toBe("\"dark\"");
    });

    it("行自己的写入没有成功：发 write-failed（动作与失败码），显示的仍是层里的值", async () => {
        const created = host({user: {values: {"nbook.workbench/appearance": "dark"}}});
        await flushPromises();
        created.user.failWrites("write-failed");
        const wrapper = row(created, appearanceSetting as SettingDefinition<unknown>, "user");
        await wrapper.find("[data-settings-row-reset]").trigger("click");
        await flushPromises();
        expect(wrapper.emitted("write-failed")).toEqual([[{action: "reset", code: "write-failed", detail: "场景让写入失败"}]]);
        expect(slotOf(wrapper).text()).toBe("\"dark\"");
    });

    it("宽排法：控件另起一行，恢复默认在标题那一行；声明不允许这一层时不画控件", async () => {
        const created = host({user: {values: {"nbook.workbench/appearance": "dark"}}, project: {}});
        await flushPromises();
        const wide = row(created, appearanceSetting as SettingDefinition<unknown>, "user", {wide: true});
        expect(wide.find("[data-settings-row-wide] [data-slot]").exists()).toBe(true);
        expect(wide.find("[data-settings-row-head] [data-settings-row-reset]").exists()).toBe(true);
        const notAllowed = row(created, localeSetting as SettingDefinition<unknown>, "project");
        expect(notAllowed.attributes("data-settings-row-state")).toBe("not-allowed");
        expect(notAllowed.text()).toContain("只能在用户设置里改");
        expect(slotOf(notAllowed).exists()).toBe(false);
    });
});
