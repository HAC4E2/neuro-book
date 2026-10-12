<script setup lang="ts">
import {Spinner} from "@notnotype/nb-ui/components";
import {onBeforeUnmount, ref, shallowRef, watch} from "vue";
import {useRoute, useRouter} from "vue-router";
import {ApiError, streamLines} from "../host/api.js";
import {panelState} from "../host/panel-data.js";
import type {SearchCheckoutDone, SearchHit, SearchRecordMatch} from "../host/types.js";
import LoadState from "../parts/LoadState.vue";
import SearchResults from "../parts/SearchResults.vue";

/**
 * 搜索（第二轮顶栏的搜索）：结果流式到达、逐条出现。顶栏的输入去抖 300 毫秒后才改地址；同一时刻只跑一组，
 * 新的搜索开始时取消旧的（服务端也会结束旧的子进程）。
 */
const route = useRoute();
const router = useRouter();
const records = shallowRef<SearchRecordMatch[]>([]);
const hits = shallowRef<SearchHit[]>([]);
const done = shallowRef<SearchCheckoutDone[]>([]);
const finished = ref(false);
const error = ref<{message: string} | null>(null);
let controller: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

async function run(q: string): Promise<void> {
    controller?.abort();
    records.value = [];
    hits.value = [];
    done.value = [];
    finished.value = false;
    error.value = null;
    if (q.trim().length < 2) {
        finished.value = true;
        return;
    }
    const local = new AbortController();
    controller = local;
    const pendingRecords: SearchRecordMatch[] = [];
    const pendingHits: SearchHit[] = [];
    const pendingDone: SearchCheckoutDone[] = [];
    // 结果一条一条到，攒一帧再交给视图，免得几百条结果触发几百次重排。
    const flush = () => {
        records.value = [...pendingRecords];
        hits.value = [...pendingHits];
        done.value = [...pendingDone];
    };
    const frame = setInterval(flush, 100);
    try {
        await streamLines(`/api/search?q=${encodeURIComponent(q)}`, (line) => {
            if (line.type === "record") pendingRecords.push(line as SearchRecordMatch);
            else if (line.type === "hit") pendingHits.push(line as SearchHit);
            else if (line.type === "checkout_done") pendingDone.push(line as SearchCheckoutDone);
            else if (line.type === "error") error.value = {message: String(line.message)};
        }, local.signal);
        if (controller === local) finished.value = true;
    } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        if (caught instanceof ApiError && caught.status === 401) panelState.unauthorized = true;
        error.value = {message: caught instanceof Error ? caught.message : String(caught)};
    } finally {
        clearInterval(frame);
        if (controller === local) flush();
    }
}

watch(() => route.query.q, (value) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(typeof value === "string" ? value : ""), 300);
}, {immediate: true});
onBeforeUnmount(() => {
    controller?.abort();
    if (timer) clearTimeout(timer);
});

function openRecord(match: SearchRecordMatch): void {
    if (match.kind === "work" && match.workId) void router.push(`/work/${match.workId}`);
    else if (match.kind === "task" && match.workId && match.taskId) void router.push(`/work/${match.workId}/task/${match.taskId}`);
    else if (match.kind === "artifact" && match.workId) void router.push(`/artifact/${match.workId}/${match.taskId ?? "-"}/${match.artifactId}`);
    else void router.push("/live/sessions");
}
</script>

<template>
    <div class="mx-auto flex w-full max-w-[90rem] flex-col gap-4 p-4 md:p-6">
        <h1 class="flex items-center gap-2 font-semibold" style="font-size: var(--text-xl)">
            搜索“{{ route.query.q }}”<Spinner v-if="!finished && !error" size="sm" label="搜索中" />
        </h1>
        <LoadState v-if="error" :loading="false" :error="error" @retry="run(String(route.query.q ?? ''))" />
        <SearchResults :records="records" :hits="hits" :done="done" :finished="finished" @open-record="openRecord" @open-hit="(hit) => router.push({name: 'docs', query: {checkout: hit.checkout, path: hit.path}})" />
    </div>
</template>
