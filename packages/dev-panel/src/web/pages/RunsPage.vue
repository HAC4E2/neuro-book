<script setup lang="ts">
import {computed} from "vue";
import {useResource} from "../host/panel-data.js";
import type {RunsData} from "../host/types.js";
import EphemeralFrame from "../parts/EphemeralFrame.vue";
import LoadState from "../parts/LoadState.vue";
import ProcList from "../parts/ProcList.vue";
import RunList from "../parts/RunList.vue";
import StaleNotice from "../parts/StaleNotice.vue";
import {shortSession} from "../host/format.js";

/**
 * “在跑”页（t14，Proposal 第九节“现场”）：经 nbdev 起的服务、会话派出的运行、无主的运行。只读：停服务用 `nbdev dev stop`。
 * 后两块已按登记的 pid 去重（经 nbdev 起的服务不再出现在会话的运行里）。随“活动”这一块刷新。
 */
const runs = useResource<RunsData>(() => "/api/runs", ["activity"]);
const data = computed(() => runs.data.value);
</script>

<template>
    <div class="mx-auto flex w-full max-w-[90rem] flex-col gap-5 p-4 md:p-6">
        <h1 class="font-semibold" style="font-size: var(--text-xl)">在跑</h1>
        <StaleNotice v-if="runs.stale.value" :error="runs.error.value!" :received-at="runs.receivedAt.value" @retry="runs.reload()" />
        <LoadState v-if="!data" :loading="runs.loading.value" :error="runs.error.value" label="正在读取在跑的进程" @retry="runs.reload()" />
        <template v-else>
            <EphemeralFrame title="经 nbdev 起的服务">
                <ProcList :runs="data.procs" />
                <p style="color: var(--text-muted); font-size: var(--text-2xs)">停服务在终端运行 nbdev dev stop（别人起的要 --force）；面板这里只看不停。</p>
            </EphemeralFrame>
            <EphemeralFrame title="会话派出的运行">
                <p v-if="data.sessions.length === 0" style="color: var(--text-muted)">没有</p>
                <section v-for="session in data.sessions" :key="session.key" class="flex flex-col gap-1">
                    <h3 class="font-medium" :class="{'line-through': session.alive === false}" style="font-size: var(--text-sm)">{{ shortSession(session.key, session.label) }}</h3>
                    <RunList :runs="session.runs" />
                </section>
            </EphemeralFrame>
            <EphemeralFrame title="无主的运行">
                <p v-if="data.unownedRuns.length === 0" style="color: var(--text-muted)">没有</p>
                <RunList v-else :runs="data.unownedRuns" show-pane />
            </EphemeralFrame>
        </template>
    </div>
</template>
