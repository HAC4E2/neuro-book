<script setup lang="ts">
import type { DropdownItem } from "nbook/app/components/common/dropdown.types";
import Dropdown from "nbook/app/components/common/Dropdown.vue";

const props = defineProps<{
    rightPanelOpen: boolean;
    novelTitle: string;
    novelItems: DropdownItem[];
}>();

const emit = defineEmits<{
    (e: "toggle-agent"): void;
    (e: "open-bookshelf"): void;
    (e: "switch-novel", value: string): void;
}>();
</script>

<template>
    <!-- 顶部导航栏 -->
    <header class="ide-panel flex h-12 shrink-0 items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-4 text-[var(--text-main)]">
        <div class="flex items-center gap-4">
            <div class="flex items-center gap-2.5 font-medium">
                <div class="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] shadow-sm">
                    <span class="i-lucide-feather h-3.5 w-3.5 text-[var(--accent-text)]"></span>
                </div>
                <span class="text-[13px] font-bold tracking-[0.3em] uppercase">AI Writer</span>
            </div>
            <div class="h-4 w-px bg-[var(--border-color)]"></div>
            <div class="flex items-center gap-3 text-sm">
                <Dropdown :items="novelItems" menu-class="left-0 top-full mt-2 w-56" @select="(v) => emit('switch-novel', v)">
                    <button class="group flex items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-[var(--bg-hover)]">
                        <span class="font-serif text-[13px] italic text-[var(--text-secondary)] group-hover:text-[var(--text-main)] transition-colors">{{ novelTitle || '未选择小说' }}</span>
                        <span class="i-lucide-chevron-down h-3.5 w-3.5 text-[var(--text-muted)] group-hover:text-[var(--text-main)] transition-colors"></span>
                    </button>
                </Dropdown>
            </div>
        </div>

        <div class="flex items-center gap-2">
            <button class="hidden items-center gap-2 rounded-full border border-transparent px-4 py-1.5 text-[12px] tracking-[0.2em] uppercase text-[var(--text-secondary)] transition-colors hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] md:flex" title="书架管理" @click="emit('open-bookshelf')">
                <span class="i-lucide-library h-4 w-4"></span>
                <span>书架</span>
            </button>
            <button class="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="搜索">
                <span class="i-lucide-search h-4 w-4"></span>
            </button>
            <button class="hidden items-center gap-2 rounded-full border border-transparent px-4 py-1.5 text-[12px] tracking-[0.2em] uppercase text-[var(--text-secondary)] transition-colors hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)] md:flex" title="AI 分析">
                <span class="i-lucide-sparkles h-4 w-4 text-[var(--accent-text)]"></span>
                <span>AI 分析</span>
            </button>
            <button
                class="flex items-center gap-2 rounded-full border px-4 py-1.5 text-[12px] tracking-[0.2em] uppercase transition-colors"
                :class="rightPanelOpen ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-transparent text-[var(--text-secondary)] hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                title="Agent"
                @click="emit('toggle-agent')"
            >
                <span class="i-lucide-bot h-4 w-4"></span>
                <span>Agent</span>
            </button>

            <div class="mx-2 h-4 w-px bg-[var(--border-color)]"></div>

            <button class="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="更多">
                <span class="i-lucide-ellipsis h-4 w-4"></span>
            </button>
        </div>
    </header>
</template>
