<script setup lang="ts">
/**
 * WorksSettingsPage 的 Lab 场景：配置服务来自设置场景的局部宿主（`settings-scene/`），用户层在内存里；目录选择器用 Lab 的
 * 固定目录树。页面拿到的是 `nbook.projects` 自己的配置服务，与产品一样只能写作品目录。写不进去时页面发的 `write-failed`
 * 记进事件 tab（产品里由插件发通知）。
 */
import {Button} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, ref} from "vue";

import {librarySetting} from "nbook/plugins/projects/shared/contracts";
import WorksSettingsPage from "nbook/plugins/projects/web/components/WorksSettingsPage.vue";

import {useLabEventSink} from "../lab-event-sink";
import {useLabSubject} from "../lab-subject";
import type {LabFixtureProps} from "../lab-subject";
import LabFixtureControls from "../LabFixtureControls.vue";
import {labPathPickerSource} from "./path-picker-source";
import {createSettingsHost} from "./settings-scene/settings-host";
import type {HostLayer} from "./settings-scene/settings-host";

const props = defineProps<LabFixtureProps>();
const record = useLabEventSink();
const subject = useLabSubject<typeof WorksSettingsPage>(() => props.input, ["write-failed"]);

/** 场景 → 用户层的初始内容。 */
const USER: Readonly<Record<string, HostLayer>> = {
    "unset": {},
    "set": {values: {[librarySetting.key]: "/home/writer/books"}},
    "long": {values: {[librarySetting.key]: "/home/writer/Documents/NeuroBook/一个名字很长很长的作品目录/再往下一层/还有一层"}},
    "write-failed": {values: {[librarySetting.key]: "/home/writer/books"}},
    "invalid": {values: {[librarySetting.key]: "/home/writer/books"}, invalid: "第 3 行：缺少逗号"},
    "english": {values: {[librarySetting.key]: "/home/writer/books"}},
};

const host = createSettingsHost({
    settings: [{plugin: "nbook.projects", definition: librarySetting}],
    sections: [],
    user: USER[props.scene] ?? {},
    notify: (input) => record("notify", input),
    report: (message) => record("report", message),
});
onBeforeUnmount(() => host.dispose());

const failing = ref(props.scene === "write-failed");
if (failing.value) host.user.failWrites("write-failed");

function toggleFailing(): void {
    failing.value = !failing.value;
    host.user.failWrites(failing.value ? "write-failed" : null);
}

const settings = host.service("nbook.projects");
const bindings = computed(() => subject.bindings.value);
</script>

<template>
    <WorksSettingsPage
        v-bind="bindings"
        :settings="settings"
        :source="labPathPickerSource"
        class="works-settings-fixture"
        data-lab-subject
    />
    <LabFixtureControls>
        <Button size="sm" :variant="failing ? 'secondary' : 'ghost'" @click="toggleFailing">{{ failing ? "恢复写入" : "写入失败" }}</Button>
    </LabFixtureControls>
</template>

<style scoped>
/* 行把已修改竖线画在自己左边 --space-5 的留白里（SettingsRow.md 的注意事项）：设置窗口的内容列留了，这里留在页面自己的外边距上。 */
.works-settings-fixture {
    width: calc(100% - var(--space-5));
    margin-left: var(--space-5);
}
</style>
