<script setup lang="ts">
/**
 * 小说数据设置面板：本地 novel-api 榜单服务（sibling 仓 ../novel-api）的 baseUrl。
 * 走 editorSnapshot → 修改 novelData → saveGlobal 的标准面板链路（global scope）。
 */
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {ConfigEditorSnapshotDto, ConfigWorkspaceQueryDto, GlobalConfigUpdateDto} from "nbook/shared/dto/config.dto";

/** 展示默认值，与后端 normalizer 的 DEFAULT_NOVEL_DATA 保持一致。 */
const NOVEL_DATA_DEFAULTS = {baseUrl: "http://localhost:3000"};

const props = withDefaults(defineProps<{
    targetQuery?: ConfigWorkspaceQueryDto;
}>(), {
    targetQuery: undefined,
});

const configApi = useConfigApi();
const notification = useNotification();
const {t} = useI18n();

const loading = ref(false);
const saving = ref(false);
const editorSnapshot = ref<ConfigEditorSnapshotDto | null>(null);
const baseUrl = ref(NOVEL_DATA_DEFAULTS.baseUrl);
const snapshotBaseUrl = ref(NOVEL_DATA_DEFAULTS.baseUrl);

const dirty = computed(() => baseUrl.value !== snapshotBaseUrl.value);

/**
 * 从快照读 novelData 当前值；global 里没写过的字段落展示默认值。
 */
function applySettings(snapshot: ConfigEditorSnapshotDto): void {
    editorSnapshot.value = snapshot;
    baseUrl.value = snapshot.global.novelData?.baseUrl ?? NOVEL_DATA_DEFAULTS.baseUrl;
    snapshotBaseUrl.value = baseUrl.value;
}

/**
 * 构造 Global Config 写回体。只覆盖 baseUrl，保留手写的其它 novelData 字段。
 */
function buildGlobalConfigPayload(): GlobalConfigUpdateDto {
    const base = editorSnapshot.value?.global ?? {};
    return {
        novelData: {
            ...(base.novelData ?? {}),
            baseUrl: baseUrl.value.trim(),
        },
    };
}

async function loadSettings(): Promise<void> {
    loading.value = true;
    try {
        applySettings(await configApi.editorSnapshot(props.targetQuery));
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.novelData.loadFailed")));
    } finally {
        loading.value = false;
    }
}

async function restoreSettings(): Promise<void> {
    await loadSettings();
}

async function saveSettings(): Promise<void> {
    if (!dirty.value || saving.value) {
        return;
    }
    saving.value = true;
    try {
        applySettings(await configApi.saveGlobal(buildGlobalConfigPayload(), props.targetQuery));
        notification.success(t("settings.panels.novelData.saveSuccess"));
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.novelData.saveFailed")));
    } finally {
        saving.value = false;
    }
}

watch(() => props.targetQuery, () => {
    void loadSettings();
}, {deep: true});

onMounted(() => {
    void loadSettings();
});

defineExpose({
    dirty,
    loading,
    saving,
    saveSettings,
    restoreSettings,
});
</script>

<template>
    <!-- 小说数据设置面板（novel-api 榜单服务） -->
    <div class="space-y-4 pt-1">
        <div class="max-w-xl">
            <h3 class="text-base font-semibold text-[var(--text-main)]">{{ t("settings.panels.novelData.title") }}</h3>
            <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ t("settings.panels.novelData.description") }}</p>
        </div>

        <div v-if="loading" class="flex min-h-[260px] flex-col items-center justify-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm">
            <span class="i-lucide-loader-2 h-8 w-8 animate-spin text-[var(--text-muted)]"></span>
            <span class="text-sm text-[var(--text-secondary)]">{{ t("common.loading") }}</span>
        </div>

        <div v-else class="grid gap-3">
            <!-- 服务地址 -->
            <label class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                <span class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.panels.novelData.baseUrlTitle") }}</span>
                <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.panels.novelData.baseUrlDescription") }}</span>
                <input type="text" class="mt-3 h-8 w-full max-w-[420px] rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20" :value="baseUrl" placeholder="http://localhost:3000" spellcheck="false" @input="baseUrl = ($event.target as HTMLInputElement).value">
            </label>

            <!-- 服务说明 -->
            <div class="rounded-lg border border-[var(--border-color)] border-opacity-40 bg-[var(--bg-input)] bg-opacity-25 px-3 py-2 text-xs leading-5 text-[var(--text-secondary)]">
                <span class="i-lucide-info mr-1 inline-block h-3.5 w-3.5 align-text-bottom"></span>{{ t("settings.panels.novelData.serviceNote") }}
            </div>
        </div>
    </div>
</template>
