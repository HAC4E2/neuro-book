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

/**
 * 下拉选择。
 *
 * 这里**不能**用原生 `<select>`：它的弹出列表由操作系统绘制，任何 CSS 都够不着。
 * 表现就是整套主题只到控件本身为止，一点开就露出一个系统菜单——用户的原话是
 * 「下拉选择目前还是浏览器原生的」。这不是样式没调好，是原生控件的硬边界。
 *
 * 换成 Reka 的 Select 原语后，弹出层是页面内的 DOM，因此能吃到 `.nb-ui-popover-surface`
 * 那一套（圆角、描边、面色、阴影、磨砂全走主题变量），键盘与 ARIA 由原语负责。
 *
 * FormField 集成与表单提交和原生实现一致：SelectRoot 在「trigger 处于 <form> 内且给了 name」
 * 时会渲染一个视觉隐藏的原生 select（BubbleSelect）来承载提交值。
 * 契约在原生实现之上扩展过一轮：placeholder、sm 尺寸、固定展开方向、富选项、隐藏勾选与 focus 事件。
 */

export type FormSelectSize = "default" | "sm";
export type FormSelectDirection = "auto" | "up" | "down";

export type FormSelectOption = {
    label: string;
    value: string;
    /** 次行说明文字，富选项场景使用 */
    description?: string;
    /** i-lucide-* 图标类，与 indicatorClass 互斥（indicator 优先） */
    iconClass?: string;
    /** 状态色圆点类（如 bg-emerald-500），与 iconClass 互斥（indicator 优先） */
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
const controlSizeClass = computed(() => props.size === "sm" ? "nb-ui-control-h-sm px-[calc(var(--control-px)*0.75)] text-[var(--text-xs)]" : "nb-ui-control-h-md nb-ui-control-px text-[var(--text-sm)]");
const optionSizeClass = computed(() => props.size === "sm" ? "min-h-[calc(var(--control-h-sm)-var(--space-1))] px-[calc(var(--control-px)*0.75)] py-[var(--space-1)] text-[var(--text-xs)]" : "min-h-[var(--control-h-sm)] px-[var(--space-4)] py-[var(--space-1)] text-[var(--text-sm)]");
const popperSide = computed(() => {
    if (props.dropdownDirection === "up") return "top" as const;
    if (props.dropdownDirection === "down") return "bottom" as const;
    return undefined;
});
// auto 档允许 popper 翻转避让视口边缘；固定方向档尊重调用方选择，不翻转
const allowSideFlip = computed(() => props.dropdownDirection === "auto");

/*
 * 当前值的显示文字自己算，不用 SelectValue 的默认文本。
 *
 * 原语的默认文本取自 SelectItem 挂载时注册进来的选项表，而 item 在 portal 里的 SelectContent
 * 中——关着的时候整棵内容树没挂载，选项表是空的，于是**没点开过的下拉是一片空白**。
 * 原生 <select> 不会这样，所以照搬原语的默认行为就是一处真回归（已有测试盯住）。
 *
 * 这个组件本来就持有 options，标签不需要靠原语去发现。
 */
const selectedOption = computed(() => props.options.find((option) => option.value === props.modelValue));
const selectedLabel = computed(() => selectedOption.value?.label ?? "");

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
            class="nb-ui-control flex w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border bg-[var(--control-surface)] text-[var(--text-main)] outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60"
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
                class="i-lucide-chevron-down h-[1.15em] w-[1.15em] shrink-0 text-[var(--text-muted)] transition-transform [transition-duration:var(--motion-fast)] data-[state=open]:rotate-180"
                aria-hidden="true"
            ></span>
        </SelectTrigger>

        <!--
            传送到 body：弹出层留在原地会被祖先的 overflow 裁掉，也会被祖先的 backdrop-filter
            圈成 backdrop root——那样它自己的磨砂就采不到页面背景，玻璃等于白加。
        -->
        <SelectPortal>
            <!--
                非模态：`body-lock` 与 `disable-outside-pointer-events` 都要关。

                Reka 的 Select 默认按模态浮层处理，开着的时候往 body 上写 `overflow: hidden`
                和 `pointer-events: none`——表现就是「下拉一打开，整页就不能滚了，别的地方也点不动」。
                对话框那样占据全屏注意力的浮层该这么做，一个下拉不该：它是就地展开的一段选项，
                页面在它背后仍然是活的。

                两个都得关，只关一个是半吊子：只关 body-lock 页面能滚但仍然点不动，
                只关 pointer-events 能点但滚不动。

                位置由 popper（floating-ui）维持，页面滚动时浮层跟着触发器走，不会掉队。
            -->
            <SelectContent
                position="popper"
                :side="popperSide"
                :side-flip="allowSideFlip"
                :avoid-collisions="allowSideFlip"
                :side-offset="4"
                :body-lock="false"
                :disable-outside-pointer-events="false"
                :style="{zIndex: NB_Z_INDEX.popover, minWidth: 'var(--reka-select-trigger-width)'}"
                class="nb-ui-popover-surface nb-ui-menu-surface max-h-[calc(var(--control-h-sm)*8)] overflow-hidden p-[var(--space-2)]"
            >
                <!--
                    滚动交给内部这一层，不加在浮层本体上：否则滚动条画进 --radius-panel 的圆角里，
                    首尾两项也会被弧线削掉。理由与判据见 styles.css 的 .nb-ui-popover-scroll。

                    一处例外要说清楚：**这里的滚动条颜色不归我们管**。Reka 给
                    `[data-reka-select-viewport]` 注入了 `scrollbar-width: none`，特异性与本类持平
                    而顺序在后，所以它赢——原语是刻意隐藏滚动条、改用上下滚动按钮做溢出提示的。
                    本类在这里真正起作用的是 overscroll-behavior（挡住滚动链传到整页）与同心圆角。
                    将来选项多到需要溢出提示时，补 SelectScrollUpButton / SelectScrollDownButton，
                    别去跟原语抢滚动条。
                -->
                <SelectViewport
                    class="nb-ui-popover-scroll max-h-[calc(var(--control-h-sm)*8)]"
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
                            <!--
                                SelectItemText 渲染的是它自己的 slot，**不会**从 value 推出文字。
                                写成自闭合标签就等于把每一项都渲染成空白——弹出列表整片空、只剩勾选标记，
                                而 trigger 上的当前值又是组件自己算的，所以关着的时候一切正常，
                                点开才露馅。原生 <select> 的 <option> 有文字内容，换原语时这一处必须补上。
                            -->
                            <SelectItemText class="block truncate">{{ option.label }}</SelectItemText>
                            <span v-if="option.description" class="mt-[calc(var(--space-1)*0.5)] block truncate text-[var(--text-2xs)] font-normal text-[var(--text-muted)]">{{ option.description }}</span>
                        </span>
                        <SelectItemIndicator v-if="!props.hideCheckmark" class="shrink-0">
                            <span class="i-lucide-check h-[1.15em] w-[1.15em] text-[var(--accent-main)]" aria-hidden="true"></span>
                        </SelectItemIndicator>
                    </SelectItem>
                </SelectViewport>
            </SelectContent>
        </SelectPortal>
    </SelectRoot>
</template>
