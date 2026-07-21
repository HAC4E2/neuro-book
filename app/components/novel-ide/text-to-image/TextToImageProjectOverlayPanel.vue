<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {ProjectOverlayEditorSnapshot} from "nbook/shared/text-to-image-project-overlays";

const props = defineProps<{projectPath: string}>();
const notification = useNotification();
const snapshot = ref<ProjectOverlayEditorSnapshot | null>(null);
const storyboardMarkdown = ref("");
const patternMarkdown = ref("");
const loading = ref(false);
const savingKind = ref<"storyboard" | "patterns" | null>(null);
const error = ref("");

const storyboardDirty = computed(() => snapshot.value !== null && storyboardMarkdown.value !== snapshot.value.storyboard.markdown);
const patternsDirty = computed(() => snapshot.value !== null && patternMarkdown.value !== snapshot.value.patterns.markdown);

watch(() => props.projectPath, () => {
    snapshot.value = null;
    storyboardMarkdown.value = "";
    patternMarkdown.value = "";
    error.value = "";
    if (props.projectPath) void loadSnapshot();
}, {immediate: true});

/** 从 Project/Global 真相源读取 active companion 与两份 overlay。 */
async function loadSnapshot(): Promise<void> {
    if (!props.projectPath || loading.value || savingKind.value !== null) return;
    loading.value = true;
    error.value = "";
    try {
        const loaded = await $fetch<ProjectOverlayEditorSnapshot>("/api/text-to-image/project-overlays", {
            query: {projectPath: props.projectPath},
        });
        snapshot.value = loaded;
        storyboardMarkdown.value = loaded.storyboard.markdown;
        patternMarkdown.value = loaded.patterns.markdown;
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, "读取 Project 分镜覆盖失败");
    } finally {
        loading.value = false;
    }
}

/** 保存单份 overlay；另一编辑器未保存的草稿保留在当前组件内。 */
async function saveOverlay(kind: "storyboard" | "patterns", mode: "draft" | "apply"): Promise<void> {
    const current = snapshot.value;
    if (!current || savingKind.value !== null) return;
    const preservedOtherDraft = kind === "storyboard" ? patternMarkdown.value : storyboardMarkdown.value;
    const otherWasDirty = kind === "storyboard" ? patternsDirty.value : storyboardDirty.value;
    savingKind.value = kind;
    error.value = "";
    try {
        const updated = await $fetch<ProjectOverlayEditorSnapshot>("/api/text-to-image/project-overlays", {
            method: "PATCH",
            body: {
                projectPath: props.projectPath,
                presetId: current.base.presetId,
                kind,
                markdown: kind === "storyboard" ? storyboardMarkdown.value : patternMarkdown.value,
                expectedFileHash: kind === "storyboard" ? current.storyboard.fileHash : current.patterns.fileHash,
                mode,
            },
        });
        snapshot.value = updated;
        if (kind === "storyboard") {
            storyboardMarkdown.value = updated.storyboard.markdown;
            patternMarkdown.value = otherWasDirty ? preservedOtherDraft : updated.patterns.markdown;
        } else {
            patternMarkdown.value = updated.patterns.markdown;
            storyboardMarkdown.value = otherWasDirty ? preservedOtherDraft : updated.storyboard.markdown;
        }
        notification.success(mode === "apply" ? "Project overlay 已校验并应用" : "Project overlay 草稿已保存");
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, mode === "apply" ? "应用 Project overlay 失败" : "保存 Project overlay 草稿失败");
    } finally {
        savingKind.value = null;
    }
}

/** 把 review/effective 状态映射为现有主题状态色。 */
function stateClass(state: string): string {
    if (state === "approved" || state === "applied") {
        return "border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]";
    }
    if (state === "rejected" || state === "rejected_conflict") {
        return "border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]";
    }
    return "border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]";
}

/** 缩短只读 hash；完整值仍保留在 API DTO。 */
function shortHash(value: string): string {
    return value.length <= 24 ? value : `${value.slice(0, 17)}…${value.slice(-6)}`;
}
</script>

