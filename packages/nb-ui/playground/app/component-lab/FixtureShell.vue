<script setup lang="ts">
import {computed} from "vue";
import FormCheckbox from "../../../src/components/form/FormCheckbox.vue";
import FormSelect from "../../../src/components/form/FormSelect.vue";
import {getLabScene, type LabComponentDefinition} from "./registry";

/**
 * fixture 的公共外壳：eyebrow 行（组件/场景）+ 被测组件插槽 + 场景 props 控件面板。
 * 控件面板用 nb-ui 自己的组件搭（FormCheckbox / FormSelect sm），诊断页自证契约。
 */
const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const controls = defineModel<Record<string, string | boolean>>("controls", {required: true});

const scene = computed(() => getLabScene(props.definition, props.sceneId));

function controlValue(id: string): string | boolean {
    return controls.value[id] ?? "";
}

function setControl(id: string, value: string | boolean): void {
    controls.value = {...controls.value, [id]: value};
}
</script>

<template>
    <div class="lab-fixture">
        <div class="lab-fixture__eyebrow">{{ definition.label }} / {{ scene.label }}</div>
        <slot></slot>
        <p class="lab-fixture__note">{{ definition.description }}</p>
    </div>

    <section class="lab-props" aria-label="场景属性">
        <h2 class="lab-panel-title">场景属性</h2>
        <div class="lab-props__list">
            <div v-for="control in definition.controls" :key="control.id" class="lab-props__row">
                <template v-if="control.type === 'boolean'">
                    <FormCheckbox
                        :model-value="Boolean(controlValue(control.id))"
                        :label="control.label"
                        @update:model-value="setControl(control.id, $event)"
                    />
                </template>
                <template v-else>
                    <span class="lab-props__label">{{ control.label }}</span>
                    <FormSelect
                        v-if="control.type === 'select'"
                        :model-value="String(controlValue(control.id))"
                        :options="(control.options ?? []).map((option) => ({label: option.label, value: option.value}))"
                        size="sm"
                        dropdown-direction="down"
                        hide-checkmark
                        @update:model-value="setControl(control.id, $event)"
                    />
                    <input
                        v-else
                        class="nb-ui-control nb-ui-control-h-sm lab-props__text rounded-[var(--radius-control)] border bg-[var(--control-surface)] px-2 text-xs text-[var(--text-main)] outline-none"
                        type="text"
                        :value="String(controlValue(control.id))"
                        @change="setControl(control.id, ($event.target as HTMLInputElement).value)"
                    >
                </template>
            </div>
        </div>
    </section>
</template>
