<script setup lang="ts">
import type {MarkdownStudioEditorHandle} from "nbook/app/composables/useMarkdownStudioController";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "nbook/app/components/novel-ide/agent/trigger-menu";
import TipTapMarkdownEditor from "nbook/app/components/markdown-studio/TipTapMarkdownEditor.vue";
import MarkdownSourceEditor from "nbook/app/components/markdown-studio/MarkdownSourceEditor.vue";
import type {WorkspaceReferenceResolver} from "nbook/app/components/markdown-studio/tiptap/WorkspaceReference";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {countInlineComments, countInlineReferences} from "nbook/app/utils/structured-text";
import type {IdeTheme} from "nbook/app/utils/theme/theme-tokens";
import {
    DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
    DEFAULT_MONACO_EDITOR_PREFERENCES,
    type MarkdownEditorPreferences,
    type MonacoEditorPreferences,
} from "nbook/shared/editor-workbench";

type StructuredTextMode = "rich" | "source";
type PopoverDirection = "auto" | "up" | "down";

const props = withDefaults(defineProps<{
    modelValue: string;
    rows?: number;
    placeholder?: string;
    minHeight?: number;
    maxHeight?: number;
    mode?: StructuredTextMode | null;
    defaultMode?: StructuredTextMode;
    showToolbar?: boolean;
    showCounters?: boolean;
    popoverDirection?: PopoverDirection;
    submitOnEnter?: boolean;
    enableQuickTriggers?: boolean;
    menuRefreshKey?: string | number;
    resolveMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onSkillTriggerStart?: () => void;
    readonly?: boolean;
    activePath?: string;
    referenceRefreshKey?: string | number;
    openReference?: (target: string) => void;
    resolveReference?: WorkspaceReferenceResolver;
    editorPreferences?: MarkdownEditorPreferences;
    monacoPreferences?: MonacoEditorPreferences;
    monacoTemporaryFontSize?: number | null;
    theme?: IdeTheme | null;
}>(), {
    rows: 5,
    placeholder: "",
    minHeight: undefined,
    maxHeight: undefined,
    mode: null,
    defaultMode: "rich",
    showToolbar: true,
    showCounters: true,
    popoverDirection: "auto",
    submitOnEnter: false,
    enableQuickTriggers: false,
    menuRefreshKey: "",
    readonly: false,
    activePath: "",
    referenceRefreshKey: "",
    editorPreferences: () => ({...DEFAULT_MARKDOWN_EDITOR_PREFERENCES}),
    monacoPreferences: () => ({...DEFAULT_MONACO_EDITOR_PREFERENCES}),
    monacoTemporaryFontSize: null,
    theme: null,
    resolveMenu: () => ({
        title: "",
        prefix: "",
        sections: [],
    }),
    onSkillTriggerStart: () => {},
    openReference: () => {},
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "update:mode", value: StructuredTextMode): void;
    (e: "submit"): void;
    (e: "shift-tab"): void;
    (e: "focus"): void;
    (e: "blur"): void;
    (e: "save-request"): void;
}>();

const novelIdeStore = useNovelIdeStore();
const richEditorRef = ref<MarkdownStudioEditorHandle | null>(null);
const sourceEditorRef = ref<MarkdownStudioEditorHandle | null>(null);
const currentMode = ref<StructuredTextMode>(props.defaultMode);

const modeButtons: Array<{mode: StructuredTextMode; title: string; iconClass: string}> = [
    {mode: "rich", title: "富文本模式", iconClass: "i-lucide-book-open-text"},
    {mode: "source", title: "源码模式", iconClass: "i-lucide-file-code-2"},
];

const effectiveMode = computed<StructuredTextMode>(() => props.mode ?? currentMode.value);
const isRichMode = computed(() => effectiveMode.value === "rich");
const referenceCount = computed(() => countInlineReferences(props.modelValue));
const commentCount = computed(() => countInlineComments(props.modelValue));
const resolvedMinHeight = computed(() => props.minHeight ?? Math.max(props.rows * 28, 120));
const resolvedMaxHeight = computed(() => props.maxHeight ?? Math.max(props.rows * 48, 180));
const bodyStyle = computed(() => ({
    height: `${resolvedMinHeight.value}px`,
    minHeight: `${resolvedMinHeight.value}px`,
    maxHeight: `${resolvedMaxHeight.value}px`,
}));
const sourceTheme = computed<IdeTheme>(() => props.theme ?? novelIdeStore.theme);

watch(() => props.defaultMode, (nextMode) => {
    if (props.mode === null) {
        currentMode.value = nextMode;
    }
});

watch(() => props.modelValue, (nextValue) => {
    richEditorRef.value?.update(nextValue);
    sourceEditorRef.value?.update(nextValue);
});

/**
 * 切换包装层当前展示的编辑模式。
 */
function setMode(mode: StructuredTextMode): void {
    currentMode.value = mode;
    emit("update:mode", mode);
}

/**
 * 聚焦当前可见编辑器。
 */
