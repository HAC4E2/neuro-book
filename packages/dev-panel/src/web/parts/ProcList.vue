<script setup lang="ts">
import {Badge} from "@notnotype/nb-ui/components";
import {relativeTime, shortSession} from "../host/format.js";
import type {ProcRunView} from "../host/types.js";

/** 经 nbdev 起的服务（`run/procs/` 的登记加现算的状态）；契约见同名 .md。 */
defineProps<{runs: ProcRunView[]}>();
const TONE: Record<ProcRunView["state"], "accent" | "success" | "warning" | "neutral"> = {starting: "accent", running: "success", orphaned: "warning", ended: "neutral"};
const LABEL: Record<ProcRunView["state"], string> = {starting: "启动中", running: "在跑", orphaned: "没人监管", ended: "已结束"};
const REASON: Record<string, string> = {
    supervisor_gone: "监管进程不在了", leader_exited: "组长已退、还有进程", exited: "自己退出", stopped: "被停掉", supervisor_killed: "监管进程被杀",
    rebooted: "重启过", never_started: "没起来",
};
const safeUrl = (url: string | null) => (url && /^https?:\/\//u.test(url) ? url : null);
</script>

<template>
    <p v-if="runs.length === 0" style="color: var(--text-muted)">没有经 nbdev 起的服务（Agent 用 nbdev dev start 起）</p>
    <ul v-else class="flex flex-col gap-2">
        <li v-for="run in runs" :key="run.runId" class="flex flex-col gap-0.5 border-b pb-2 last:border-b-0" style="border-color: var(--divider)" :style="{opacity: run.state === 'ended' ? 0.6 : 1}">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
                <Badge :tone="TONE[run.state]" variant="soft" size="sm">{{ LABEL[run.state] }}</Badge>
                <span class="font-medium">{{ run.checkoutKey }} · {{ run.package }} · {{ run.script }}</span>
                <a v-if="safeUrl(run.url) && run.state !== 'ended'" :href="safeUrl(run.url)!" target="_blank" rel="noopener noreferrer" class="break-all" style="font-size: var(--text-xs)">{{ run.url }}</a>
                <span v-else-if="run.state !== 'ended'" style="color: var(--text-muted); font-size: var(--text-xs)">地址未知</span>
            </div>
            <span class="min-w-0 break-all" style="color: var(--text-secondary); font-size: var(--text-xs)">
                {{ run.startedBy ? shortSession(run.startedBy.key, run.startedBy.label) : "未认出的调用者" }}起 · {{ relativeTime(run.startedAt) }}<template v-if="run.workId && run.taskId"> · {{ run.workId.slice(0, 6) }}/{{ run.taskId.slice(0, run.taskId.indexOf("-")) }}</template><template v-if="run.reason"> · {{ REASON[run.reason] ?? run.reason }}</template><template v-if="run.state === 'ended' && run.exitCode !== null"> · 退出码 {{ run.exitCode }}</template> · 日志 <code>{{ run.logPath }}</code>
            </span>
        </li>
    </ul>
</template>
