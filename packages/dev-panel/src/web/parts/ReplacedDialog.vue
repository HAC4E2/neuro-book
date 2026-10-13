<script setup lang="ts">
import {Button, Dialog} from "@notnotype/nb-ui/components";
import {HERDR_STATUS_LABEL, taskLabel, workLabel} from "../host/format.js";
import type {NotifyJob} from "../host/types.js";

/** 会话已更换的小窗：发给现在的会话，或不通知；契约见同名 .md。 */
withDefaults(defineProps<{open: boolean; job: NotifyJob | null; pending?: boolean}>(), {pending: false});
const emit = defineEmits<{send: [job: NotifyJob, target: {paneId: string; sessionKey: string}]; skip: [job: NotifyJob]}>();
</script>

<template>
    <Dialog :model-value="open" title="提问的会话已经换了" size="md" :busy="pending" :close-on-overlay="false" :close-on-esc="false">
        <div v-if="job && job.replacedBy" class="flex flex-col gap-3">
            <p>{{ workLabel(job.workId) }}/{{ taskLabel(job.taskId) }} 有 {{ job.questions }} 题新的答复，要通知提问的会话。</p>
            <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5" style="font-size: var(--text-xs)">
                <dt style="color: var(--text-muted)">谁问的</dt>
                <dd class="break-all"><code>{{ job.sessionKey }}</code>（在 pane {{ job.askerPaneId ?? "未知" }}）</dd>
                <dt style="color: var(--text-muted)">pane 上现在</dt>
                <dd class="break-all"><code>{{ job.replacedBy.sessionKey }}</code>（{{ job.replacedBy.agent ?? "Agent" }}，{{ HERDR_STATUS_LABEL[job.replacedBy.status] ?? job.replacedBy.status }}）</dd>
                <dt style="color: var(--text-muted)">要发的</dt>
                <dd><pre class="whitespace-pre-wrap break-all rounded-[var(--radius-control)] p-2" style="background: var(--bg-hover); font-size: var(--text-2xs)">{{ job.manualMessage }}</pre></dd>
            </dl>
            <p style="color: var(--text-secondary); font-size: var(--text-xs)">现在的会话没读过这道题。发给它，它会照着读答复并记进 Task；不通知，提问的会话下次读答复时也会看到。</p>
        </div>
        <template #footer>
            <div class="flex justify-end gap-2">
                <Button variant="ghost" :disabled="pending || !job" @click="job && emit('skip', job)">不通知</Button>
                <Button variant="primary" :loading="pending" :disabled="!job?.replacedBy" @click="job?.replacedBy && emit('send', job, {paneId: job.replacedBy.paneId, sessionKey: job.replacedBy.sessionKey})">发给现在的会话</Button>
            </div>
        </template>
    </Dialog>
</template>
