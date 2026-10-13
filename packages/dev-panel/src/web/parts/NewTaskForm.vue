<script setup lang="ts">
import {Button, FormField, FormInput, FormSelect, FormTextarea, RadioGroup} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import {SLUG_PATTERN} from "../../core/ids.js";
import {controlCharProblem, titleProblem} from "../../core/text-rules.js";
import type {PreviewProblem} from "../host/types.js";

/** 新建 Task 的表单：所属 Work（只列记录在 master 上的，来自分支的 Work 新建的 Task 同样写进 master）、短名、标题、目标、状态。 */
export type TaskFormValue = {workId: string; slug: string; title: string; goal: string; status: "planned" | "active"};

const props = defineProps<{modelValue: TaskFormValue; works: Array<{workId: string; title: string | null}>; problems: PreviewProblem[]; pending: boolean; slow: boolean; disabledReason: string | null}>();
const emit = defineEmits<{"update:modelValue": [value: TaskFormValue]; submit: []}>();

const update = <K extends keyof TaskFormValue>(key: K, value: TaskFormValue[K]) => emit("update:modelValue", {...props.modelValue, [key]: value});
const STATUS_OPTIONS = [{value: "planned", label: "计划中"}, {value: "active", label: "进行中"}];
const workOptions = computed(() => props.works.map((work) => ({value: work.workId, label: work.title ? `${work.workId.slice(0, 6)} ${work.title}` : work.workId})));

const errors = computed(() => {
    const value = props.modelValue;
    const found: Record<string, string> = {};
    if (value.slug !== "" && !SLUG_PATTERN.test(value.slug)) found.slug = "只能是小写字母、数字与连字符";
    if (value.title !== "") found.title = titleProblem(value.title) ?? "";
    if (value.goal !== "") found.goal = controlCharProblem(value.goal, true) ?? "";
    for (const problem of props.problems) found[problem.field] ||= problem.message;
    return found;
});
const complete = computed(() => props.modelValue.workId !== "" && props.modelValue.slug !== "" && props.modelValue.title !== "" && Object.values(errors.value).every((message) => !message));
</script>

<template>
    <form class="flex flex-col gap-3" @submit.prevent="complete && !pending && !disabledReason && emit('submit')">
        <fieldset class="grid grid-cols-1 gap-3 md:grid-cols-2" :disabled="pending || disabledReason !== null">
            <FormField label="所属 Work" :error="errors.workId ?? ''" required class="md:col-span-2">
                <FormSelect :model-value="modelValue.workId" :options="workOptions" placeholder="选一个 Work" @update:model-value="(value: string) => update('workId', value)" />
            </FormField>
            <FormField label="短名" description="kebab-case，进 Task id" :error="errors.slug ?? ''" required>
                <FormInput :model-value="modelValue.slug" @update:model-value="(value: string) => update('slug', value)" />
            </FormField>
            <FormField label="标题" :error="errors.title ?? ''" required>
                <FormInput :model-value="modelValue.title" @update:model-value="(value: string) => update('title', value)" />
            </FormField>
            <FormField label="目标与范围（可选）" :error="errors.goal ?? ''" class="md:col-span-2">
                <FormTextarea :model-value="modelValue.goal" :rows="3" @update:model-value="(value: string) => update('goal', value)" />
            </FormField>
            <FormField label="状态">
                <RadioGroup :model-value="modelValue.status" :options="STATUS_OPTIONS" orientation="horizontal" size="sm" @update:model-value="(value: string) => update('status', value as TaskFormValue['status'])" />
            </FormField>
        </fieldset>
        <div class="flex flex-wrap items-center gap-2">
            <Button type="submit" :loading="pending" :disabled="!complete || disabledReason !== null">新建 Task</Button>
            <span v-if="slow" style="color: var(--text-secondary); font-size: var(--text-xs)">在等别的写入完成…</span>
        </div>
    </form>
</template>
