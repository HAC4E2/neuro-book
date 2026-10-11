<script setup lang="ts">
/**
 * 作品信息窗口（同名 .md）：新建作品与编辑信息共用的 `DialogWindow`。只收集与校验输入；提交交给宿主，服务端针对某个字段的
 * 拒绝由宿主经 `fieldErrors` 放回那个字段下，别的失败走通知。
 *
 * 主题色与保存位置两个字段不用 `FormField`：它的根是 `<label>`，点到标签里的空白会把点击转给第一个可标记的控件，色板里那就是
 * “自动”那一格；这两个字段自己画标签行。
 */
import {Button, ColorSwatches, DialogWindow, FormField, FormInput, FormTextarea, InfoTip} from "@notnotype/nb-ui/components";
import {computed, ref, useId, watch} from "vue";

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import {PROJECT_COLOR_PATTERN, PROJECT_DESCRIPTION_MAX_LENGTH, PROJECT_TITLE_MAX_LENGTH} from "../../shared/contracts";
import {PROJECT_COVER_MAX_BYTES} from "../../shared/cover";
import {projectDirectoryName} from "../../shared/directory-name";
import type {ProjectCoverChange, ProjectInfoField, ProjectInfoValues} from "../shelf-page";
import {autoBookColor, BOOK_PALETTE} from "../shelf-format";
import BookCover from "./BookCover.vue";

defineOptions({name: "ProjectInfoWindow", inheritAttrs: false});

export interface ProjectInfoSubmit extends ProjectInfoValues {
    /** 新建时作品放在哪个目录下；编辑时为 null。 */
    parent: string | null;
    cover: ProjectCoverChange;
}

const props = withDefaults(defineProps<{
    locale: DisplayLocale;
    open: boolean;
    mode: "create" | "edit";
    /** 打开时的初值；每次打开重新取。 */
    initial?: ProjectInfoValues & {readonly coverSrc?: string | null; readonly id?: string};
    busy?: boolean;
    /** 新建时作品放在哪（受控，`update:location`）；编辑时不用。 */
    location?: string;
    /** 服务端针对某个字段的拒绝，已按当前语言写好。 */
    fieldErrors?: Partial<Record<ProjectInfoField, string>>;
}>(), {initial: () => ({title: "", description: "", color: null, coverSrc: null}), busy: false, location: "", fieldErrors: () => ({})});

const emit = defineEmits<{
    (event: "submit", values: ProjectInfoSubmit): void;
    (event: "cancel"): void;
    (event: "update:location", path: string): void;
    /** 用户要用目录选择器换位置。 */
    (event: "browse-location"): void;
}>();

const TEXT = {
    createTitle: {"zh-CN": "新建作品", "en-US": "New Book"},
    editTitle: {"zh-CN": "编辑作品信息", "en-US": "Edit Book Info"},
    title: {"zh-CN": "书名", "en-US": "Title"},
    description: {"zh-CN": "简介", "en-US": "Description"},
    descriptionPlaceholder: {"zh-CN": "一两句话，显示在卡片与列表里", "en-US": "A sentence or two, shown on the shelf"},
    color: {"zh-CN": "主题色", "en-US": "Color"},
    colorHint: {"zh-CN": "没有封面时用它排一张封面；有封面时用于列表里的小标记。", "en-US": "Used for the typeset cover when there is no image, and as the color mark in lists."},
    auto: {"zh-CN": "自动", "en-US": "Auto"},
    custom: {"zh-CN": "自定义", "en-US": "Custom"},
    location: {"zh-CN": "保存位置", "en-US": "Save to"},
    locationHint: {"zh-CN": "作品是一个文件夹，建在这个目录下，文件夹名由书名生成；目录不存在会一并创建。", "en-US": "A book is a folder created inside this directory and named after the title; the directory is created if missing."},
    browse: {"zh-CN": "浏览…", "en-US": "Browse…"},
    uploadCover: {"zh-CN": "上传封面…", "en-US": "Upload cover…"},
    replaceCover: {"zh-CN": "换封面…", "en-US": "Replace cover…"},
    removeCover: {"zh-CN": "移除封面", "en-US": "Remove cover"},
    coverHint: {"zh-CN": "PNG、JPEG 或 WebP，至多 5 MB；没有封面时用书名和主题色排一张，以后随时能换。", "en-US": "PNG, JPEG or WebP up to 5 MB; without one, a cover is typeset from the title and color."},
    coverTooLarge: {"zh-CN": "封面至多 5 MB", "en-US": "The cover must be at most 5 MB"},
    coverType: {"zh-CN": "只收 PNG、JPEG 或 WebP", "en-US": "Only PNG, JPEG or WebP"},
    create: {"zh-CN": "新建", "en-US": "Create"},
    save: {"zh-CN": "保存", "en-US": "Save"},
    cancel: {"zh-CN": "取消", "en-US": "Cancel"},
    titleRequired: {"zh-CN": "书名不能为空", "en-US": "The title is required"},
    titleTooLong: {"zh-CN": "书名至多 {max} 个字符", "en-US": "The title can have at most {max} characters"},
    descriptionTooLong: {"zh-CN": "简介至多 {max} 个字符", "en-US": "The description can have at most {max} characters"},
    colorInvalid: {"zh-CN": "颜色要写成 #rrggbb", "en-US": "The color must be #rrggbb"},
    locationRequired: {"zh-CN": "填一个目录，或点“浏览…”选一个", "en-US": "Type a directory or choose one with Browse…"},
    coverInfo: {"zh-CN": "封面说明", "en-US": "About covers"},
    colorInfo: {"zh-CN": "主题色说明", "en-US": "About the color"},
    locationInfo: {"zh-CN": "保存位置说明", "en-US": "About the location"},
} satisfies Record<string, LocalizedText>;

