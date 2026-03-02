<script setup lang="ts">
import Dialog from "nbook/app/components/common/Dialog.vue";
import type { AgentThreadSummaryDto } from "nbook/shared/dto/agent-chat.dto";
import { formatTimestamp } from "nbook/app/components/novel-ide/agent/agent-message";

const props = defineProps<{
    modelValue: boolean;
    threads: AgentThreadSummaryDto[];
    activeThreadId: string;
    loading: boolean;
    running: boolean;
    actionId: string | null;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "select", threadId: string): void;
    (e: "create"): void;
    (e: "delete", thread: AgentThreadSummaryDto): void;
}>();

const threadSearch = ref("");

const activeTab = ref<"leader" | "subagent">("leader");

const filteredThreads = computed(() => {
    return props.threads
        .filter(t => t.kind === activeTab.value)
        .filter(t => {
            if (!threadSearch.value) return true;
            return (t.title?.includes(threadSearch.value) || t.summary?.includes(threadSearch.value));
        });
});

const threadTitle = (thread: AgentThreadSummaryDto) => thread.title || thread.id;
const threadPreview = (thread: AgentThreadSummaryDto) => thread.lastMessagePreview || thread.summary || "No recent messages";
const canDeleteThread = (thread: AgentThreadSummaryDto): boolean => thread.status !== "running" && thread.status !== "waiting_user";

const close = () => {
    emit("update:modelValue", false);
};
</script>

<template>
    <Dialog :model-value="props.modelValue" title="对话线程" width="560px" :show-cancel="false" @confirm="emit('create')" @update:model-value="emit('update:modelValue', $event)">
        <template #header>
            <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
                <div class="min-w-0">
                    <div class="text-base font-semibold text-[var(--text-main)] leading-snug tracking-wide">Threads</div>
                    <div class="truncate text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">Select, Create, Delete</div>
                </div>
                <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="close">
                    <span class="i-lucide-x h-4 w-4"></span>
                </button>
            </div>
            <!-- Tabs -->
            <div class="flex items-center gap-4 mt-4 border-b border-[var(--border-color)]">
                <button class="px-2 pb-2 text-sm font-medium border-b-2 transition-colors"
                    :class="activeTab === 'leader' ? 'border-[var(--accent-main)] text-[var(--accent-main)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'"
                    @click="activeTab = 'leader'">
                    Leader
                </button>
                <button class="px-2 pb-2 text-sm font-medium border-b-2 transition-colors"
                    :class="activeTab === 'subagent' ? 'border-[var(--accent-main)] text-[var(--accent-main)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'"
                    @click="activeTab = 'subagent'">
                    Subagents
                </button>
            </div>
        </template>

        <div class="space-y-4 pt-4">
            <div class="flex items-center gap-2">
                <input
                    v-model="threadSearch"
                    type="text"
                    placeholder="Search by title or summary..."
                    class="h-10 flex-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]"
                />
                <button class="inline-flex h-10 items-center justify-center gap-1 rounded-xl bg-[var(--accent-bg)] px-3 text-sm text-[var(--accent-text)] transition-opacity hover:opacity-80 disabled:opacity-40" :disabled="loading || !!actionId" @click="emit('create')">
                    <span class="i-lucide-plus h-4 w-4"></span>
                    New
                </button>
            </div>

            <div class="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                <div
                    v-for="thread in filteredThreads"
                    :key="thread.id"
                    class="flex w-full cursor-pointer items-start justify-between gap-3 rounded-2xl border px-3 py-3 text-left transition-colors"
                    :class="thread.id === activeThreadId ? 'border-[var(--accent-main)] bg-[var(--accent-bg)]/40' : 'border-[var(--border-color)] bg-[var(--bg-sidebar)] hover:bg-[var(--bg-hover)]'"
                    @click="emit('select', thread.id)"
                >
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                            <span class="truncate text-sm font-medium text-[var(--text-main)]">{{ threadTitle(thread) }}</span>
                            <span v-if="thread.id === activeThreadId" class="rounded border border-[var(--accent-main)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-[var(--accent-text)]">Active</span>
                            <span v-if="thread.kind === 'subagent'" class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] font-mono">{{ thread.profileKey }}</span>
                        </div>
                        <div class="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--text-secondary)]">{{ threadPreview(thread) }}</div>
                        <div class="mt-2 text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">
                            <span class="font-mono">{{ thread.id.slice(0, 8) }}</span> • {{ formatTimestamp(thread.lastMessageAt) }}
                        </div>
                    </div>
                    <button class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40" :disabled="actionId === thread.id || loading || !canDeleteThread(thread)" title="Delete" @click.stop="emit('delete', thread)">
                        <span v-if="actionId === thread.id" class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                        <span v-else class="i-lucide-trash-2 h-4 w-4"></span>
                    </button>
                </div>

                <div v-if="filteredThreads.length === 0" class="rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-sidebar)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
                    No matching threads
                </div>
            </div>
        </div>

        <template #footer>
            <div class="flex w-full items-center justify-end">
                <button class="inline-flex items-center justify-center h-8 px-4 rounded-md text-[13px] font-medium cursor-pointer border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-main)] transition-colors duration-200 hover:bg-[var(--bg-hover)] active:scale-95" @click="close">Close</button>
            </div>
        </template>
    </Dialog>
</template>
