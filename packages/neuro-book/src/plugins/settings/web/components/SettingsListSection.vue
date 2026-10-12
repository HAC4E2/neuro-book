<script setup lang="ts">
/** list 分区的内容（同名 .md）：按分组列出配置项，每项一个 SettingsRow 加通用控件，写入经窗口模型。 */
import {formatText, localize} from "nbook/shared/localized-text";
import type {LocalizedText} from "nbook/shared/localized-text";
import SettingsRow from "nbook/ui/settings/SettingsRow.vue";

import {settingControl} from "../setting-controls";
import type {SettingsSectionView, SettingsWindow} from "../settings-window";
import type {WindowSetting} from "../window-source";
import SettingsControl from "./SettingsControl.vue";

defineOptions({name: "SettingsListSection"});

const props = defineProps<{
    window: SettingsWindow;
    view: Extract<SettingsSectionView, {kind: "list"}>;
}>();

const TEXT = {
    excludedUser: {"zh-CN": "{titles}只能在用户设置里改", "en-US": "{titles}: can only be changed in your settings"},
    excludedProject: {"zh-CN": "{titles}只能在本作品里设置", "en-US": "{titles}: can only be set for a book"},
} satisfies Record<string, LocalizedText>;

const locale = props.window.locale;

function controlOf(setting: WindowSetting) {
    return settingControl(setting.definition.declaration, locale.value);
}

function shown(setting: WindowSetting, value: unknown): unknown {
    const pending = props.window.pending(setting.definition.key);
    return pending === undefined ? value : pending.value;
}

function excludedText(titles: ReadonlyArray<string>): string {
    const separator = locale.value === "zh-CN" ? "、" : ", ";
    return localize(formatText(props.window.layer.value === "project" ? TEXT.excludedUser : TEXT.excludedProject, {titles: titles.join(separator)}), locale.value);
}
</script>

<template>
    <div class="settings-list-section" :data-settings-list="view.id">
        <section v-for="group in view.groups" :key="group.id ?? ''" class="settings-list-section__group" :data-settings-group="group.id ?? ''">
            <h3 v-if="group.title !== null" class="settings-list-section__group-title">{{ group.title }}</h3>
            <SettingsRow
                v-for="setting in group.settings"
                :key="setting.definition.key"
                v-slot="row"
                :settings="window.editing"
                :setting="setting.definition"
                :layer="window.layer.value"
                :locale="locale"
                :project-title="window.projectTitle.value"
                :wide="controlOf(setting).kind === 'readonly'"
                @write-failed="(failure) => window.rowFailed(setting, failure)"
            >
                <SettingsControl
                    :id="row.id"
                    :control="controlOf(setting)"
                    :model-value="shown(setting, row.value)"
                    :disabled="row.disabled"
                    :label="row.label"
                    :locale="locale"
                    @update:model-value="(value: unknown) => window.write(setting, value)"
                />
            </SettingsRow>
        </section>
        <p v-if="view.excluded.length > 0" class="settings-list-section__excluded" data-settings-excluded>{{ excludedText(view.excluded) }}</p>
    </div>
</template>

<style scoped>
.settings-list-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
}

.settings-list-section__group {
    display: flex;
    flex-direction: column;
}

.settings-list-section__group-title {
    margin: 0 0 var(--space-2);
    padding-bottom: var(--space-3);
    border-bottom: var(--border-w) solid var(--divider);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
}

.settings-list-section__excluded {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
}
</style>
