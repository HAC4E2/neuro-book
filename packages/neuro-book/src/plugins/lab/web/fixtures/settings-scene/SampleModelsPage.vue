<script setup lang="ts">
/**
 * 设置场景里的 fill 页面（示例插件“模型服务”）：自己分左右两栏，左边 SettingsPageList 列服务商，右边是选中的服务商与一项
 * 设置；两栏各自滚动。服务商是写死的示例数据，只用来看两层左栏挨在一起时读不读成一张表。
 */
import {Badge, SegmentedControl, Separator} from "@notnotype/nb-ui/components";
import type {SegmentedControlValue} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";

import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import type {SettingsService} from "nbook/shared/settings";
import SettingsPageList from "nbook/ui/settings/SettingsPageList.vue";
import SettingsRow from "nbook/ui/settings/SettingsRow.vue";

import {modelsSettings} from "./scene-settings";

const props = defineProps<{
    context: SettingsPageContext;
    settings: SettingsService;
}>();

const providers = [
    {id: "deepseek", title: "DeepSeek", description: "api.deepseek.com", icon: "i-lucide-server"},
    {id: "openai", title: "OpenAI", description: "api.openai.com", icon: "i-lucide-server"},
    {id: "custom", title: "自定义服务", icon: "i-lucide-server", disabledReason: "还没有填写接口地址"},
];
const enabled = new Set(["deepseek"]);
const selected = ref<string | null>("deepseek");
const provider = computed(() => providers.find((item) => item.id === selected.value) ?? null);
const effortOptions = [{value: "low", label: "低"}, {value: "medium", label: "中"}, {value: "high", label: "高"}];

async function setEffort(value: SegmentedControlValue): Promise<void> {
    await props.settings.update(modelsSettings.effort, value as "low" | "medium" | "high", {layer: props.context.layer.value});
}
</script>

<template>
    <div class="sample-models">
        <div class="sample-models__list">
            <SettingsPageList v-model="selected" :items="providers" label="服务商">
                <template #end="{item}">
                    <Badge size="sm" variant="soft" :tone="enabled.has(item.id) ? 'success' : 'neutral'">{{ enabled.has(item.id) ? "已启用" : "未启用" }}</Badge>
                </template>
            </SettingsPageList>
        </div>
        <Separator orientation="vertical" class="sample-models__divider" />
        <div class="sample-models__detail">
            <h3 class="sample-models__title">{{ provider?.title ?? "" }}</h3>
            <SettingsRow v-slot="row" :settings="settings" :setting="modelsSettings.effort" :layer="context.layer.value" locale="zh-CN" :project-title="context.projectTitle.value">
                <SegmentedControl :model-value="row.value as SegmentedControlValue" :options="effortOptions.map((option) => ({...option, disabled: row.disabled}))" :aria-label="row.label" @update:model-value="setEffort" />
            </SettingsRow>
        </div>
    </div>
</template>

<style scoped>
.sample-models {
    display: flex;
    height: 100%;
    min-height: 0;
    container-type: inline-size;
}

.sample-models__list {
    width: 220px;
    flex-shrink: 0;
    overflow-y: auto;
    padding-right: var(--space-4);
}

.sample-models__detail {
    min-width: 0;
    flex: 1;
    overflow-y: auto;
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-7);
}

/* 窄的窗口（手机宽度的画布）：两栏改成上下，各自不再滚动。 */
@container (max-width: 480px) {
    .sample-models {
        height: auto;
        flex-direction: column;
    }

    .sample-models__list,
    .sample-models__detail {
        width: auto;
        overflow: visible;
        padding-inline: var(--space-2);
    }

    .sample-models__divider {
        display: none;
    }
}

.sample-models__title {
    margin: 0 0 var(--space-4);
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
    line-height: var(--leading-tight);
    color: var(--text-main);
}
</style>