<template>
    <section class="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-sm">
        <!-- Project overlay 标题与刷新入口 -->
        <div class="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-color)] px-4 py-3">
            <div>
                <h3 class="m-0 text-sm font-semibold text-[var(--text-main)]">Project 分镜 / Pattern 增量覆盖</h3>
                <p class="m-0 mt-1 text-[11px] text-[var(--text-muted)]">按稳定 ruleId / patternId 修改当前全局 companion；不复制 Provider、Recipe 或图片生成参数。</p>
            </div>
            <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="loading || savingKind !== null || !projectPath" @click="void loadSnapshot()"><span class="i-lucide-refresh-cw h-3.5 w-3.5" :class="{'animate-spin': loading}"></span>刷新</button>
        </div>

        <div class="space-y-3 px-4 py-3">
            <div v-if="error" class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[11px] text-[var(--status-danger)]">{{ error }}</div>
            <div v-if="snapshot" class="grid gap-2 text-[10px] text-[var(--text-secondary)] sm:grid-cols-3">
                <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2"><div class="text-[var(--text-muted)]">Active companion</div><div class="mt-1 font-medium text-[var(--text-main)]">{{ snapshot.base.presetId }}</div><code class="break-all">{{ snapshot.base.resourceKey }}</code></div>
                <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2"><div class="text-[var(--text-muted)]">Storyboard base</div><code>{{ shortHash(snapshot.base.storyboardSemanticHash) }}</code><div class="mt-1 break-all">{{ snapshot.base.presetPath }}</div></div>
                <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2"><div class="text-[var(--text-muted)]">Pattern base</div><code class="block">P {{ shortHash(snapshot.base.patternPlanningHash) }}</code><code class="block">R {{ shortHash(snapshot.base.patternRenderHash) }}</code></div>
            </div>

            <!-- 两类 overlay 独立 CAS 编辑器 -->
            <div v-if="snapshot" class="grid gap-3 xl:grid-cols-2">
                <div class="space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
                    <div class="flex flex-wrap items-center justify-between gap-2"><div><div class="text-[11px] font-semibold text-[var(--text-main)]">Storyboard overlay</div><code class="text-[10px] text-[var(--text-muted)]">{{ snapshot.storyboard.path }}</code></div><div class="flex gap-1"><span class="rounded-full border px-2 py-0.5 text-[10px]" :class="stateClass(snapshot.storyboard.reviewState)">{{ snapshot.storyboard.reviewState }}</span><span class="rounded-full border px-2 py-0.5 text-[10px]" :class="stateClass(snapshot.storyboard.effectiveStatus)">{{ snapshot.storyboard.effectiveStatus }}</span></div></div>
                    <textarea v-model="storyboardMarkdown" class="custom-scrollbar h-80 w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3 font-mono text-[10px] leading-5 text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" spellcheck="false"></textarea>
                    <div class="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--text-muted)]"><span>{{ snapshot.storyboard.operationCount }} operations · effective {{ shortHash(snapshot.storyboard.effectivePresetHash) }}</span><span v-if="storyboardDirty" class="text-[var(--status-warning)]">未保存</span></div>
                    <div v-for="diagnostic in snapshot.storyboard.diagnostics" :key="`${diagnostic.code}:${diagnostic.message}`" class="rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2.5 py-2 text-[10px] text-[var(--status-warning)]"><strong>{{ diagnostic.code }}</strong>：{{ diagnostic.message }}</div>
                    <div class="flex justify-end gap-2"><button type="button" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-[11px] text-[var(--text-secondary)] disabled:opacity-50" :disabled="savingKind !== null" @click="void saveOverlay('storyboard', 'draft')">保存草稿</button><button type="button" class="h-8 rounded-md bg-[var(--accent-main)] px-3 text-[11px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="savingKind !== null" @click="void saveOverlay('storyboard', 'apply')">保存并应用</button></div>
                </div>

                <div class="space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
                    <div class="flex flex-wrap items-center justify-between gap-2"><div><div class="text-[11px] font-semibold text-[var(--text-main)]">Tag Pattern overlay</div><code class="text-[10px] text-[var(--text-muted)]">{{ snapshot.patterns.path }}</code></div><div class="flex gap-1"><span class="rounded-full border px-2 py-0.5 text-[10px]" :class="stateClass(snapshot.patterns.reviewState)">{{ snapshot.patterns.reviewState }}</span><span class="rounded-full border px-2 py-0.5 text-[10px]" :class="stateClass(snapshot.patterns.effectiveStatus)">{{ snapshot.patterns.effectiveStatus }}</span></div></div>
                    <textarea v-model="patternMarkdown" class="custom-scrollbar h-80 w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3 font-mono text-[10px] leading-5 text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" spellcheck="false"></textarea>
                    <div class="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--text-muted)]"><span>{{ snapshot.patterns.operationCount }} operations · P {{ shortHash(snapshot.patterns.effectivePlanningHash) }} · R {{ shortHash(snapshot.patterns.effectiveRenderHash) }}</span><span v-if="patternsDirty" class="text-[var(--status-warning)]">未保存</span></div>
                    <div v-for="diagnostic in snapshot.patterns.diagnostics" :key="`${diagnostic.code}:${diagnostic.message}`" class="rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2.5 py-2 text-[10px] text-[var(--status-warning)]"><strong>{{ diagnostic.code }}</strong>：{{ diagnostic.message }}</div>
                    <div class="flex justify-end gap-2"><button type="button" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-[11px] text-[var(--text-secondary)] disabled:opacity-50" :disabled="savingKind !== null" @click="void saveOverlay('patterns', 'draft')">保存草稿</button><button type="button" class="h-8 rounded-md bg-[var(--accent-main)] px-3 text-[11px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="savingKind !== null" @click="void saveOverlay('patterns', 'apply')">保存并应用</button></div>
                </div>
            </div>
            <div v-else-if="loading" class="py-8 text-center text-[11px] text-[var(--text-muted)]">正在读取 active companion 与 Project overlays…</div>
        </div>
    </section>
</template>
