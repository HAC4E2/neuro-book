<script setup lang="ts">
import {computed, onMounted, ref, watch} from "vue";
import {storeToRefs} from "pinia";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {useTextToImageStore} from "nbook/app/stores/text-to-image";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {
    deleteTextToImageTagVocabularySourceEntries,
    parseTextToImageTagVocabularyJson,
    saveTextToImageTagVocabularyEntries,
    searchTextToImageTagVocabulary,
    type StoredTextToImageTagVocabularyEntry,
} from "nbook/app/utils/text-to-image-tag-vocabulary";

type TextToImageTagInsertTarget = {
    value: string;
    label: string;
    description?: string;
    iconClass?: string;
};

const props = withDefaults(defineProps<{
    title?: string;
    targets?: TextToImageTagInsertTarget[];
    selectedTarget?: string;
    compact?: boolean;
}>(), {
    title: "本地 tagData 词库",
    targets: () => [],
    selectedTarget: "",
    compact: false,
});

const emit = defineEmits<{
    (event: "insert", tag: string): void;
    (event: "update:selectedTarget", value: string): void;
}>();

const store = useTextToImageStore();
const notification = useNotification();
const {activeTagVocabularySourceId, tagVocabularySources} = storeToRefs(store);

const fileInputRef = ref<HTMLInputElement | null>(null);
const importing = ref(false);
const searching = ref(false);
const deleting = ref(false);
const searchQuery = ref("");
const searchResults = ref<StoredTextToImageTagVocabularyEntry[]>([]);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const sourceOptions = computed<SelectOption[]>(() => [
    {
        value: "",
        label: "全部词库",
        description: `${tagVocabularySources.value.reduce((sum, source) => sum + source.entryCount, 0)} 条 tag`,
        iconClass: "i-lucide-database",
    },
    ...tagVocabularySources.value.map((source) => ({
        value: source.id,
        label: source.name,
        description: `${source.entryCount} 条 · ${formatImportedAt(source.importedAt)}`,
        iconClass: "i-lucide-file-json",
    })),
]);

const targetOptions = computed<SelectOption[]>(() => props.targets.map((target) => ({
    value: target.value,
    label: target.label,
    description: target.description,
    iconClass: target.iconClass ?? "i-lucide-text-cursor-input",
})));

const selectedTargetValue = computed(() => props.selectedTarget || props.targets[0]?.value || "");
const activeSource = computed(() => tagVocabularySources.value.find((source) => source.id === activeTagVocabularySourceId.value) ?? null);
const sourceFingerprint = computed(() => tagVocabularySources.value.map((source) => `${source.id}:${source.entryCount}`).join("|"));

watch([searchQuery, activeTagVocabularySourceId, sourceFingerprint], () => {
    scheduleSearch();
}, {immediate: true});

watch(() => props.targets.map((target) => target.value).join("|"), () => {
    if (props.targets.length > 0 && !props.targets.some((target) => target.value === props.selectedTarget)) {
        emit("update:selectedTarget", props.targets[0]?.value ?? "");
    }
}, {immediate: true});

onMounted(() => {
    void runSearch();
});

function openImportDialog(): void {
    fileInputRef.value?.click();
}

async function importVocabularyFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (!files.length || importing.value) {
        return;
    }
    importing.value = true;
    let importedFileCount = 0;
    let importedEntryCount = 0;
    try {
        for (const file of files) {
            const text = await file.text();
            const data = JSON.parse(text) as unknown;
            const entries = parseTextToImageTagVocabularyJson(data, file.name);
            if (entries.length === 0) {
                notification.warning(`没有从 ${file.name} 解析到可用 tag`);
                continue;
            }
            const importedAt = new Date().toISOString();
            const source = store.addTagVocabularySource(file.name.replace(/\.[^.]+$/u, ""), entries.length, importedAt);
            try {
                await saveTextToImageTagVocabularyEntries(source, entries);
            } catch (error) {
                store.deleteTagVocabularySource(source.id);
                throw error;
            }
            importedFileCount += 1;
            importedEntryCount += entries.length;
        }
        if (importedFileCount > 0) {
            notification.success(`已导入 ${importedFileCount} 个词库文件，共 ${importedEntryCount} 条 tag`);
            await runSearch();
        }
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "导入 tagData 词库失败"));
    } finally {
        importing.value = false;
    }
}

async function deleteActiveSource(): Promise<void> {
    if (!activeSource.value || deleting.value) {
        return;
    }
    deleting.value = true;
    try {
        const sourceId = activeSource.value.id;
        const sourceName = activeSource.value.name;
        await deleteTextToImageTagVocabularySourceEntries(sourceId);
        store.deleteTagVocabularySource(sourceId);
        notification.success(`已删除词库：${sourceName}`);
        await runSearch();
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "删除 tag 词库失败"));
    } finally {
        deleting.value = false;
    }
}

