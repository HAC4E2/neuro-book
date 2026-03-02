<script setup lang="ts">
import {Handle, Position} from "@vue-flow/core";
import type {NodeProps} from "@vue-flow/core";
import type {PlotTreeRootNodeData} from "nbook/app/components/novel-ide/plot/tree/plot-tree.types";

const props = defineProps<NodeProps<PlotTreeRootNodeData>>();
</script>

<template>
    <!-- 主线开始节点 -->
    <div class="relative w-[180px] rounded-[22px] border border-amber-500/45 bg-[linear-gradient(180deg,rgba(245,158,11,0.18),rgba(120,53,15,0.12))] px-4 py-4 text-left text-stone-900 shadow-[0_16px_40px_rgba(180,83,9,0.18)] dark:text-amber-50">
        <Handle type="source" :position="Position.Right" class="!h-3 !w-3 !border-amber-500 !bg-amber-500" />

        <div class="text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-700/80 dark:text-amber-200/75">Mainline Root</div>
        <div class="mt-2 text-base font-semibold leading-6">{{ props.data.title }}</div>
        <div class="mt-1 text-xs leading-5 text-stone-700/85 dark:text-amber-100/80">{{ props.data.subtitle }}</div>

        <div class="mt-4 grid grid-cols-2 gap-2">
            <div class="rounded-2xl bg-white/50 px-3 py-2 dark:bg-black/15">
                <div class="text-[10px] uppercase tracking-[0.16em] text-stone-600 dark:text-amber-100/70">Thread</div>
                <div class="mt-1 text-sm font-semibold">{{ props.data.threadCount }}</div>
            </div>
            <div class="rounded-2xl bg-white/50 px-3 py-2 dark:bg-black/15">
                <div class="text-[10px] uppercase tracking-[0.16em] text-stone-600 dark:text-amber-100/70">Scene</div>
                <div class="mt-1 text-sm font-semibold">{{ props.data.sceneCount }}</div>
            </div>
        </div>
    </div>
</template>