/** 色板就是作品色板的八色，“自动”也从这八色里取（见 shelf-format.ts）。 */
const SWATCHES = BOOK_PALETTE;
const COVER_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const text = (value: LocalizedText): string => localize(value, props.locale);
const length = (value: string): number => Array.from(value).length;

const uid = useId();
const title = ref("");
const description = ref("");
const color = ref<string | null>(null);
const coverChange = ref<ProjectCoverChange>({kind: "keep"});
const coverPreview = ref<string | null>(null);
const coverProblem = ref("");
const problems = ref<Partial<Record<ProjectInfoField | "color", string>>>({});
const fileInput = ref<HTMLInputElement | null>(null);

// 每次打开按初值重置：上次的输入与校验结果不带到下一次。
watch(() => props.open, (open) => {
    if (!open) return;
    title.value = props.initial.title;
    description.value = props.initial.description;
    color.value = props.initial.color;
    coverChange.value = {kind: "keep"};
    revokePreview();
    coverProblem.value = "";
    problems.value = {};
}, {immediate: true});

function revokePreview(): void {
    if (coverPreview.value !== null) URL.revokeObjectURL(coverPreview.value);
    coverPreview.value = null;
}

const windowTitle = computed(() => text(props.mode === "create" ? TEXT.createTitle : TEXT.editTitle));
const confirmLabel = computed(() => text(props.mode === "create" ? TEXT.create : TEXT.save));
const previewTitle = computed(() => (title.value.trim() === "" ? text(TEXT.title) : title.value.trim()));
const coverSrc = computed(() => (coverChange.value.kind === "remove" ? null : coverPreview.value ?? props.initial.coverSrc ?? null));
const hasCover = computed(() => coverSrc.value !== null);
/** 由书名生成的文件夹名，作路径框的后缀实时变化。 */
const folderName = computed(() => (title.value.trim() === "" ? "" : projectDirectoryName(title.value.trim())));
const locationValue = computed(() => props.location.replace(/[/\\]+$/u, ""));
/** 计数只在接近上限时出现，表单平时保持干净。 */
const titleCount = computed(() => (length(title.value) >= PROJECT_TITLE_MAX_LENGTH * 0.8 ? `${String(length(title.value))} / ${String(PROJECT_TITLE_MAX_LENGTH)}` : ""));
const descriptionCount = computed(() => (length(description.value) >= PROJECT_DESCRIPTION_MAX_LENGTH * 0.8 ? `${String(length(description.value))} / ${String(PROJECT_DESCRIPTION_MAX_LENGTH)}` : ""));
const errorOf = (field: ProjectInfoField): string => props.fieldErrors[field] ?? problems.value[field] ?? "";
/** “自动”色块画的就是封面现在用的那个自动色。 */
const autoColor = computed(() => autoBookColor(props.initial.id ?? "new"));

