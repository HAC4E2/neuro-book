<script setup lang="ts">
import type {AgentSessionAttachmentItemDto} from "nbook/shared/dto/agent-session.dto";
import {agentAttachmentUrl} from "nbook/app/components/novel-ide/agent/agent-attachment";

const props = defineProps<{
    sessionId: number;
    items: AgentSessionAttachmentItemDto[];
    total: number;
    hasMore: boolean;
    loading: boolean;
    search: string;
    insertDisabled: boolean;
}>();

const emit = defineEmits<{
    (e: "update:search", value: string): void;
    (e: "load-more"): void;
    (e: "insert", item: AgentSessionAttachmentItemDto): void;
    (e: "close"): void;
}>();

function imageUrl(item: AgentSessionAttachmentItemDto): string | null {
    return agentAttachmentUrl(props.sessionId, item.locator.entryId, item.locator.contentIndex);
}

function bytesLabel(bytes: number): string {
    if (bytes < 1024) return `${String(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
</script>

<template>
    <!-- Session 全分支附件目录 -->
    <section class="absolute inset-x-2 top-12 z-30 flex max-h-[28rem] flex-col overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-xl">
        <header class="flex items-center gap-2 border-b border-[var(--border-color)] px-3 py-2">
            <span class="i-lucide-paperclip h-4 w-4 text-[var(--accent-text)]"></span>
            <div class="min-w-0 flex-1">
                <div class="text-xs font-medium text-[var(--text-main)]">Session 附件</div>
                <div class="text-[10px] text-[var(--text-muted)]">全部分支共 {{ props.total }} 个唯一附件</div>
            </div>
            <button type="button" class="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="关闭附件面板" @click="emit('close')"><span class="i-lucide-x h-4 w-4"></span></button>
        </header>

        <div class="border-b border-[var(--border-color)] p-2">
            <div class="flex items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2">
                <span class="i-lucide-search h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                <input :value="props.search" class="min-w-0 flex-1 bg-transparent py-1.5 text-xs text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]" placeholder="搜索名称、MIME 或 Attachment ID" @input="emit('update:search', ($event.target as HTMLInputElement).value)" />
            </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-2">
            <div v-if="props.items.length > 0" class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <article v-for="item in props.items" :key="item.attachment.attachmentId" class="min-w-0 overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)]">
                    <div class="aspect-video bg-[var(--bg-panel)]">
                        <img v-if="imageUrl(item)" :src="imageUrl(item) || undefined" :alt="item.attachment.name || 'Session 图片'" class="h-full w-full object-contain" loading="lazy" />
                    </div>
                    <div class="space-y-1 p-2">
                        <div class="truncate text-[11px] font-medium text-[var(--text-main)]" :title="item.attachment.name || item.attachment.attachmentId">{{ item.attachment.name || item.attachment.attachmentId }}</div>
                        <div class="flex items-center justify-between gap-1 text-[9px] text-[var(--text-muted)]">
                            <span class="truncate">{{ item.attachment.mimeType }}</span>
                            <span class="shrink-0">{{ bytesLabel(item.attachment.bytes) }}</span>
                        </div>
                        <button type="button" class="w-full rounded border border-[var(--border-color)] px-2 py-1 text-[10px] text-[var(--accent-text)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="props.insertDisabled" @click="emit('insert', item)">插入 Composer</button>
                    </div>
                </article>
            </div>
            <div v-else-if="!props.loading" class="flex min-h-28 flex-col items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
                <span class="i-lucide-images h-6 w-6"></span>
                <span>{{ props.search ? "没有匹配附件" : "当前 Session 还没有附件" }}</span>
            </div>
            <div v-if="props.loading" class="flex items-center justify-center gap-2 py-4 text-xs text-[var(--text-muted)]"><span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span><span>加载附件中</span></div>
            <button v-else-if="props.hasMore" type="button" class="mt-2 w-full rounded border border-[var(--border-color)] py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="emit('load-more')">加载更多</button>
        </div>
    </section>
</template>
