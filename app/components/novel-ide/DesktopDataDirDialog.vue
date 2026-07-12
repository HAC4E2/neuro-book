<script setup lang="ts">
/**
 * 桌面数据目录设置 Dialog。仅在 NeuroBook 桌面壳内可用。
 * 展示当前 data 目录、输入新路径、调用 change_data_dir 触发重启迁移。
 * 迁移策略：desktop.rs 重启后复制旧数据到新位置，旧目录保留（用户手动清理）。
 */
import {ref, watch} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {useNotification} from "nbook/app/composables/useNotification";
import {useDesktopBridge} from "nbook/app/composables/useDesktopBridge";

const props = defineProps<{
    modelValue: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();

const notification = useNotification();
const {getDataDir, changeDataDir} = useDesktopBridge();

/** 当前生效 data 目录（打开时加载）。null 表示尚未就绪或非桌面环境。 */
const currentDir = ref<string | null>(null);
/** 新路径输入值。 */
const newDir = ref<string>("");
/** 加载当前路径中。 */
const loading = ref<boolean>(false);
/** 提交迁移中（调用 change_data_dir）。 */
const submitting = ref<boolean>(false);

async function loadCurrent(): Promise<void> {
    loading.value = true;
    try {
        currentDir.value = await getDataDir();
        // 默认预填当前路径，方便用户基于其修改
        newDir.value = currentDir.value ?? "";
    } finally {
        loading.value = false;
    }
}

watch(
    () => props.modelValue,
    (open) => {
        if (open) void loadCurrent();
    },
    {immediate: true},
);

/** 应用并重启迁移。 */
async function applyMigration(): Promise<void> {
    const target = newDir.value.trim();
    if (!target) {
        notification.warning("请输入新的数据目录路径");
        return;
    }
    if (currentDir.value && target === currentDir.value) {
        notification.warning("新路径与当前数据目录相同");
        return;
    }
    submitting.value = true;
    try {
        await changeDataDir(target);
        // 调用成功后桌面壳会很快重启，这里给个提示；dialog 无需手动关闭
        notification.success("已提交，即将重启并迁移数据，请稍候…");
        emit("update:modelValue", false);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "提交迁移失败"), {
            title: "数据目录迁移",
        });
    } finally {
        submitting.value = false;
    }
}
</script>

<template>
    <!-- 桌面数据目录设置 -->
    <Dialog
        :model-value="props.modelValue"
        title="数据目录"
        width="640px"
        overlay-type="blur"
        :busy="loading"
        @request-close="emit('update:modelValue', false)"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <div class="space-y-4 px-1 py-2 text-sm text-[var(--text-main)]">
            <!-- 当前路径 -->
            <div class="space-y-1">
                <div class="text-xs font-semibold text-[var(--text-muted)]">当前数据目录</div>
                <div class="rounded-lg border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] bg-opacity-35 px-3 py-2 text-xs break-all text-[var(--text-secondary)]">
                    {{ currentDir || "尚未就绪" }}
                </div>
            </div>

            <!-- 新路径输入 -->
            <div class="space-y-1">
                <div class="text-xs font-semibold text-[var(--text-muted)]">新的数据目录路径</div>
                <input
                    v-model="newDir"
                    type="text"
                    class="w-full rounded-lg border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-main)] outline-none transition focus:border-[var(--accent-main)]"
                    placeholder="例如 D:\NeuroBook\data"
                    spellcheck="false"
                />
                <div class="text-[11px] leading-relaxed text-[var(--text-muted)]">
                    应用后桌面壳将重启并把数据迁移到新位置。目标目录必须为空或不存在；
                    旧目录会保留，迁移完成后可手动清理。
                </div>
            </div>
        </div>

        <!-- 操作按钮 -->
        <template #footer>
            <button
                type="button"
                class="inline-flex h-9 items-center justify-center rounded-lg border border-[var(--border-color)] px-4 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] active:scale-95"
                @click="emit('update:modelValue', false)"
            >
                取消
            </button>
            <button
                type="button"
                class="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent-main)] px-4 text-xs font-medium text-[var(--accent-text)] transition hover:shadow-md active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                :disabled="submitting || loading || !newDir.trim()"
                @click="void applyMigration()"
            >
                <span v-if="submitting" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                <span v-else class="i-lucide-folder-input h-3.5 w-3.5"></span>
                {{ submitting ? "提交中…" : "迁移并重启" }}
            </button>
        </template>
    </Dialog>
</template>
