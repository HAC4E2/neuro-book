<script lang="ts">
export type WorkspaceFileConflictResolution =
    | {action: "reload-remote"}
    | {action: "overwrite-local"}
    | {action: "save-merged"; content: string}
    | {action: "cancel"};
</script>

<script setup lang="ts">
import Dialog from "nbook/app/components/common/Dialog.vue";
import type {IdeTheme} from "nbook/app/utils/theme/theme-tokens";
import {buildMonacoTheme} from "nbook/app/components/markdown-studio/monaco-theme";
import {loadMonacoEditor, type MonacoEditorApi} from "nbook/app/components/markdown-studio/load-monaco-editor";
import type {WorkspaceWriteConflictDto} from "nbook/shared/dto/workspace-file-conflict.dto";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

const props = withDefaults(defineProps<{
    modelValue: boolean;
    conflict: WorkspaceWriteConflictDto | null;
    theme?: IdeTheme;
}>(), {
    theme: "sepia",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "resolve", value: WorkspaceFileConflictResolution): void;
}>();

const mode = ref<"diff" | "merge">("diff");
const diffRootRef = ref<HTMLDivElement | null>(null);
const mergeRootRef = ref<HTMLDivElement | null>(null);
let monacoApi: MonacoEditorApi | null = null;
let diffEditor: Monaco.editor.IStandaloneDiffEditor | null = null;
let mergeEditor: Monaco.editor.IStandaloneCodeEditor | null = null;
let localModel: Monaco.editor.ITextModel | null = null;
let remoteModel: Monaco.editor.ITextModel | null = null;
let mergeModel: Monaco.editor.ITextModel | null = null;

const dialogTitle = computed(() => props.conflict?.remoteExists === false ? "真实文件已删除" : "文件保存冲突");
const remoteActionLabel = computed(() => props.conflict?.remoteExists === false ? "关闭已删除文件" : "使用真实文件");

/**
 * 关闭对话框。
 */
function closeDialog(): void {
    emit("update:modelValue", false);
}

/**
 * 选择一个解决动作并关闭。
 */
function resolveConflict(value: WorkspaceFileConflictResolution): void {
    emit("resolve", value);
    closeDialog();
}

/**
 * 保存人工合并后的内容。
 */
function saveMergedContent(): void {
    resolveConflict({
        action: "save-merged",
        content: mergeEditor?.getValue() ?? props.conflict?.mergedContent ?? "",
    });
}

/**
 * 读取当前工作区的主题变量。
 */
function readThemeVars(): CSSStyleDeclaration {
    const themeHost = diffRootRef.value?.closest(".novel-ide-theme")
        ?? mergeRootRef.value?.closest(".novel-ide-theme");
    return getComputedStyle(themeHost ?? document.documentElement);
}

/**
 * 注册 Monaco 主题。
 */
function applyTheme(): void {
    if (!monacoApi) {
        return;
    }
    const cssVars = readThemeVars();
    monacoApi.editor.defineTheme(`neuro-book-conflict-${props.theme}`, buildMonacoTheme(props.theme, {
        accent: cssVars.getPropertyValue("--accent-main").trim() || "#3b82f6",
        background: cssVars.getPropertyValue("--source-bg").trim() || "#1f1f1f",
        border: cssVars.getPropertyValue("--border-color").trim() || "#2b3340",
        foreground: cssVars.getPropertyValue("--source-text").trim() || "#f3f4f6",
        hover: cssVars.getPropertyValue("--bg-hover").trim() || "rgba(255,255,255,0.04)",
        muted: cssVars.getPropertyValue("--source-muted").trim() || "#94a3b8",
        selection: cssVars.getPropertyValue("--accent-bg").trim() || "rgba(59,130,246,0.18)",
    }));
    monacoApi.editor.setTheme(`neuro-book-conflict-${props.theme}`);
}

/**
 * 释放 Monaco 模型。
 */
function disposeModels(): void {
    localModel?.dispose();
    remoteModel?.dispose();
    mergeModel?.dispose();
    localModel = null;
    remoteModel = null;
    mergeModel = null;
}

/**
 * 更新 Monaco 模型内容。
 */
function updateModels(): void {
    const conflict = props.conflict;
    if (!monacoApi || !conflict) {
        return;
    }
    disposeModels();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localModel = monacoApi.editor.createModel(conflict.localContent, "markdown", monacoApi.Uri.parse(`file:///conflict/${suffix}/web.md`));
    remoteModel = monacoApi.editor.createModel(conflict.remoteContent, "markdown", monacoApi.Uri.parse(`file:///conflict/${suffix}/disk.md`));
    mergeModel = monacoApi.editor.createModel(conflict.mergedContent, "markdown", monacoApi.Uri.parse(`file:///conflict/${suffix}/merge.md`));
    diffEditor?.setModel({
        original: localModel,
        modified: remoteModel,
    });
    mergeEditor?.setModel(mergeModel);
}

/**
 * 初始化 Monaco diff/editor。
 */