function chooseCover(): void {
    fileInput.value?.click();
}

function onCoverFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file === undefined) return;
    if (!COVER_TYPES.has(file.type)) {
        coverProblem.value = text(TEXT.coverType);
        return;
    }
    if (file.size > PROJECT_COVER_MAX_BYTES) {
        coverProblem.value = text(TEXT.coverTooLarge);
        return;
    }
    coverProblem.value = "";
    revokePreview();
    coverPreview.value = URL.createObjectURL(file);
    coverChange.value = {kind: "set", file};
}

function removeCover(): void {
    revokePreview();
    coverProblem.value = "";
    coverChange.value = {kind: "remove"};
}

/** 与服务端相同的规则先在本地校验，省一次往返；服务端仍是最终判定。 */
function validate(): ProjectInfoSubmit | null {
    const trimmedTitle = title.value.trim();
    const next: typeof problems.value = {};
    if (trimmedTitle === "") next.title = text(TEXT.titleRequired);
    else if (length(trimmedTitle) > PROJECT_TITLE_MAX_LENGTH) next.title = text(formatText(TEXT.titleTooLong, {max: String(PROJECT_TITLE_MAX_LENGTH)}));
    if (length(description.value) > PROJECT_DESCRIPTION_MAX_LENGTH) next.description = text(formatText(TEXT.descriptionTooLong, {max: String(PROJECT_DESCRIPTION_MAX_LENGTH)}));
    if (color.value !== null && !PROJECT_COLOR_PATTERN.test(color.value)) next.color = text(TEXT.colorInvalid);
    if (props.mode === "create" && locationValue.value.trim() === "") next.location = text(TEXT.locationRequired);
    problems.value = next;
    if (Object.keys(next).length > 0) return null;
    return {title: trimmedTitle, description: description.value.trim(), color: color.value, parent: props.mode === "create" ? locationValue.value : null, cover: coverChange.value};
}

function onConfirm(): void {
    if (props.busy) return;
    const values = validate();
    if (values !== null) emit("submit", values);
}
</script>

