<script setup lang="ts">
import {Badge} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import {taskLabel, workLabel} from "../host/format.js";
import {docHref, isPlainClick, searchRecordHref} from "../host/routes.js";
import type {SearchCheckoutDone, SearchHit, SearchRecordMatch} from "../host/types.js";

const props = defineProps<{records: SearchRecordMatch[]; hits: SearchHit[]; done: SearchCheckoutDone[]; finished: boolean}>();
const emit = defineEmits<{navigate: [href: string]}>();
function follow(event: MouseEvent, href: string): void {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    emit("navigate", href);
}

const groups = computed(() => {
    const byCheckout = new Map<string, SearchHit[]>();
    for (const hit of props.hits) byCheckout.set(hit.checkout, [...(byCheckout.get(hit.checkout) ?? []), hit]);
    return [...byCheckout.entries()].map(([checkout, hits]) => ({checkout, hits, done: props.done.find((entry) => entry.checkout === checkout) ?? null}));
});
const KIND_LABEL: Record<SearchRecordMatch["kind"], string> = {work: "Work", task: "Task", artifact: "产物", session: "会话"};
function recordText(match: SearchRecordMatch): string {
    if (match.kind === "session") return match.label ?? match.key ?? "";
    const where = match.workId ? `${workLabel(match.workId)}${match.taskId ? `/${taskLabel(match.taskId)}` : ""}` : "";
    return `${where} ${match.title ?? match.artifactId ?? match.taskId ?? match.workId ?? ""}`.trim();
}
</script>

<template>
    <div class="flex flex-col gap-5">
        <section v-if="records.length > 0" class="flex flex-col gap-1">
            <h2 class="font-semibold">Work、Task、产物与会话</h2>
            <ul class="flex flex-col">
                <li v-for="(match, index) in records" :key="index">
                    <a :href="searchRecordHref(match)" class="flex w-full items-center gap-2 px-1 py-1 hover:bg-[var(--bg-hover)]" @click="follow($event, searchRecordHref(match))">
                        <Badge tone="neutral" variant="outline" size="sm">{{ KIND_LABEL[match.kind] }}</Badge><span class="truncate">{{ recordText(match) }}</span>
                    </a>
                </li>
            </ul>
        </section>
        <section v-for="group in groups" :key="group.checkout" class="flex flex-col gap-1">
            <h2 class="flex flex-wrap items-center gap-2 font-semibold">
                {{ group.checkout }}
                <span style="color: var(--text-secondary); font-weight: normal; font-size: var(--text-xs)">{{ group.hits.length }} 条<template v-if="group.done"> · {{ group.done.elapsedMs }} 毫秒</template></span>
                <Badge v-if="group.done?.truncated" tone="warning" variant="soft" size="sm">截断了</Badge>
                <Badge v-if="group.done?.error" tone="danger" variant="soft" size="sm">出错</Badge>
            </h2>
            <ul class="flex flex-col" style="font-size: var(--text-xs)">
                <li v-for="(hit, index) in group.hits" :key="index" class="min-w-0">
                    <a v-if="hit.path.endsWith('.md')" :href="docHref(hit.checkout, hit.path)" class="flex w-full min-w-0 flex-wrap items-baseline gap-x-2 px-1 py-0.5 hover:bg-[var(--bg-hover)]" @click="follow($event, docHref(hit.checkout, hit.path))">
                        <span class="font-medium">{{ hit.path }}<template v-if="hit.line">:{{ hit.line }}</template></span>
                        <code v-if="hit.text" class="min-w-0 flex-1 truncate" style="color: var(--text-secondary)">{{ hit.text }}</code>
                    </a>
                    <div v-else class="flex w-full min-w-0 flex-wrap items-baseline gap-x-2 px-1 py-0.5">
                        <span>{{ hit.path }}<template v-if="hit.line">:{{ hit.line }}</template></span>
                        <code v-if="hit.text" class="min-w-0 flex-1 truncate" style="color: var(--text-secondary)">{{ hit.text }}</code>
                    </div>
                </li>
            </ul>
        </section>
        <p v-if="finished && records.length === 0 && hits.length === 0" style="color: var(--text-muted)">没有找到</p>
    </div>
</template>
