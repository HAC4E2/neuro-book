<script setup lang="ts">
/** 作品信息对话框（同名 .md）：新建与编辑信息共用；只收集与校验输入，提交的结果与服务端的失败原因由宿主给。 */
import {Button, ColorPicker, Dialog, FormField, FormInput, FormTextarea} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import {PROJECT_COLOR_PATTERN, PROJECT_DESCRIPTION_MAX_LENGTH, PROJECT_TITLE_MAX_LENGTH} from "../../shared/contracts";
import {projectDirectoryName} from "../../shared/directory-name";

// 根节点是 Dialog 的 Teleport，外部 attrs 没有落点，不透传（否则 Vue 会警告）。
defineOptions({name: "ProjectInfoDialog", inheritAttrs: false});

export interface ProjectInfoFormValues {
    title: string;
    description: string;
    color: string | null;
}

const props = withDefaults(defineProps<{
    locale: DisplayLocale;
    open: boolean;
    mode: "create" | "edit";
    /** 打开时的初值；每次打开重新取。 */
    initial?: ProjectInfoFormValues;
    /** 提交中：禁止再次提交与关闭。 */
    busy?: boolean;
    /** 宿主给的失败原因（服务端拒绝），已按当前语言写好。 */
    error?: string;
    /** 新建时作品会建在哪个目录下（作品目录）；null 表示还没设。只在 `mode` 为 create 时显示。 */
    library?: string | null;
}>(), {initial: () => ({title: "", description: "", color: null}), busy: false, error: "", library: null});

const emit = defineEmits<{
    (event: "submit", values: ProjectInfoFormValues): void;
    (event: "cancel"): void;
    /** 用户要换一个作品目录（宿主开路径输入）。 */
    (event: "change-location"): void;
}>();

const TEXT = {
    createTitle: {"zh-CN": "新建作品", "en-US": "New Book"},
    editTitle: {"zh-CN": "编辑作品信息", "en-US": "Edit Book Info"},
    title: {"zh-CN": "书名", "en-US": "Title"},
    description: {"zh-CN": "简介", "en-US": "Description"},
    descriptionHint: {"zh-CN": "一两句话，显示在书架的扉页与列表里", "en-US": "A sentence or two, shown on the shelf"},
    color: {"zh-CN": "主题色", "en-US": "Color"},
    colorHint: {"zh-CN": "书脊的颜色；不指定时按作品取一档", "en-US": "The spine color; a hue is picked for the book when unset"},
    clearColor: {"zh-CN": "不指定", "en-US": "Unset"},
    setColor: {"zh-CN": "指定主题色…", "en-US": "Pick a color…"},
    location: {"zh-CN": "位置", "en-US": "Location"},
    locationHint: {"zh-CN": "作品是一个文件夹，建在作品目录下，文件夹名由书名生成", "en-US": "A book is a folder created inside the library folder, named after the title"},
    locationUnset: {"zh-CN": "还没有作品目录，新建前先选一个", "en-US": "No library folder yet; choose one before creating"},
    locationTitle: {"zh-CN": "书名", "en-US": "title"},
    change: {"zh-CN": "更改…", "en-US": "Change…"},
    choose: {"zh-CN": "选择…", "en-US": "Choose…"},
    create: {"zh-CN": "新建", "en-US": "Create"},
    save: {"zh-CN": "保存", "en-US": "Save"},
    cancel: {"zh-CN": "取消", "en-US": "Cancel"},
    titleRequired: {"zh-CN": "书名不能为空", "en-US": "The title is required"},
    titleTooLong: {"zh-CN": "书名至多 {max} 个字符", "en-US": "The title can have at most {max} characters"},
    descriptionTooLong: {"zh-CN": "简介至多 {max} 个字符", "en-US": "The description can have at most {max} characters"},
    colorInvalid: {"zh-CN": "颜色要写成 #rrggbb", "en-US": "The color must be #rrggbb"},
} satisfies Record<string, LocalizedText>;

const text = (value: LocalizedText): string => localize(value, props.locale);
/** 点“指定主题色”时的起点：取色器自己的回退色，用户接着调。 */
const DEFAULT_PICK = "#3b82f6";

const title = ref("");
const description = ref("");
const color = ref<string | null>(null);
const problems = ref<{title?: string; description?: string; color?: string}>({});

// 每次打开按初值重置：上次的输入与校验结果不带到下一次。
watch(() => props.open, (open) => {
    if (!open) return;
    title.value = props.initial.title;
    description.value = props.initial.description;
    color.value = props.initial.color;
    problems.value = {};
}, {immediate: true});

const dialogTitle = computed(() => text(props.mode === "create" ? TEXT.createTitle : TEXT.editTitle));
const confirmLabel = computed(() => text(props.mode === "create" ? TEXT.create : TEXT.save));
/** 新建时的目标路径预览：书名还没填时用占位的“书名”二字，让人看出文件夹名跟着书名走。 */
const locationPreview = computed(() => {
    if (props.library === null) return null;
    const trimmed = title.value.trim();
    const parent = props.library.replace(/[/\\]+$/u, "");
    return {parent, name: trimmed === "" ? `<${text(TEXT.locationTitle)}>` : projectDirectoryName(trimmed)};
});

