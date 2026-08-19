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
const controlSizeClass = computed(() => props.size === "sm" ? "nb-ui-control-h-sm px-[calc(var(--control-px)*0.75)] text-[var(--text-xs)]" : "nb-ui-control-h-md nb-ui-control-px text-[var(--text-sm)]");
const stepAmount = computed(() => {
    const parsed = Number.parseFloat(props.step || "1");
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
});

/** 写入用户输入，保留中间态如空字符串、负号和小数点。 */
function updateValue(value: string): void {
    emit("update:modelValue", value);
}

/** 根据 step / min / max 执行一次上下步进。 */
function stepValueBy(direction: StepDirection): void {
    if (props.disabled || props.readonly) return;
    const current = Number.parseFloat(props.modelValue);
    const fallback = direction === "up" ? minNumber() ?? 0 : maxNumber() ?? 0;
    const base = Number.isFinite(current) ? current : fallback;
    const delta = direction === "up" ? stepAmount.value : -stepAmount.value;
    emit("update:modelValue", formatSteppedNumber(clampNumber(base + delta)));
}

/** Enter 提交、方向键步进，与步进按钮共用同一套逻辑。 */
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

/** 限制数字在 min / max 范围内。 */
function clampNumber(value: number): number {
    const min = minNumber();
    const max = maxNumber();
    if (min !== null && value < min) return min;
    if (max !== null && value > max) return max;
    return value;
}

/** 格式化步进后的数字，避免 0.1 + 0.2 一类浮点尾巴暴露到 UI。 */
function formatSteppedNumber(value: number): string {
    const decimals = decimalPlaces(props.step || "1");
    return decimals > 0 ? Number(value.toFixed(decimals)).toString() : Math.trunc(value).toString();
}

/** 解析 min。 */
function minNumber(): number | null {
    const parsed = Number.parseFloat(props.min ?? "");
    return Number.isFinite(parsed) ? parsed : null;
}

/** 解析 max。 */
function maxNumber(): number | null {
    const parsed = Number.parseFloat(props.max ?? "");
    return Number.isFinite(parsed) ? parsed : null;
}

/** 读取小数位数，用于步进后输出。 */
function decimalPlaces(value: string): number {
    const [, decimal = ""] = value.split(".");
    return decimal.length;
}
</script>

<template>
    <!-- 用自定义步进按钮替代浏览器原生 spinner：原生 spinner 的样式任何 CSS 都够不着 -->
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
        <span class="ml-[var(--space-1)] flex h-[calc(var(--control-h-sm)*0.8)] w-[calc(var(--control-h-sm)*0.64)] shrink-0 flex-col overflow-hidden rounded-[calc(var(--radius-control)*0.5)] border-[length:var(--border-w)] border-[color:var(--control-outline)] bg-[var(--bg-panel)]">
            <button type="button" aria-label="增加" title="增加" class="flex h-1/2 items-center justify-center text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="props.disabled || props.readonly" @click="stepValueBy('up')">
                <span class="i-lucide-chevron-up h-[1em] w-[1em]" aria-hidden="true"></span>
            </button>
            <button type="button" aria-label="减少" title="减少" class="flex h-1/2 items-center justify-center border-t-[length:var(--border-w)] border-[color:var(--control-outline)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="props.disabled || props.readonly" @click="stepValueBy('down')">
                <span class="i-lucide-chevron-down h-[1em] w-[1em]" aria-hidden="true"></span>
            </button>
        </span>
    </div>
</template>
