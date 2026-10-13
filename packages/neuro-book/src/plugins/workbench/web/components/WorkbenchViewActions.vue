<script setup lang="ts">
/** 视图的标题动作（同名 .md）：一排 24px 图标按钮加“⋯”下拉，点了交给宿主执行。 */
import {Dropdown, IconButton} from "@notnotype/nb-ui/components";
import type {DropdownItem} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import type {ViewActionsModel} from "../titlebar/titlebar-source";

defineOptions({name: "WorkbenchViewActions"});

const props = defineProps<{
    model: ViewActionsModel;
    /** 菜单身份（视图、容器与模式、交付状态、代际）：变了就关掉打开着的“⋯”，之前的选择不执行。 */
    identity: string;
    /** “⋯”的可访问名称。 */
    moreLabel: string;
}>();
const emit = defineEmits<{run: [key: string]}>();

const open = ref(false);
/** 打开时记下的身份；选择只在它与此刻相同时生效（菜单原语先报关闭、再报选择，所以关闭时不清）。 */
const origin = ref<string | null>(null);

const items = computed<DropdownItem[]>(() => props.model.menu.flatMap((section, index) => [
    ...(index > 0 ? [{label: "", value: `separator:${String(index)}`, separator: true}] : []),
    ...section.map((entry): DropdownItem => ({
        label: entry.title,
        value: entry.key,
        ...(entry.icon === null ? {} : {iconClass: entry.icon}),
        disabled: entry.disabledReason !== null,
        ...(entry.disabledReason === null ? {} : {title: entry.disabledReason}),
        ...(entry.pressed === undefined ? {} : {type: "checkbox" as const, checked: entry.pressed}),
    })),
]));

function setOpen(next: boolean): void {
    open.value = next;
    if (next) origin.value = props.identity;
}

watch(() => props.identity, () => {
    open.value = false;
    origin.value = null;
});

function select(key: string): void {
    const from = origin.value;
    origin.value = null;
    open.value = false;
    if (from !== null && from === props.identity) emit("run", key);
}
</script>

<template>
    <span class="workbench-view-actions">
        <IconButton
            v-for="entry in model.buttons"
            :key="entry.key"
            size="xs"
            :icon-class="entry.icon ?? ''"
            :aria-label="entry.title"
            :title="entry.disabledReason ?? entry.title"
            :aria-pressed="entry.pressed"
            :disabled="entry.disabledReason !== null"
            :data-view-action="entry.command"
            :data-view-action-key="entry.key"
            @click="emit('run', entry.key)"
        />
        <Dropdown v-if="model.menu.length > 0" :items="items" :open="open" align="end" compact @update:open="setOpen" @select="select">
            <IconButton size="xs" icon-class="i-lucide-ellipsis" :aria-label="moreLabel" :title="moreLabel" data-view-actions-more />
        </Dropdown>
    </span>
</template>

<style scoped>
.workbench-view-actions {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-1);
}
</style>
