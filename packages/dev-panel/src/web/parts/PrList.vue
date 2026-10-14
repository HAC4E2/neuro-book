<script setup lang="ts">
import {Badge} from "@notnotype/nb-ui/components";
import {relativeTime} from "../host/format.js";
import {isPlainClick, taskHref} from "../host/routes.js";
import type {CheckSummary, PrView} from "../host/types.js";

/** 开着的 PR（GitHub 只读）；契约见同名 .md。标题与分支是外部内容，一律按纯文本渲染。 */
defineProps<{prs: PrView[]}>();
const emit = defineEmits<{navigate: [href: string]}>();
const checkLabel = (check: CheckSummary["failed"][number]) => (check.workflow ? `${check.workflow} / ${check.name}` : check.name);
function follow(event: MouseEvent, href: string): void {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    emit("navigate", href);
}
const REVIEW: Record<string, string> = {APPROVED: "已批准", CHANGES_REQUESTED: "要求修改", REVIEW_REQUIRED: "待评审"};
</script>

<template>
    <p class="nbdev-empty" v-if="prs.length === 0">没有开着的 PR</p>
    <ul v-else class="flex flex-col gap-2">
        <li v-for="pr in prs" :key="pr.number" class="flex flex-col gap-1 border-b pb-2 last:border-b-0 nbdev-divider">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
                <a v-if="pr.url" :href="pr.url" target="_blank" rel="noopener noreferrer" class="font-medium">#{{ pr.number }}</a>
                <span v-else class="font-medium">#{{ pr.number }}</span>
                <span class="min-w-0 break-all">{{ pr.title }}</span>
                <Badge v-if="pr.draft" tone="neutral" variant="soft" size="sm">草稿</Badge>
                <Badge v-if="pr.reviewDecision" :tone="pr.reviewDecision === 'APPROVED' ? 'success' : 'warning'" variant="soft" size="sm">{{ REVIEW[pr.reviewDecision] ?? pr.reviewDecision }}</Badge>
            </div>
            <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 nbdev-note">
                <code class="break-all">{{ pr.branch }}</code>
                <a v-if="pr.task" :href="taskHref(pr.task.workId, pr.task.taskId)" @click="follow($event, taskHref(pr.task.workId, pr.task.taskId))">{{ pr.task.workId.slice(0, 6) }}/{{ pr.task.taskId.slice(0, pr.task.taskId.indexOf("-")) }}</a>
                <span>· {{ relativeTime(pr.updatedAt) }}更新</span>
                <span>· 检查：<span class="nbdev-ok">{{ pr.checks.success }} 过</span><template v-if="pr.checks.failure > 0">，<span class="nbdev-danger">{{ pr.checks.failure }} 失败</span></template><template v-if="pr.checks.pending > 0">，{{ pr.checks.pending }} 进行中</template></span>
            </div>
            <ul v-if="pr.checks.failed.length > 0" class="flex flex-wrap gap-x-3 nbdev-small">
                <li v-for="(check, index) in pr.checks.failed" :key="index">
                    <span class="i-lucide-x size-3 align-middle nbdev-danger" aria-hidden="true" />
                    <a v-if="check.url" :href="check.url" target="_blank" rel="noopener noreferrer">{{ checkLabel(check) }}</a>
                    <span v-else>{{ checkLabel(check) }}</span>
                </li>
            </ul>
        </li>
    </ul>
</template>
