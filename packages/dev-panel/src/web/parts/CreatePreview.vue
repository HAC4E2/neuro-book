<script setup lang="ts">
import {Collapsible, Spinner} from "@notnotype/nb-ui/components";
import {ref} from "vue";
import type {CreatePreviewData} from "../host/types.js";

/** 新建的预览：预计领到的号、要写的文件与内容、提交信息。号以提交时为准（预览不取锁）。 */
defineProps<{preview: CreatePreviewData | null; loading: boolean}>();
const open = ref<Record<string, boolean>>({});
</script>

<template>
    <section class="flex flex-col gap-3" aria-label="预览">
        <h2 class="flex items-center gap-2 font-semibold">预览<Spinner v-if="loading" size="sm" label="正在预览" /></h2>
        <p v-if="!preview" style="color: var(--text-muted)">填了短名与标题之后在这里看会写什么</p>
        <template v-else>
            <p>
                预计领到 <code>{{ preview.workId ?? "（短名不合规）" }}</code><template v-if="preview.taskId"> / <code>{{ preview.taskId }}</code></template>
            </p>
            <p style="color: var(--text-secondary); font-size: var(--text-xs)">以提交时为准：提交之前有人领了号就顺延</p>
            <ul v-if="preview.problems.length > 0" class="flex flex-col gap-0.5" style="color: var(--status-danger); font-size: var(--text-xs)">
                <li v-for="problem in preview.problems" :key="`${problem.field}:${problem.code}`">{{ problem.field }}：{{ problem.message }}</li>
            </ul>
            <div v-if="preview.message" class="flex flex-col gap-1">
                <span style="color: var(--text-secondary); font-size: var(--text-xs)">提交信息</span>
                <code style="font-size: var(--text-xs)">{{ preview.message }}</code>
            </div>
            <div v-for="path in preview.paths" :key="path" class="flex flex-col gap-1">
                <Collapsible :open="open[path] ?? false" @update:open="(value: boolean) => (open = {...open, [path]: value})">
                    <template #trigger>
                        <button type="button" class="flex items-center gap-1 text-left" style="font-size: var(--text-xs)" :aria-expanded="open[path] ?? false">
                            <span :class="open[path] ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5 shrink-0" aria-hidden="true" /><code class="break-all">{{ path }}</code>
                        </button>
                    </template>
                    <pre class="mt-1 max-h-72 overflow-auto rounded-[var(--radius-control)] p-2" style="background: var(--bg-subtle); font-size: var(--text-xs)">{{ preview.files[path] }}</pre>
                </Collapsible>
            </div>
        </template>
    </section>
</template>
