<script setup lang="ts">
import {computed} from "vue";
import {paginationRange} from "./pagination-range";

// 分页控件：页码 + 省略号 + 上一页/下一页。page 从 1 开始。
const props = withDefaults(defineProps<{
    page: number;
    pageCount: number;
    /** 当前页两侧各显示多少个相邻页码 */
    siblingCount?: number;
    ariaLabel?: string;
    prevLabel?: string;
    nextLabel?: string;
}>(), {
    siblingCount: 1,
    ariaLabel: "分页",
    prevLabel: "上一页",
    nextLabel: "下一页",
});

const emit = defineEmits<{
    (e: "update:page", value: number): void;
}>();

const items = computed(() => paginationRange(props.page, props.pageCount, props.siblingCount));

function goto(page: number): void {
    const clamped = Math.min(Math.max(page, 1), props.pageCount);
    if (clamped !== props.page) {
        emit("update:page", clamped);
    }
}

const stepButtonClass = "nb-ui-focus-ring inline-flex h-[var(--control-h-sm)] w-[var(--control-h-sm)] items-center justify-center rounded-[var(--radius-control)] text-[var(--text-secondary)] transition-colors [transition-duration:var(--motion-fast)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
</script>

<template>
    <nav :aria-label="props.ariaLabel" class="inline-flex items-center gap-[var(--space-1)]">
        <button type="button" :class="stepButtonClass" :disabled="props.page <= 1" :aria-label="props.prevLabel" :title="props.prevLabel" @click="goto(props.page - 1)">
            <span class="i-lucide-chevron-left h-[1.15em] w-[1.15em]"></span>
        </button>
        <template v-for="item in items" :key="String(item)">
            <span v-if="typeof item === 'string'" class="inline-flex h-[var(--control-h-sm)] w-[calc(var(--control-h-sm)*0.75)] items-center justify-center text-[var(--text-sm)] text-[var(--text-muted)]">…</span>
            <button
                v-else
                type="button"
                class="nb-ui-focus-ring inline-flex h-[var(--control-h-sm)] min-w-[var(--control-h-sm)] items-center justify-center rounded-[var(--radius-control)] px-[var(--space-1)] text-[var(--text-sm)] transition-colors [transition-duration:var(--motion-fast)]"
                :class="item === props.page
                    ? 'bg-[var(--accent-main)] [font-weight:var(--weight-medium)] text-[var(--text-inverse)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                :aria-current="item === props.page ? 'page' : undefined"
                @click="goto(item)"
            >{{ item }}</button>
        </template>
        <button type="button" :class="stepButtonClass" :disabled="props.page >= props.pageCount" :aria-label="props.nextLabel" :title="props.nextLabel" @click="goto(props.page + 1)">
            <span class="i-lucide-chevron-right h-[1.15em] w-[1.15em]"></span>
        </button>
    </nav>
</template>
