<script setup lang="ts">
const props = defineProps<{
    modelValue: string;
    loading: boolean;
    typing: boolean;
    statusText: string;
    selectedModel: string;
    selectedReasoning: string;
    expanded: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "update:expanded", value: boolean): void;
    (e: "send"): void;
    (e: "stop"): void;
    (e: "height-change", value: number): void;
}>();

const rootRef = ref<HTMLDivElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
let resizeObserver: ResizeObserver | null = null;

/**
 * 发送当前 PromptBar 的真实高度。
 */
const reportHeight = (): void => {
    emit("height-change", rootRef.value?.offsetHeight ?? 0);
};

/**
 * 自适应输入框高度。
 */
const resize = (): void => {
    if (!textareaRef.value) {
        return;
    }

    textareaRef.value.style.height = "0px";
    textareaRef.value.style.height = `${String(Math.max(48, Math.min(textareaRef.value.scrollHeight, 150)))}px`;
    reportHeight();
};

/**
 * 处理输入。
 */
const onInput = (event: Event): void => {
    emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
    resize();
};

/**
 * 处理发送或停止。
 */
const submit = (): void => {
    if (props.loading) {
        emit("stop");
        return;
    }
    emit("send");
};

/**
 * 处理快捷键。
 */
const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" || event.shiftKey) {
        return;
    }
    event.preventDefault();
    submit();
};

/**
 * 切换 PromptBar 展开状态。
 */
const toggleExpanded = (): void => {
    emit("update:expanded", !props.expanded);
};

watch(() => props.modelValue, async () => {
    await nextTick();
    resize();
}, { immediate: true });

watch(() => props.expanded, async () => {
    await nextTick();
    resize();
    reportHeight();
}, { immediate: true });

onMounted(async () => {
    await nextTick();
    resize();

    if (rootRef.value) {
        resizeObserver = new ResizeObserver(() => {
            reportHeight();
        });
        resizeObserver.observe(rootRef.value);
    }
});

onBeforeUnmount(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
});
</script>

<template>
    <!-- 底部 AI Prompt Bar -->
    <div ref="rootRef" class="ide-prompt-bar z-20 shrink-0 px-4">
        <div v-if="props.expanded" class="relative mx-auto w-full max-w-3xl pb-6 pt-7">
            <button
                class="absolute left-1/2 top-7 flex h-6 w-12 -translate-x-1/2 -translate-y-full items-center justify-center rounded-t-full border border-b-0 border-[var(--prompt-border)] bg-[var(--prompt-bg)] text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                title="收起输入栏"
                @click="toggleExpanded"
            >
                <span class="i-lucide-chevron-down h-3.5 w-3.5"></span>
            </button>

            <div class="w-full overflow-hidden rounded-[1.4rem] border border-[var(--prompt-border)] bg-[var(--prompt-bg)] shadow-2xl shadow-black/10 transition-all focus-within:border-[var(--accent-main)] focus-within:ring-1 focus-within:ring-[var(--accent-main)]">
                <textarea
                    ref="textareaRef"
                    :value="props.modelValue"
                    rows="1"
                    placeholder="输入你想让 AI 做什么，例如续写一段环境描写，或让主角遇到一个神秘人。"
                    class="w-full min-h-[48px] max-h-[150px] resize-none overflow-y-auto bg-transparent px-5 py-3 text-sm leading-7 text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]"
                    @input="onInput"
                    @keydown="onKeydown"
                ></textarea>

                <div class="flex items-center justify-between gap-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)] px-3 py-2">
                    <div class="flex min-w-0 items-center gap-1">
                        <button class="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]">
                            <span class="i-lucide-plus h-4 w-4"></span>
                        </button>

                        <div class="inline-flex items-center gap-1 rounded-3 px-2.5 py-1 text-xs text-[var(--text-secondary)]">
                            <span class="i-lucide-cpu h-3 w-3 text-[var(--text-muted)]"></span>
                            <span class="max-w-[9.5rem] truncate">{{ props.selectedModel }}</span>
                        </div>

                        <div class="inline-flex items-center gap-1 rounded-3 px-2.5 py-1 text-xs text-[var(--text-secondary)]">
                            <span class="i-lucide-brain h-3 w-3 text-[var(--text-muted)]"></span>
                            <span>{{ props.selectedReasoning }}</span>
                        </div>
                    </div>

                    <div class="flex items-center gap-3">
                        <div class="hidden text-right sm:block">
                            <div class="text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">系统状态</div>
                            <div class="text-xs text-[var(--text-secondary)]">{{ props.statusText }}</div>
                        </div>

                        <button
                            class="flex h-8 w-8 items-center justify-center rounded-full border transition-colors"
                            :class="props.loading ? 'border-rose-500/50 bg-rose-500/10 text-rose-500' : 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)] hover:opacity-85'"
                            @click="submit"
                        >
                            <span v-if="props.loading" class="i-lucide-square h-3.5 w-3.5"></span>
                            <span v-else-if="props.typing" class="i-lucide-pencil-line h-3.5 w-3.5"></span>
                            <span v-else class="i-lucide-send h-3.5 w-3.5"></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <div v-else class="flex justify-center">
            <button
                class="flex h-6 w-12 items-center justify-center rounded-t-full border border-b-0 border-[var(--prompt-border)] bg-[var(--prompt-bg)] text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                title="展开输入栏"
                @click="toggleExpanded"
            >
                <span class="i-lucide-chevron-up h-3.5 w-3.5"></span>
            </button>
        </div>
    </div>
</template>
