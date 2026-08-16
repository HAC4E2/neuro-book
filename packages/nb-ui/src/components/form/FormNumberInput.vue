<script setup lang="ts">
import {computed} from "vue";
import {useFormFieldContext} from "./form-field-context";

export type NumberInputSize = "default" | "sm";
type StepDirection = "down" | "up";

const props = withDefaults(defineProps<{
    modelValue: string;
    id?: string;
    name?: string;
    placeholder?: string;
    disabled?: boolean;
    readonly?: boolean;
    required?: boolean;
    autofocus?: boolean;
    min?: string;
    max?: string;
    step?: string;
    size?: NumberInputSize;
    title?: string;
}>(), {
    id: "",
    name: "",
    placeholder: "",
    disabled: false,
    readonly: false,
    required: false,
    autofocus: false,
    min: undefined,
    max: undefined,
    size: "default",
    step: "1",
    title: undefined,
});

const emit = defineEmits<{
    (e: "submit"): void;
    (e: "update:modelValue", value: string): void;
}>();

const field = useFormFieldContext();
const controlSizeClass = computed(() => props.size === "sm" ? "nb-ui-control-h-sm px-2 text-xs" : "nb-ui-control-h-md nb-ui-control-px text-sm");
const stepAmount = computed(() => {
    const parsed = Number.parseFloat(props.step || "1");
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
});

function updateValue(value: string): void {
    emit("update:modelValue", value);
}

function stepValueBy(direction: StepDirection): void {
    if (props.disabled || props.readonly) return;
    const current = Number.parseFloat(props.modelValue);
    const fallback = direction === "up" ? minNumber() ?? 0 : maxNumber() ?? 0;
    const base = Number.isFinite(current) ? current : fallback;
    const delta = direction === "up" ? stepAmount.value : -stepAmount.value;
    emit("update:modelValue", formatSteppedNumber(clampNumber(base + delta)));
}

function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
        event.preventDefault();
        emit("submit");
        return;
    }
    if (event.key === "ArrowUp") {
        event.preventDefault();
        stepValueBy("up");
        return;
    }
    if (event.key === "ArrowDown") {
        event.preventDefault();
        stepValueBy("down");
    }
}

function clampNumber(value: number): number {
    const min = minNumber();
    const max = maxNumber();
    if (min !== null && value < min) return min;
    if (max !== null && value > max) return max;
    return value;
}

function formatSteppedNumber(value: number): string {
    const decimals = decimalPlaces(props.step || "1");
    return decimals > 0 ? Number(value.toFixed(decimals)).toString() : Math.trunc(value).toString();
}

function minNumber(): number | null {
    const parsed = Number.parseFloat(props.min ?? "");
    return Number.isFinite(parsed) ? parsed : null;
}

function maxNumber(): number | null {
    const parsed = Number.parseFloat(props.max ?? "");
    return Number.isFinite(parsed) ? parsed : null;
}

function decimalPlaces(value: string): number {
    const [, decimal = ""] = value.split(".");
    return decimal.length;
}
</script>

<template>
    <div
        class="nb-ui-control flex w-full min-w-0 items-center rounded-[var(--radius-control)] border bg-[var(--control-surface)] text-[var(--text-main)] transition-colors focus-within:outline-none"
        :class="[controlSizeClass, field?.invalid.value ? 'nb-ui-control-invalid' : '', props.disabled || props.readonly ? 'cursor-default opacity-60' : '']"
        :title="props.title"
    >
        <input
            :value="props.modelValue"
            :id="props.id || field?.inputId.value || undefined"
            :name="props.name || undefined"
            type="text"
            inputmode="decimal"
            :placeholder="props.placeholder"
            :disabled="props.disabled"
            :readonly="props.readonly"
            :required="props.required || field?.required.value"
            :autofocus="props.autofocus"
            :aria-describedby="field?.ariaDescribedby.value"
            :aria-invalid="field?.invalid.value || undefined"
            class="min-w-0 flex-1 bg-transparent font-mono text-[inherit] text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]"
            @input="updateValue(($event.target as HTMLInputElement).value)"
            @keydown="handleKeydown"
        >
        <span class="ml-1 flex h-5 w-4 shrink-0 flex-col overflow-hidden rounded-sm border border-[var(--control-outline)] bg-[var(--bg-panel)]">
            <button type="button" aria-label="增加" title="增加" class="flex h-1/2 items-center justify-center text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="props.disabled || props.readonly" @click="stepValueBy('up')">
                <span class="i-lucide-chevron-up h-2.5 w-2.5" aria-hidden="true"></span>
            </button>
            <button type="button" aria-label="减少" title="减少" class="flex h-1/2 items-center justify-center border-t border-[var(--control-outline)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="props.disabled || props.readonly" @click="stepValueBy('down')">
                <span class="i-lucide-chevron-down h-2.5 w-2.5" aria-hidden="true"></span>
            </button>
        </span>
    </div>
</template>
