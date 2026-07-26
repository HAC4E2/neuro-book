<script setup lang="ts">
/**
 * 文生图侧边面板：出图工作流 + 项目级 Storyboard 导入/overlay/角色视觉迁移。
 * Recipe、画风串、Director 绑定与参考资产已迁移至全局设置（NovelIdeTextToImageSettingsPanel）。
 */
import {computed, ref, watch} from "vue";
import {storeToRefs} from "pinia";
import TextToImageCharacterMigrationPanel from "nbook/app/components/novel-ide/text-to-image/TextToImageCharacterMigrationPanel.vue";
import TextToImageIllustrationWorkflowPanel from "nbook/app/components/novel-ide/text-to-image/TextToImageIllustrationWorkflowPanel.vue";
import TextToImageProjectOverlayPanel from "nbook/app/components/novel-ide/text-to-image/TextToImageProjectOverlayPanel.vue";
import TextToImageStoryboardImportPanel from "nbook/app/components/novel-ide/text-to-image/TextToImageStoryboardImportPanel.vue";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useTextToImageStore} from "nbook/app/stores/text-to-image";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import type {IllustrationDirectorModelBindingDto} from "nbook/shared/dto/config.dto";

const emit = defineEmits<{
    (e: "open-illustration-director-settings"): void;
}>();

const store = useTextToImageStore();
const novelIdeStore = useNovelIdeStore();
const configApi = useConfigApi();
const {configRevision, currentNovelId, novels} = storeToRefs(novelIdeStore);
const {currentProjectPath} = storeToRefs(store);

const currentNovel = computed(() => novels.value.find((novel) => novel.id === currentNovelId.value || novel.projectPath === currentNovelId.value) ?? null);
const currentNovelTitle = computed(() => currentNovel.value?.title || currentNovelId.value || "未选择小说");

/** Director binding 只读快照：导入面板据此提示"先配置 Director"；本面板没有任何 Global Config 写入口。 */
const illustrationDirectorBinding = ref<IllustrationDirectorModelBindingDto | null>(null);
/** Storyboard 全局发布后 bump，强制 overlay 面板重读 active base。 */
const projectOverlayRevision = ref(0);

async function loadDirectorBinding(): Promise<void> {
    try {
        const snapshot = await configApi.editorSnapshot(configApi.globalQuery());
        illustrationDirectorBinding.value = snapshot.modelSettings.illustrationDirector;
    } catch {
        illustrationDirectorBinding.value = null;
    }
}
watch(configRevision, () => {
    void loadDirectorBinding();
}, {immediate: true});

function openIllustrationDirectorSettings(): void {
    emit("open-illustration-director-settings");
}

function handleGlobalStoryboardPublished(): void {
    projectOverlayRevision.value += 1;
}

// 切换小说时同步 projectPath 并预加载 Recipe
watch(currentNovelId, (projectPath) => {
    store.setCurrentProjectPath(projectPath);
    if (projectPath) {
        void store.refreshProjectJobs(projectPath).catch(() => undefined);
        void store.loadRecipe(projectPath).catch(() => undefined);
    }
}, {immediate: true});
</script>

<template>
    <!-- 文生图面板 -->
    <div class="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
        <!-- 标题栏 -->
        <div class="shrink-0 border-b border-[var(--border-color)] px-3 py-2">
            <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                    <h2 class="truncate text-[13px] font-semibold text-[var(--text-main)]">文生图</h2>
                    <p class="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">当前小说：{{ currentNovelTitle }}</p>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                    <button
                        type="button"
                        title="历史图片"
                        class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                        :disabled="!currentProjectPath"
                        @click="novelIdeStore.openTextToImageHistoryTab(currentProjectPath)"
                    >
                        <span class="i-lucide-images h-3.5 w-3.5"></span>
                    </button>
                    <span class="i-lucide-image h-5 w-5 text-[var(--accent-main)]"></span>
                </div>
            </div>
        </div>

        <!-- 出图工作流 + 项目级 Storyboard/overlay/角色视觉迁移 -->
        <div class="custom-scrollbar min-h-0 w-full min-w-0 flex-1 overflow-y-scroll px-3 py-3" style="scrollbar-gutter: stable;">
            <TextToImageIllustrationWorkflowPanel :project-path="currentProjectPath" />
            <div v-if="currentNovelId" class="mt-3 space-y-3">
                <!-- 角色视觉迁移：承接角色详情页 Director proposal 的 Tag 解析、逐项接受与 apply -->
                <TextToImageCharacterMigrationPanel :project-path="currentProjectPath" />
                <!-- Storyboard 导入：server inspect + Director Runtime 转换 + 全局发布 -->
                <TextToImageStoryboardImportPanel :project-path="currentProjectPath" :director-configured="illustrationDirectorBinding?.configured === true" @open-director-settings="openIllustrationDirectorSettings" @global-published="handleGlobalStoryboardPublished" />
                <!-- Project overlay：对全局 Storyboard/Pattern 的项目级增量覆盖 -->
                <TextToImageProjectOverlayPanel :key="`${currentProjectPath}:${projectOverlayRevision}`" :project-path="currentProjectPath" />
            </div>
        </div>
    </div>
</template>
