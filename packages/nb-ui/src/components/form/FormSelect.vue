<script setup lang="ts">
import {computed} from "vue";
import {
    SelectContent,
    SelectItem,
    SelectItemIndicator,
    SelectItemText,
    SelectPortal,
    SelectRoot,
    SelectTrigger,
    SelectValue,
    SelectViewport,
} from "reka-ui";
import {NB_Z_INDEX} from "../../theme/z-index";
import {useFormFieldContext} from "./form-field-context";

export type FormSelectSize = "default" | "sm";
export type FormSelectDirection = "auto" | "up" | "down";

export type FormSelectOption = {
    label: string;
    value: string;
    description?: string;
    iconClass?: string;
    indicatorClass?: string;
    disabled?: boolean;
};

const props = withDefaults(defineProps<{
    modelValue: string;
    options: FormSelectOption[];
    id?: string;
    name?: string;
    placeholder?: string;
    size?: FormSelectSize;
    dropdownDirection?: FormSelectDirection;
    disabled?: boolean;
    required?: boolean;
    hideCheckmark?: boolean;
}>(), {
    id: "",
    name: "",
    placeholder: "",
    size: "default",
    dropdownDirection: "auto",
    disabled: false,
    required: false,
    hideCheckmark: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "focus", event: FocusEvent): void;
}>();

const field = useFormFieldContext();
const controlId = computed(() => props.id || field?.inputId.value || undefined);
const isRequired = computed(() => props.required || field?.required.value === true);
const isInvalid = computed(() => field?.invalid.value === true);
const selectedOption = computed(() => props.options.find((option) => option.value === props.modelValue));
const selectedLabel = computed(() => selectedOption.value?.label ?? "");
const controlSizeClass = computed(() => props.size === "sm" ? "nb-ui-control-h-sm px-2 text-xs" : "nb-ui-control-h-md nb-ui-control-px text-sm");
const optionSizeClass = computed(() => props.size === "sm" ? "min-h-7 px-2 py-1 text-xs" : "min-h-8 px-2.5 py-1 text-sm");
const popperSide = computed(() => {
    if (props.dropdownDirection === "up") return "top" as const;
    if (props.dropdownDirection === "down") return "bottom" as const;
    return undefined;
});
const allowSideFlip = computed(() => props.dropdownDirection === "auto");

/*
 * Reka 的 v-model 允许 undefined（未选中），本组件的契约是 string。
 * 用户在原语层清空选择时回传空串，而不是把 undefined 漏给消费方。
 */
function handleUpdate(value: unknown): void {
    emit("update:modelValue", typeof value === "string" ? value : "");
}
</script>

<template>
    <SelectRoot
        :model-value="props.modelValue"
        :disabled="props.disabled"
        :name="props.name || undefined"
        :required="isRequired"
        @update:model-value="handleUpdate"
    >
        <SelectTrigger
            :id="controlId"
            :aria-describedby="field?.ariaDescribedby.value"
            :aria-invalid="isInvalid || undefined"
            class="group nb-ui-control flex w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border bg-[var(--control-surface)] text-[var(--text-main)] outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            :class="[controlSizeClass, isInvalid ? 'nb-ui-control-invalid' : '']"
            @focus="emit('focus', $event)"
        >
            <span class="flex min-w-0 items-center gap-1.5 pr-2">
                <span v-if="selectedOption?.indicatorClass" class="h-1.5 w-1.5 shrink-0 rounded-full shadow-sm" :class="selectedOption.indicatorClass" aria-hidden="true"></span>
                <span v-else-if="selectedOption?.iconClass" class="h-3 w-3 shrink-0 text-[var(--text-muted)]" :class="selectedOption.iconClass" aria-hidden="true"></span>
                <SelectValue class="min-w-0 truncate" :placeholder="props.placeholder">{{ selectedLabel || props.placeholder }}</SelectValue>
            </span>
            <!-- 箭头跟着开合转，这是原生 select 没有的反馈；aria-hidden 因为它不承载信息 -->
            <span
                class="i-lucide-chevron-down h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform duration-150 group-data-[state=open]:rotate-180"
                aria-hidden="true"
            ></span>
        </SelectTrigger>

        <!-- 传送到 body，避免祖先 overflow 或 backdrop-filter 裁掉浮层。 -->
        <SelectPortal>
            <SelectContent
                position="popper"
                :side="popperSide"
                :side-flip="allowSideFlip"
                :avoid-collisions="allowSideFlip"
                :side-offset="4"
                :body-lock="false"
                :disable-outside-pointer-events="false"
                :style="{zIndex: NB_Z_INDEX.popover, minWidth: 'var(--reka-select-trigger-width)'}"
                class="nb-ui-popover-surface nb-ui-menu-surface max-h-56 overflow-hidden p-1.5"
            >
                <SelectViewport
                    class="nb-ui-popover-scroll max-h-56"
                    :style="{borderRadius: 'var(--nb-popover-inner-radius)'}"
                >
                    <SelectItem
                        v-for="option in props.options"
                        :key="option.value"
                        :value="option.value"
                        :disabled="option.disabled"
                        class="nb-ui-popover-item mb-1 flex cursor-pointer select-none items-center gap-2 outline-none transition-colors last:mb-0 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 data-[highlighted]:bg-[var(--overlay-item-active)] data-[highlighted]:text-[var(--text-main)] data-[state=checked]:font-medium data-[state=checked]:text-[var(--text-main)]"
                        :class="optionSizeClass"
                    >
                        <span v-if="option.indicatorClass" class="h-1.5 w-1.5 shrink-0 rounded-full shadow-sm" :class="option.indicatorClass" aria-hidden="true"></span>
                        <span v-else-if="option.iconClass" class="h-3 w-3 shrink-0 opacity-70" :class="option.iconClass" aria-hidden="true"></span>
                        <span class="min-w-0 flex-1">
                            <SelectItemText class="block truncate">{{ option.label }}</SelectItemText>
                            <span v-if="option.description" class="mt-0.5 block truncate text-[10px] font-normal text-[var(--text-muted)]">{{ option.description }}</span>
                        </span>
                        <SelectItemIndicator v-if="!props.hideCheckmark" class="shrink-0">
                            <span class="i-lucide-check h-3.5 w-3.5 text-[var(--accent-main)]" aria-hidden="true"></span>
                        </SelectItemIndicator>
                    </SelectItem>
                </SelectViewport>
            </SelectContent>
        </SelectPortal>
    </SelectRoot>
</template>
