<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";
import {computed, nextTick, onMounted, ref, watch} from "vue";

/**
 * 速览面板（t15 阶段 4 第 2 批，D1、决定点 17）：在页面旁边看产物、文档、证据，不整页跳走。三种摆法由宿主按内容区宽度定：
 * 并排（推开正文）、浮层（盖在正文上、下面一层遮罩）、整屏（手机）。零件只管外框、标题、关闭与焦点，内容与取数在宿主。契约见同名 .md。
 */
const props = defineProps<{
    title: string;
    mode: "side" | "overlay" | "full";
    /** 内容区（外壳的 main，不含左栏与它的滚动条）在视口里的位置与大小；整屏时不用。 */
    box: {top: number; left: number; width: number; height: number};
    /** 并排与浮层时面板的宽度（px）。 */
    width: number;
    /** 换了这个值（开了另一个东西）就把焦点再放到标题上。 */
    focusKey: string;
}>();
const emit = defineEmits<{close: []}>();
const heading = ref<HTMLElement | null>(null);
function focusTitle(): void {
    void nextTick(() => heading.value?.focus());
}
onMounted(focusTitle);
watch(() => props.focusKey, focusTitle);

/** 面板固定在内容区的右边（`position: fixed`，正文照常由 main 滚）；整屏时铺满视口。位置随数据算，所以写成绑定的 style。 */
const panelStyle = computed(() => (props.mode === "full"
    ? {top: "0px", left: "0px", width: "100vw", height: "100dvh"}
    : {top: `${props.box.top}px`, left: `${props.box.left + props.box.width - props.width}px`, width: `${props.width}px`, height: `${props.box.height}px`}));
const scrimStyle = computed(() => ({top: `${props.box.top}px`, left: `${props.box.left}px`, width: `${props.box.width}px`, height: `${props.box.height}px`}));
function onKey(event: KeyboardEvent): void {
    // iframe 里按的键不会冒泡到这里：只靠 Esc 关不了，所以总有可见的“关闭”按钮。
    if (event.key !== "Escape") return;
    event.preventDefault();
    emit("close");
}
</script>

<template>
    <div v-if="mode === 'overlay'" class="nbdev-peek-scrim fixed z-30" :style="scrimStyle" aria-hidden="true" @click="emit('close')" />
    <!-- 层级低于外壳的阻挡层（登录失效）与 nb-ui 的抽屉、对话框：整屏用 z-40，盖住顶栏但不盖住它们。
         只有整屏是模态：浮层时左栏、顶栏仍能操作，按非模态对话框读（遮罩下面的正文由宿主设 inert）。 -->
    <section class="nbdev-peek nbdev-divider fixed flex flex-col" :class="mode === 'full' ? 'z-40' : 'z-30 border-l'" :style="panelStyle" role="dialog" :aria-modal="mode === 'full' ? 'true' : undefined" :aria-label="title" @keydown="onKey">
        <header class="nbdev-divider flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5">
            <h2 ref="heading" tabindex="-1" class="nbdev-card-title min-w-0 flex-1 truncate outline-none" :title="title">{{ title }}</h2>
            <slot name="actions" />
            <Button size="sm" variant="ghost" icon-class="i-lucide-x" @click="emit('close')">关闭</Button>
        </header>
        <div v-if="$slots.status" class="nbdev-note nbdev-divider flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-1.5">
            <slot name="status" />
        </div>
        <!-- 内容自己滚；iframe 类的内容占满这一块（父级是 flex 列）。 -->
        <div class="relative flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
            <slot />
        </div>
    </section>
</template>

<style scoped>
.nbdev-peek {
    background: var(--bg-main);
    box-shadow: -8px 0 24px color-mix(in srgb, var(--text-main) 12%, transparent);
}
.nbdev-peek-scrim {
    background: color-mix(in srgb, var(--bg-main) 55%, transparent);
}
</style>