function onColor(value: string): void {
    color.value = value.toLowerCase();
}

/** 与服务端相同的规则先在本地校验，省一次往返；服务端仍是最终判定。 */
function validate(): ProjectInfoFormValues | null {
    const trimmedTitle = title.value.trim();
    const next: typeof problems.value = {};
    if (trimmedTitle === "") next.title = text(TEXT.titleRequired);
    else if (trimmedTitle.length > PROJECT_TITLE_MAX_LENGTH) next.title = text(formatText(TEXT.titleTooLong, {max: String(PROJECT_TITLE_MAX_LENGTH)}));
    if (description.value.length > PROJECT_DESCRIPTION_MAX_LENGTH) next.description = text(formatText(TEXT.descriptionTooLong, {max: String(PROJECT_DESCRIPTION_MAX_LENGTH)}));
    if (color.value !== null && !PROJECT_COLOR_PATTERN.test(color.value)) next.color = text(TEXT.colorInvalid);
    problems.value = next;
    if (Object.keys(next).length > 0) return null;
    return {title: trimmedTitle, description: description.value.trim(), color: color.value};
}

function onConfirm(): void {
    if (props.busy) return;
    const values = validate();
    if (values !== null) emit("submit", values);
}
</script>

<template>
    <Dialog
        :model-value="open"
        :title="dialogTitle"
        size="md"
        show-cancel
        :busy="busy"
        :cancel-label="text(TEXT.cancel)"
        :confirm-label="confirmLabel"
        body-class="project-info-dialog__body"
        @confirm="onConfirm"
        @request-close="emit('cancel')"
    >
        <form class="project-info-dialog" data-project-info-dialog @submit.prevent="onConfirm">
            <FormField :label="text(TEXT.title)" required :error="problems.title ?? ''">
                <FormInput v-model="title" :maxlength="PROJECT_TITLE_MAX_LENGTH" autofocus :disabled="busy" data-project-title />
            </FormField>
            <FormField :label="text(TEXT.description)" :description="text(TEXT.descriptionHint)" :error="problems.description ?? ''">
                <FormTextarea v-model="description" :rows="3" :maxlength="PROJECT_DESCRIPTION_MAX_LENGTH" :disabled="busy" data-project-description />
            </FormField>
            <FormField :label="text(TEXT.color)" :description="text(TEXT.colorHint)" :error="problems.color ?? ''">
                <div class="project-info-dialog__color">
                    <!-- 没指定时不画取色器：它总会显示一个回退色，看起来像已经选了。 -->
                    <template v-if="color !== null">
                        <ColorPicker :model-value="color" size="sm" :disabled="busy" @update:model-value="onColor" />
                        <span class="project-info-dialog__swatch-text" data-project-color>{{ color }}</span>
                        <Button variant="ghost" size="sm" :disabled="busy" data-project-clear-color @click="color = null">{{ text(TEXT.clearColor) }}</Button>
                    </template>
                    <Button v-else variant="secondary" size="sm" :disabled="busy" data-project-set-color @click="color = DEFAULT_PICK">{{ text(TEXT.setColor) }}</Button>
                </div>
            </FormField>
            <FormField v-if="mode === 'create'" :label="text(TEXT.location)" :description="text(TEXT.locationHint)">
                <div class="project-info-dialog__location" data-project-location>
                    <span v-if="locationPreview !== null" class="project-info-dialog__path">
                        <span class="project-info-dialog__parent">{{ locationPreview.parent }}/</span><span class="project-info-dialog__folder">{{ locationPreview.name }}</span>
                    </span>
                    <span v-else class="project-info-dialog__unset">{{ text(TEXT.locationUnset) }}</span>
                    <Button variant="ghost" size="sm" :disabled="busy" data-project-change-location @click="emit('change-location')">{{ text(locationPreview === null ? TEXT.choose : TEXT.change) }}</Button>
                </div>
            </FormField>
            <p v-if="error !== ''" class="project-info-dialog__error" role="alert" data-project-info-error>{{ error }}</p>
            <!-- 让回车提交；按钮本身由 Dialog 的页脚提供。 -->
            <button type="submit" hidden tabindex="-1" aria-hidden="true" />
        </form>
    </Dialog>
</template>

<style scoped>
.project-info-dialog {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.project-info-dialog__color {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.project-info-dialog__swatch-text {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
}

.project-info-dialog__error {
    margin: 0;
    color: var(--danger);
    font-size: var(--text-sm);
}

.project-info-dialog__location {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
}

.project-info-dialog__path {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
}

.project-info-dialog__parent {
    color: var(--text-muted);
}

.project-info-dialog__folder {
    color: var(--text-main);
}

.project-info-dialog__unset {
    flex: 1 1 auto;
    color: var(--text-muted);
    font-size: var(--text-sm);
}
</style>
