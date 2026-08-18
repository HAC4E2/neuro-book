<script setup lang="ts">
import {computed} from "vue";
import FormSelect from "../../../src/components/form/FormSelect.vue";
import SegmentedControl from "../../../src/components/controls/SegmentedControl.vue";
import {useColorway} from "../composables/useColorway";
import {useTheme} from "../composables/useTheme";
import BadgeFixture from "./fixtures/BadgeFixture.vue";
import ButtonFixture from "./fixtures/ButtonFixture.vue";
import DropdownFixture from "./fixtures/DropdownFixture.vue";
import FormCheckboxFixture from "./fixtures/FormCheckboxFixture.vue";
import FormInputFixture from "./fixtures/FormInputFixture.vue";
import FormNumberInputFixture from "./fixtures/FormNumberInputFixture.vue";
import FormSelectFixture from "./fixtures/FormSelectFixture.vue";
import IconButtonFixture from "./fixtures/IconButtonFixture.vue";
import PaginationFixture from "./fixtures/PaginationFixture.vue";
import SegmentedControlFixture from "./fixtures/SegmentedControlFixture.vue";
import SpinnerFixture from "./fixtures/SpinnerFixture.vue";
import SwitchFieldFixture from "./fixtures/SwitchFieldFixture.vue";
import TabsFixture from "./fixtures/TabsFixture.vue";
import TimePickerFixture from "./fixtures/TimePickerFixture.vue";
import {LAB_BARE_THEME} from "./lab-url";
import {labViewports, type LabComponentDefinition, type LabComponentId, type LabViewportId} from "./registry";

const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
    viewportId: LabViewportId;
    themeValue: string;
    colorwayValue: string;
}>();

const emit = defineEmits<{
    (event: "update:scene", id: string): void;
    (event: "update:viewport", id: LabViewportId): void;
    (event: "update:theme", value: string): void;
    (event: "update:colorway", id: string): void;
    (event: "lab-event", name: string, payload?: unknown): void;
    (event: "rendered"): void;
}>();

const theme = useTheme();
const colorway = useColorway();

const fixtures = {
    "form-input": FormInputFixture,
    "form-number-input": FormNumberInputFixture,
    "form-select": FormSelectFixture,
    "form-checkbox": FormCheckboxFixture,
    "time-picker": TimePickerFixture,
    "button": ButtonFixture,
    "icon-button": IconButtonFixture,
    "segmented-control": SegmentedControlFixture,
    "switch-field": SwitchFieldFixture,
    "dropdown": DropdownFixture,
    "tabs": TabsFixture,
    "badge": BadgeFixture,
    "spinner": SpinnerFixture,
    "pagination": PaginationFixture,
} as const;

const activeFixture = computed(() => fixtures[props.definition.id]);

const sceneOptions = computed(() => props.definition.scenes.map((scene) => ({label: scene.label, value: scene.id})));
const viewportOptions = labViewports.map((viewport) => ({label: viewport.label, value: viewport.id}));

const themeOptions = computed(() => [
    {label: "裸基线", value: LAB_BARE_THEME},
    ...theme.themes.value.map((installed) => ({label: installed.manifest.name, value: installed.manifest.id})),
]);
const colorwayOptions = computed(() => colorway.colorwayIds.map((id) => ({label: colorway.colorwayMeta[id]?.label ?? id, value: id})));

const viewport = computed(() => labViewports.find((candidate) => candidate.id === props.viewportId) ?? labViewports[0]!);
const canvasStyle = computed(() => viewport.value.width === null ? undefined : {width: `${viewport.value.width}px`});
</script>

<template>
    <div class="lab-stage">
        <div class="lab-stage__toolbar lab-glass">
            <div class="lab-stage__identity">
                <strong class="lab-stage__name">{{ definition.labelZh }} <span class="lab-stage__name-en">{{ definition.label }}</span></strong>
                <SegmentedControl
                    :model-value="sceneId"
                    :options="sceneOptions"
                    aria-label="场景"
                    @update:model-value="emit('update:scene', String($event))"
                />
            </div>
            <div class="lab-stage__axes">
                <SegmentedControl
                    :model-value="viewportId"
                    :options="viewportOptions"
                    aria-label="预览宽度"
                    @update:model-value="emit('update:viewport', $event as LabViewportId)"
                />
                <label class="lab-stage__axis">
                    <span class="lab-stage__axis-label">主题</span>
                    <FormSelect
                        :model-value="themeValue"
                        :options="themeOptions"
                        size="sm"
                        dropdown-direction="down"
                        hide-checkmark
                        class="lab-stage__axis-select"
                        @update:model-value="emit('update:theme', $event)"
                    />
                </label>
                <label class="lab-stage__axis">
                    <span class="lab-stage__axis-label">配色</span>
                    <FormSelect
                        :model-value="colorwayValue"
                        :options="colorwayOptions"
                        size="sm"
                        dropdown-direction="down"
                        hide-checkmark
                        class="lab-stage__axis-select"
                        @update:model-value="emit('update:colorway', $event)"
                    />
                </label>
            </div>
        </div>

        <div class="lab-stage__surface">
            <div class="lab-canvas-scroll">
                <div class="lab-canvas" :style="canvasStyle" :data-viewport="viewportId">
                    <div v-if="viewport.width !== null" class="lab-canvas__ruler" aria-hidden="true">
                        <span class="lab-canvas__ruler-tick"></span>
                        <span class="lab-canvas__ruler-label">{{ viewport.width }} px</span>
                        <span class="lab-canvas__ruler-tick"></span>
                    </div>
                    <component
                        :is="activeFixture"
                        :definition="definition"
                        :scene-id="sceneId"
                        @lab-event="(name: string, payload?: unknown) => emit('lab-event', name, payload)"
                        @rendered="emit('rendered')"
                    />
                </div>
            </div>
        </div>
    </div>
</template>
