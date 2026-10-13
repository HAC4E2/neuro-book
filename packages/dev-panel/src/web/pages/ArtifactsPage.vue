<script setup lang="ts">
import {FormInput} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";
import {useRouter} from "vue-router";
import {useResource} from "../host/panel-data.js";
import type {ArtifactsData} from "../host/types.js";
import ArtifactList from "../parts/ArtifactList.vue";
import LoadState from "../parts/LoadState.vue";
import StaleNotice from "../parts/StaleNotice.vue";

/** 产物列表（t03 第二轮产物页的列表）：按类分组，可按 Work、Task 或标题过滤。 */
const router = useRouter();
const list = useResource<ArtifactsData>(() => "/api/artifacts", ["records"]);
const filter = ref("");
const match = (...texts: Array<string | null | undefined>) => {
    const q = filter.value.trim().toLowerCase();
    return q === "" || texts.some((text) => text?.toLowerCase().includes(q));
};
const filtered = computed(() => {
    const data = list.data.value;
    if (!data) return null;
    return {
        artifacts: data.artifacts.filter((item) => match(item.workId, item.taskId, item.title, item.artifactId, item.workTitle, item.taskTitle)),
        documents: data.documents.filter((item) => match(item.workId, item.taskId, item.title, item.path)),
        evidences: data.evidences.filter((item) => match(item.workId, item.taskId, item.taskTitle)),
    };
});
</script>

<template>
    <div class="mx-auto flex w-full max-w-[90rem] flex-col gap-4 p-4 md:p-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <h1 class="font-semibold" style="font-size: var(--text-xl)">产物</h1>
            <div class="w-full max-w-sm"><FormInput v-model="filter" placeholder="按 Work、Task 或标题过滤" aria-label="过滤产物" /></div>
        </div>
        <StaleNotice v-if="list.stale.value" :error="list.error.value!" :received-at="list.receivedAt.value" @retry="list.reload()" />
        <LoadState v-if="!filtered" :loading="list.loading.value" :error="list.error.value" label="正在读取产物" @retry="list.reload()" />
        <ArtifactList v-else :artifacts="filtered.artifacts" :documents="filtered.documents" :evidences="filtered.evidences" @navigate="(href) => router.push(href)" />
    </div>
</template>
