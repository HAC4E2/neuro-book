<script setup lang="ts">
import {computed} from "vue";
import {labComponents, type LabComponentId} from "./registry";

const props = defineProps<{
    componentId: LabComponentId;
}>();

const emit = defineEmits<{
    (event: "select", id: LabComponentId): void;
}>();

const groups = computed(() => {
    const seen = new Map<string, typeof labComponents>();
    for (const component of labComponents) {
        const list = seen.get(component.group) ?? [];
        list.push(component);
        seen.set(component.group, list);
    }
    return [...seen.entries()].map(([label, components]) => ({label, components}));
});
</script>

<template>
    <nav class="lab-nav lab-glass" aria-label="组件列表">
        <div v-for="group in groups" :key="group.label" class="lab-nav__group">
            <div class="lab-nav__group-label">{{ group.label }}</div>
            <button
                v-for="component in group.components"
                :key="component.id"
                type="button"
                class="lab-nav__item"
                :class="{'is-active': props.componentId === component.id}"
                :aria-pressed="props.componentId === component.id"
                :title="component.description"
                @click="emit('select', component.id)"
            >
                <span class="lab-nav__item-zh">{{ component.labelZh }}</span>
                <span class="lab-nav__item-en">{{ component.label }}</span>
            </button>
        </div>
    </nav>
</template>
