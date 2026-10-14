<script setup lang="ts">
import {computed, ref} from "vue";
import {OverlayScrollbar} from "@notnotype/nb-ui/components";

import type {LabFixtureProps} from "../../lab-subject";

const props = defineProps<LabFixtureProps>();
// 被测组件接到一个已有的滚动元素上：这里的列表扮演调用方（例如资源管理器的树），场景只决定内容够不够长。
const scroller = ref<HTMLElement | null>(null);
const rows = computed(() => Array.from({length: props.scene === "short" ? 5 : 80}, (_, index) => `第 ${String(index + 1)} 行：港口的雾从傍晚开始漫上来`));
</script>

<template>
    <div class="relative h-[360px] max-h-full w-full max-w-[420px] overflow-hidden rounded-[var(--radius-panel)] bg-[var(--bg-panel)]">
        <ul ref="scroller" class="h-full overflow-y-auto py-1 text-sm text-[var(--text-main)]">
            <li v-for="row in rows" :key="row" class="mx-1.5 truncate rounded-[var(--radius-control)] px-2 py-1 hover:bg-[var(--bg-hover)]">{{ row }}</li>
        </ul>
        <OverlayScrollbar data-lab-subject :target="scroller" />
    </div>
</template>