async function ensureEditors(): Promise<void> {
    if (!props.modelValue || !props.conflict || !diffRootRef.value || !mergeRootRef.value) {
        return;
    }
    monacoApi = monacoApi ?? await loadMonacoEditor();
    applyTheme();

    if (!diffEditor) {
        diffEditor = monacoApi.editor.createDiffEditor(diffRootRef.value, {
            automaticLayout: true,
            readOnly: true,
            originalEditable: false,
            renderSideBySide: true,
            minimap: {enabled: false},
            scrollBeyondLastLine: false,
        });
    }
    if (!mergeEditor) {
        mergeEditor = monacoApi.editor.create(mergeRootRef.value, {
            automaticLayout: true,
            minimap: {enabled: false},
            scrollBeyondLastLine: false,
            wordWrap: "on",
            language: "markdown",
        });
    }
    updateModels();
    requestAnimationFrame(() => {
        diffEditor?.layout();
        mergeEditor?.layout();
    });
}

watch(() => props.modelValue, async (visible) => {
    if (!visible) {
        return;
    }
    mode.value = "diff";
    await nextTick();
    await ensureEditors();
});

watch(() => props.conflict, async () => {
    if (!props.modelValue) {
        return;
    }
    await nextTick();
    await ensureEditors();
});

watch(() => props.theme, () => {
    applyTheme();
});

watch(mode, async () => {
    await nextTick();
    requestAnimationFrame(() => {
        diffEditor?.layout();
        mergeEditor?.layout();
    });
});

onBeforeUnmount(() => {
    diffEditor?.dispose();
    mergeEditor?.dispose();
    disposeModels();
    diffEditor = null;
    mergeEditor = null;
    monacoApi = null;
});
</script>

<template>
    <Dialog
        :model-value="modelValue"
        :title="dialogTitle"
        width="92vw"
        height="82vh"
        :closable="false"
        :close-on-overlay="false"
        :close-on-esc="false"
        overlay-type="blur"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <div v-if="conflict" class="conflict-dialog">
            <!-- 冲突摘要与模式切换 -->
            <div class="conflict-dialog__header">
                <div class="min-w-0">
                    <div class="truncate font-mono text-xs text-[var(--text-main)]">{{ conflict.path }}</div>
                    <div class="mt-1 text-xs text-[var(--text-muted)]">网页编辑与真实文件都已变化，需要选择保存结果。</div>
                </div>
                <div class="conflict-dialog__tabs">
                    <button type="button" class="conflict-dialog__tab" :class="mode === 'diff' ? 'is-active' : ''" @click="mode = 'diff'">Diff</button>
                    <button type="button" class="conflict-dialog__tab" :class="mode === 'merge' ? 'is-active' : ''" @click="mode = 'merge'">合并</button>
                </div>
            </div>

            <!-- Diff / Merge 编辑区域 -->
            <div class="conflict-dialog__labels">
                <span>{{ mode === "diff" ? "网页编辑" : "合并结果" }}</span>
                <span v-if="mode === 'diff'">真实文件</span>
            </div>
            <div class="conflict-dialog__editor-shell">
                <div v-show="mode === 'diff'" ref="diffRootRef" class="conflict-dialog__editor"></div>
                <div v-show="mode === 'merge'" ref="mergeRootRef" class="conflict-dialog__editor"></div>
            </div>
        </div>

        <template #footer>
            <button type="button" class="conflict-dialog__button" @click="resolveConflict({action: 'cancel'})">取消</button>
            <button type="button" class="conflict-dialog__button" @click="resolveConflict({action: 'reload-remote'})">{{ remoteActionLabel }}</button>
            <button type="button" class="conflict-dialog__button danger" @click="resolveConflict({action: 'overwrite-local'})">覆盖真实文件</button>
            <button type="button" class="conflict-dialog__button primary" @click="saveMergedContent">保存合并结果</button>
        </template>
    </Dialog>
</template>

<style scoped>
.conflict-dialog {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: 10px;
}

.conflict-dialog__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.conflict-dialog__tabs {
    display: inline-flex;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-input);
}

.conflict-dialog__tab {
    height: 30px;
    border: 0;
    border-right: 1px solid var(--border-color);
    background: transparent;
    padding: 0 12px;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 12px;
}

.conflict-dialog__tab:last-child {
    border-right: 0;
}

.conflict-dialog__tab.is-active {
    background: var(--accent-bg);
    color: var(--accent-main);
}

.conflict-dialog__labels {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    color: var(--text-muted);
    font-size: 12px;
}

.conflict-dialog__editor-shell {
    min-height: 0;
    flex: 1;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--source-bg);
}

.conflict-dialog__editor {
    height: 100%;
    min-height: 360px;
}

.conflict-dialog__button {
    display: inline-flex;
    height: 32px;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-input);
    color: var(--text-main);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    padding: 0 12px;
}

.conflict-dialog__button:hover {
    background: var(--bg-hover);
}

.conflict-dialog__button.primary {
    border-color: transparent;
    background: var(--accent-main);
    color: white;
}

.conflict-dialog__button.danger {
    border-color: rgba(225, 29, 72, 0.28);
    background: rgba(225, 29, 72, 0.1);
    color: rgb(190, 18, 60);
}
</style>