function selectSource(sourceId: string): void {
    store.activateTagVocabularySource(sourceId);
}

function selectTarget(target: string): void {
    emit("update:selectedTarget", target);
}

function insertTag(entry: StoredTextToImageTagVocabularyEntry): void {
    emit("insert", entry.tag);
}

function scheduleSearch(): void {
    if (searchTimer) {
        clearTimeout(searchTimer);
    }
    searchTimer = setTimeout(() => {
        void runSearch();
    }, 120);
}

async function runSearch(): Promise<void> {
    if (tagVocabularySources.value.length === 0) {
        searchResults.value = [];
        return;
    }
    searching.value = true;
    try {
        searchResults.value = await searchTextToImageTagVocabulary(searchQuery.value, {
            sourceId: activeTagVocabularySourceId.value,
            limit: props.compact ? 24 : 48,
        });
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "搜索本地 tag 词库失败"));
        searchResults.value = [];
    } finally {
        searching.value = false;
    }
}

function formatImportedAt(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleDateString("zh-CN", {month: "2-digit", day: "2-digit"});
}
</script>

<template>
    <div class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0">
                <div class="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-[var(--text-secondary)]">
                    <span class="i-lucide-tags h-4 w-4 text-[var(--accent-main)]"></span>
                    <span class="truncate">{{ title }}</span>
                </div>
                <p class="m-0 mt-0.5 text-[10px] text-[var(--text-muted)]">
                    已安装 {{ tagVocabularySources.length }} 个词库，{{ tagVocabularySources.reduce((sum, source) => sum + source.entryCount, 0) }} 条 tag
                </p>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
                <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2.5 text-[12px] text-[var(--accent-text)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-60" :disabled="importing" @click="openImportDialog">
                    <span class="h-4 w-4" :class="importing ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-upload'"></span>
                    <span>{{ importing ? "导入中" : "导入 JSON" }}</span>
                </button>
                <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2.5 text-[12px] text-[var(--danger-text)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="!activeSource || deleting" @click="deleteActiveSource">
                    <span class="h-4 w-4" :class="deleting ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-trash-2'"></span>
                    <span>删除</span>
                </button>
                <input ref="fileInputRef" type="file" accept=".json,.jsonc,application/json" multiple class="hidden" @change="importVocabularyFiles">
            </div>
        </div>

        <div class="grid gap-2" :class="compact ? '' : 'md:grid-cols-2'">
            <label class="block min-w-0">
                <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">词库来源</span>
                <FormSelect :model-value="activeTagVocabularySourceId" :options="sourceOptions" dropdown-direction="down" @update:model-value="selectSource" />
            </label>
            <label v-if="targetOptions.length > 0" class="block min-w-0">
                <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">插入目标</span>
                <FormSelect :model-value="selectedTargetValue" :options="targetOptions" dropdown-direction="down" @update:model-value="selectTarget" />
            </label>
        </div>

        <label class="block">
            <span class="mb-1 block text-[11px] text-[var(--text-secondary)]">搜索 tag / 中文翻译 / 分类</span>
            <FormInput :model-value="searchQuery" placeholder="例如：blue eyes / 蓝眼 / hair" @update:model-value="searchQuery = $event" />
        </label>

        <div v-if="tagVocabularySources.length === 0" class="rounded-md border border-dashed border-[var(--border-color)] bg-[var(--bg-panel)]/40 px-3 py-4 text-center text-[11px] text-[var(--text-muted)]">
            导入 st-chatu8 的 tagData JSON 或其他 tag JSON 后，就可以在这里搜索并插入到 prompt 配置。
        </div>
        <div v-else-if="searching" class="flex h-24 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/40 text-[11px] text-[var(--text-muted)]">
            <span class="i-lucide-loader-2 mr-1.5 h-3.5 w-3.5 animate-spin"></span>
            搜索中
        </div>
        <div v-else-if="searchResults.length === 0" class="rounded-md border border-dashed border-[var(--border-color)] bg-[var(--bg-panel)]/40 px-3 py-4 text-center text-[11px] text-[var(--text-muted)]">
            没有匹配的 tag。
        </div>
        <div v-else class="custom-scrollbar grid max-h-72 gap-1 overflow-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]/40 p-1">
            <button
                v-for="entry in searchResults"
                :key="entry.id"
                type="button"
                class="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
                @click="insertTag(entry)"
            >
                <span class="min-w-0">
                    <span class="block truncate text-[12px] font-medium text-[var(--accent-text)]">{{ entry.tag }}</span>
                    <span class="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">
                        {{ [entry.translation, entry.category, entry.sourceName].filter(Boolean).join(" · ") || "无翻译" }}
                    </span>
                </span>
                <span class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-[11px] text-[var(--text-secondary)]">
                    <span class="i-lucide-plus h-3.5 w-3.5"></span>
                    <span>插入</span>
                </span>
            </button>
        </div>
    </div>
</template>