function focus(): void {
    if (isRichMode.value) {
        richEditorRef.value?.focus();
        return;
    }
    sourceEditorRef.value?.focus();
}

/**
 * 在当前光标插入 Markdown 文本。
 */
function insertText(text: string): void {
    if (isRichMode.value) {
        richEditorRef.value?.insertMarkdown?.(text);
        return;
    }
    sourceEditorRef.value?.insertMarkdown?.(text);
}

/**
 * 读取当前 Markdown 字符串。
 */
function getMarkdown(): string {
    if (isRichMode.value) {
        return richEditorRef.value?.getValue?.() ?? props.modelValue;
    }
    return sourceEditorRef.value?.getValue?.() ?? props.modelValue;
}

/**
 * 同步子编辑器变更到表单 v-model。
 */
function emitChange(value: string): void {
    emit("update:modelValue", value);
}

defineExpose({
    focus,
    insertText,
    getMarkdown,
});
</script>

<template>
    <!-- Markdown 表单编辑器：工具栏包装层，底层唯一编辑器是 TipTapMarkdownEditor -->
    <div class="structured-text-editor relative overflow-visible rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)]">
        <div
            v-if="props.showToolbar"
            class="flex items-center justify-between gap-3 border-b border-[var(--border-color)] bg-[var(--bg-input)]/40 px-3 py-2"
        >
            <div class="flex items-center gap-2">
                <div class="flex items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-0.5 text-[var(--text-muted)]">
                    <button
                        v-for="button in modeButtons"
                        :key="button.mode"
                        type="button"
                        class="inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors"
                        :class="effectiveMode === button.mode ? 'bg-[var(--bg-hover)] text-[var(--text-main)]' : 'hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                        :title="button.title"
                        @click="setMode(button.mode)"
                    >
                        <span class="h-3.5 w-3.5" :class="button.iconClass"></span>
                    </button>
                </div>
            </div>
            <div
                v-if="props.showCounters"
                class="flex items-center gap-2 text-[10px] text-[var(--text-muted)]"
            >
                <span>引用 {{ referenceCount }}</span>
                <span>评论 {{ commentCount }}</span>
            </div>
        </div>

        <div class="structured-text-editor__body min-h-0 overflow-hidden" :style="bodyStyle">
            <TipTapMarkdownEditor
                v-if="isRichMode"
                ref="richEditorRef"
                :initial-value="props.modelValue"
                :visible="isRichMode"
                :readonly="props.readonly"
                :editor-preferences="props.editorPreferences"
                :placeholder="props.placeholder"
                :active-path="props.activePath"
                :reference-refresh-key="props.referenceRefreshKey ?? props.menuRefreshKey"
                :resolve-menu="props.resolveMenu"
                :open-reference="props.openReference"
                :resolve-reference="props.resolveReference"
                :show-frontmatter-panel="false"
                :submit-on-enter="props.submitOnEnter"
                :enable-quick-triggers="props.enableQuickTriggers"
                :on-skill-trigger-start="props.onSkillTriggerStart"
                :popover-direction="props.popoverDirection"
                @change="emitChange"
                @focus="emit('focus')"
                @blur="emit('blur')"
                @submit="emit('submit')"
                @shift-tab="emit('shift-tab')"
                @save-request="emit('save-request')"
            />

            <MarkdownSourceEditor
                v-else
                ref="sourceEditorRef"
                :initial-value="props.modelValue"
                :visible="!isRichMode"
                :readonly="props.readonly"
                :placeholder="props.placeholder"
                :theme="sourceTheme"
                :monaco-preferences="props.monacoPreferences"
                :temporary-font-size="props.monacoTemporaryFontSize"
                :submit-on-enter="props.submitOnEnter"
                @change="emitChange"
                @focus="emit('focus')"
                @blur="emit('blur')"
                @submit="emit('submit')"
                @shift-tab="emit('shift-tab')"
                @save-request="emit('save-request')"
            />
        </div>
    </div>
</template>

<style scoped>
.structured-text-editor__body {
    background: var(--bg-panel);
}

:deep(.tiptap-markdown-wrapper) {
    height: 100%;
    min-height: 100%;
    background: var(--bg-panel);
}

:deep(.tiptap-markdown-content) {
    min-height: 100%;
}

:deep(.nb-markdown-editor) {
    max-width: none;
    min-height: 100%;
    margin: 0;
    padding: 12px;
    color: var(--text-main);
    font-family: inherit;
    font-size: 0.875rem;
    line-height: 1.75rem;
}

:deep(.nb-markdown-editor p) {
    margin: 0 0 0.45rem;
}

:deep(.nb-markdown-editor h1),
:deep(.nb-markdown-editor h2),
:deep(.nb-markdown-editor h3) {
    margin: 0.75em 0 0.35em;
    font-family: inherit;
}

:deep(.markdown-source-shell) {
    height: 100%;
    border: 0;
    background: var(--source-bg);
}
</style>