<template>
    <DialogWindow
        :model-value="open"
        :title="windowTitle"
        :width="700"
        height="auto"
        :busy="busy"
        body-class="project-info__body"
        @request-close="emit('cancel')"
        @update:model-value="(value: boolean) => { if (!value) emit('cancel'); }"
    >
        <form class="project-info" data-project-info @submit.prevent="onConfirm">
            <div class="project-info__side">
                <div class="project-info__cover">
                    <BookCover :id="initial.id ?? 'new'" :title="previewTitle" :color="color" :src="coverSrc" :width="150" />
                    <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden data-project-cover-input @change="onCoverFile">
                    <div class="project-info__cover-actions">
                        <Button variant="ghost" size="sm" :disabled="busy" data-project-cover-pick @click="chooseCover">{{ text(hasCover ? TEXT.replaceCover : TEXT.uploadCover) }}</Button>
                        <InfoTip :text="text(TEXT.coverHint)" :label="text(TEXT.coverInfo)" placement="bottom" />
                    </div>
                    <Button v-if="hasCover" variant="ghost" size="sm" :disabled="busy" data-project-cover-remove @click="removeCover">{{ text(TEXT.removeCover) }}</Button>
                    <p v-if="coverProblem !== ''" class="project-info__problem" role="alert" data-project-cover-problem>{{ coverProblem }}</p>
                </div>
                <div class="project-info__field project-info__field--plain">
                    <span :id="`${uid}-color`" class="project-info__label">
                        <span>{{ text(TEXT.color) }}</span>
                        <InfoTip :text="text(TEXT.colorHint)" :label="text(TEXT.colorInfo)" />
                    </span>
                    <ColorSwatches
                        :model-value="color"
                        :colors="SWATCHES"
                        :auto-label="text(TEXT.auto)"
                        :auto-color="autoColor"
                        :custom-label="text(TEXT.custom)"
                        :columns="5"
                        :label="text(TEXT.color)"
                        :disabled="busy"
                        data-project-color
                        @update:model-value="(value: string | null) => { color = value; }"
                    />
                    <span v-if="problems.color" class="project-info__error">{{ problems.color }}</span>
                </div>
            </div>
            <div class="project-info__fields">
                <div class="project-info__field">
                    <FormField :for="`${uid}-title`" :label="text(TEXT.title)" required :error="errorOf('title')">
                        <FormInput v-model="title" :maxlength="PROJECT_TITLE_MAX_LENGTH" :disabled="busy" data-project-title />
                    </FormField>
                    <span v-if="titleCount !== ''" class="project-info__count">{{ titleCount }}</span>
                </div>
                <div class="project-info__field project-info__field--grow">
                    <FormField :label="text(TEXT.description)" :error="errorOf('description')">
                        <FormTextarea v-model="description" :rows="3" :maxlength="PROJECT_DESCRIPTION_MAX_LENGTH" :placeholder="text(TEXT.descriptionPlaceholder)" :disabled="busy" class="project-info__description" data-project-description />
                    </FormField>
                    <span v-if="descriptionCount !== ''" class="project-info__count">{{ descriptionCount }}</span>
                </div>
                <div v-if="mode === 'create'" class="project-info__field project-info__field--plain">
                    <label :for="`${uid}-location`" class="project-info__label">
                        <span>{{ text(TEXT.location) }}</span>
                        <InfoTip :text="text(TEXT.locationHint)" :label="text(TEXT.locationInfo)" />
                    </label>
                    <div class="project-info__location" data-project-location>
                        <FormInput :id="`${uid}-location`" :model-value="location" :disabled="busy" class="project-info__path" data-project-location-input @update:model-value="emit('update:location', $event)">
                            <template #suffix>
                                <span v-if="folderName !== ''" class="project-info__folder" data-project-folder>/{{ folderName }}</span>
                            </template>
                        </FormInput>
                        <Button variant="secondary" :disabled="busy" data-project-browse @click="emit('browse-location')">{{ text(TEXT.browse) }}</Button>
                    </div>
                    <span v-if="errorOf('location') !== ''" class="project-info__error" data-project-location-error>{{ errorOf("location") }}</span>
                </div>
            </div>
            <!-- 让回车提交；按钮本身在窗口页脚。 -->
            <button type="submit" hidden tabindex="-1" aria-hidden="true" />
        </form>
        <template #footer>
            <Button variant="secondary" :disabled="busy" data-project-cancel @click="emit('cancel')">{{ text(TEXT.cancel) }}</Button>
            <Button variant="primary" :loading="busy" data-project-confirm @click="onConfirm">{{ confirmLabel }}</Button>
        </template>
    </DialogWindow>
</template>

<style scoped>
/* 左栏：封面、封面操作与主题色（主题色改的就是封面，放在它下面改了立刻看到）；右栏：书名、简介、保存位置。
   两栏底部对齐：简介的输入框占满右栏剩下的高度。 */
.project-info {
    display: grid;
    grid-template-columns: 170px minmax(0, 1fr);
    gap: var(--space-6);
}

.project-info__side {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.project-info__cover {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding-top: var(--space-1);
}

.project-info__cover-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
}

.project-info__fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.project-info__field {
    position: relative;
}

.project-info__field--grow {
    display: flex;
    flex: 1;
    flex-direction: column;
}

/* FormField 的根是单根的 label，带着本组件的作用域属性；让它与里面的输入框一起撑开。 */
.project-info__field--grow > label {
    display: flex;
    flex: 1;
    flex-direction: column;
}

.project-info__description {
    flex: 1;
    min-height: 88px;
    resize: none;
}

/* 计数靠在标签行右端：标签由 FormField 画，计数不占行。 */
.project-info__count {
    position: absolute;
    top: 0;
    right: 0;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
}

.project-info__field--plain {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.project-info__label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-main);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
}

.project-info__error {
    color: var(--status-danger);
    font-size: var(--text-xs);
}

.project-info__location {
    display: flex;
    gap: var(--space-2);
    align-items: center;
}

.project-info__path {
    flex: 1;
    min-width: 0;
}

.project-info__folder {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    white-space: nowrap;
}

.project-info__problem {
    margin: 0;
    color: var(--status-danger);
    font-size: var(--text-xs);
    text-align: center;
}

@container (max-width: 560px) {
    .project-info {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>

<style>
.project-info__body {
    container-type: inline-size;
    padding: var(--space-2) var(--space-5) var(--space-5);
}
</style>
