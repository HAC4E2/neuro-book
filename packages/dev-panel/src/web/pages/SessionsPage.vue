<script setup lang="ts">
import {Badge} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import {HERDR_STATUS_LABEL, relativeTime} from "../host/format.js";
import {useResource} from "../host/panel-data.js";
import type {SessionsData} from "../host/types.js";
import EphemeralFrame from "../parts/EphemeralFrame.vue";
import LoadState from "../parts/LoadState.vue";
import RunList from "../parts/RunList.vue";
import SessionList from "../parts/SessionList.vue";

/**
 * 会话页（t03 第三轮会话页的左半边；终端在 t12，通知在 t11）：会话以会话 id 加 Agent 名称认，状态与它的运行分开列，附租约；
 * 无主的运行单列；herdr 里不在本仓库的 pane 单列；herdr 不可用时给出说明。“在等你”只认登记的提问，不从终端推断。
 */
const sessions = useResource<SessionsData>(() => "/api/sessions", ["activity", "sessions"]);
const data = computed(() => sessions.data.value);
const managedKeys = computed(() => new Set((data.value?.sessions ?? []).map((session) => session.sessionId)));
const otherPanes = computed(() => (data.value?.panes ?? []).filter((pane) => pane.agent !== null && !pane.inRepository));
const idlePanes = computed(() => (data.value?.panes ?? []).filter((pane) => pane.agent !== null && pane.inRepository && !managedKeys.value.has(pane.session?.value ?? null)));
</script>

<template>
    <div class="mx-auto flex w-full max-w-[90rem] flex-col gap-5 p-4 md:p-6">
        <h1 class="font-semibold" style="font-size: var(--text-xl)">会话</h1>
        <LoadState v-if="!data" :loading="sessions.loading.value" :error="sessions.error.value" label="正在读取会话" @retry="sessions.reload()" />
        <template v-else>
            <p class="flex flex-wrap items-center gap-2" style="font-size: var(--text-xs); color: var(--text-secondary)">
                <Badge :tone="data.herdr.available ? 'success' : 'warning'" variant="soft" size="sm">{{ data.herdr.available ? `herdr ${data.herdr.version ?? ""}` : "herdr 不可用" }}</Badge>
                <span v-if="data.herdr.available">{{ data.herdr.mode === "subscribed" ? "已订阅推送" : "轮询中" }}<template v-if="data.herdr.at"> · {{ relativeTime(data.herdr.at) }}更新</template><template v-if="data.herdr.missedEvents > 0"> · 对账补上了 {{ data.herdr.missedEvents }} 次漏掉的状态变化</template></span>
                <span v-else>{{ data.herdr.error ?? "连不上 herdr" }}：租约照常按会话进程与 24 小时判断，看不到会话的状态</span>
            </p>
            <EphemeralFrame title="持有租约或运行的会话">
                <SessionList :sessions="data.sessions" />
            </EphemeralFrame>
            <EphemeralFrame title="无主的运行">
                <p v-if="data.unownedRuns.length === 0" style="color: var(--text-muted)">没有</p>
                <RunList v-else :runs="data.unownedRuns" show-pane />
            </EphemeralFrame>
            <EphemeralFrame v-if="idlePanes.length > 0" title="本仓库里的其它 Agent pane">
                <ul class="flex flex-col gap-1" style="font-size: var(--text-xs)">
                    <li v-for="pane in idlePanes" :key="pane.paneId">{{ pane.agent }} · pane {{ pane.paneId }} · {{ HERDR_STATUS_LABEL[pane.status] ?? pane.status }}<template v-if="pane.workspaceLabel"> · {{ pane.workspaceLabel }}</template></li>
                </ul>
            </EphemeralFrame>
            <EphemeralFrame v-if="otherPanes.length > 0" title="不在本仓库的会话">
                <ul class="flex flex-col gap-1" style="font-size: var(--text-xs); color: var(--text-secondary)">
                    <li v-for="pane in otherPanes" :key="pane.paneId">{{ pane.agent }} · pane {{ pane.paneId }} · {{ HERDR_STATUS_LABEL[pane.status] ?? pane.status }} · {{ pane.foregroundCwd ?? pane.cwd ?? "目录未知" }}</li>
                </ul>
            </EphemeralFrame>
            <p v-if="data.ignoredProcesses > 0" style="font-size: var(--text-xs); color: var(--text-muted)">另有 {{ data.ignoredProcesses }} 个短命或无关的进程没有列出</p>
        </template>
    </div>
</template>
