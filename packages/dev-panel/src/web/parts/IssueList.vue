<script setup lang="ts">
import {Badge} from "@notnotype/nb-ui/components";
import {relativeTime} from "../host/format.js";
import type {IssueView} from "../host/types.js";

/** 开着的 Issue（GitHub 只读）；契约见同名 .md。标题与标签是外部内容，一律按纯文本渲染。 */
defineProps<{issues: IssueView[]}>();
</script>

<template>
    <p v-if="issues.length === 0" style="color: var(--text-muted)">没有开着的 Issue</p>
    <ul v-else class="flex flex-col gap-1">
        <li v-for="issue in issues" :key="issue.number" class="flex min-w-0 flex-wrap items-center gap-2" style="font-size: var(--text-sm)">
            <a v-if="issue.url" :href="issue.url" target="_blank" rel="noopener noreferrer">#{{ issue.number }}</a>
            <span v-else>#{{ issue.number }}</span>
            <span class="min-w-0 break-all">{{ issue.title }}</span>
            <Badge v-for="label in issue.labels" :key="label" tone="neutral" variant="soft" size="sm">{{ label }}</Badge>
            <span style="color: var(--text-muted); font-size: var(--text-xs)">{{ relativeTime(issue.updatedAt) }}更新</span>
        </li>
    </ul>
</template>
