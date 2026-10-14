<script setup lang="ts">
import {Badge, Button, CheckboxGroup, FormField, FormTextarea, RadioGroup} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";
import {controlCharProblem} from "../../core/text-rules.js";
import {validateAnswerValue} from "../../core/questions.js";
import type {QuestionState, VersionQuestion} from "../host/types.js";

/**
 * 产物页侧栏的答复表单：每道活的题（未答与已答）给控件，已答的预填现在的取值。只交改过或新填的题；校验用核心的同一份规则。
 * 零件不发请求：按“提交”只发 `submit`，由页面发写请求、处理失败。
 */
const props = defineProps<{
    questions: QuestionState[];
    pending: boolean;
    slow: boolean;
    /** 不能答的原因（来自分支、产物已关闭、主工作区不能写、看的不是最新一版）；有值时表单只读。 */
    disabledReason: string | null;
    /** 服务端按题号退回的错误。 */
    errors: Record<string, string>;
    /** 变了就清空本地的填写（提交成功之后）。 */
    resetKey: number;
}>();
const emit = defineEmits<{submit: [answer: {values: Record<string, unknown>; comments: Record<string, string>; note: string | null}]}>();

const live = computed(() => props.questions.filter((state) => state.state === "open" || state.state === "answered"));
const values = ref<Record<string, unknown>>({});
const comments = ref<Record<string, string>>({});
const commenting = ref<Record<string, boolean>>({});
const touched = ref<Record<string, boolean>>({});
const note = ref("");

function reset(): void {
    values.value = Object.fromEntries(live.value.filter((state) => state.answer).map((state) => [state.question.id, state.answer!.value]));
    comments.value = {};
    commenting.value = {};
    touched.value = {};
    note.value = "";
}
watch(() => props.resetKey, reset, {immediate: true});

function set(id: string, value: unknown): void {
    values.value = {...values.value, [id]: value};
    touched.value = {...touched.value, [id]: true};
}

const CONFIRM_OPTIONS = [{value: "true", label: "同意"}, {value: "false", label: "不同意"}];
const optionsOf = (question: VersionQuestion) => question.options.map((option) => ({value: option.value, label: question.recommend.includes(option.value) ? `${option.label}（推荐）` : option.label}));

/** 只交改过的题（含新填的）与写了说明的题。 */
const chosen = computed(() => live.value.filter((state) => touched.value[state.question.id] || (comments.value[state.question.id] ?? "").trim() !== ""));
const problems = computed(() => {
    const found: Record<string, string> = {};
    for (const state of chosen.value) {
        const id = state.question.id;
        if (!touched.value[id] && state.answer) continue;
        const reason = validateAnswerValue(state.question, values.value[id]);
        if (reason) found[id] = reason;
        const comment = comments.value[id] ?? "";
        const commentProblem = comment === "" ? null : controlCharProblem(comment, true);
        if (commentProblem) found[id] = `说明${commentProblem}`;
    }
    return found;
});
const noteProblem = computed(() => (note.value === "" ? null : controlCharProblem(note.value, true)));
const ready = computed(() => chosen.value.length > 0 && Object.keys(problems.value).length === 0 && noteProblem.value === null);

function submit(): void {
    if (!ready.value || props.pending || props.disabledReason) return;
    const answer: Record<string, unknown> = {};
    const notes: Record<string, string> = {};
    for (const state of chosen.value) {
        const id = state.question.id;
        // 只写了说明、没改取值的已答题：带上现在的取值，答复文件里这道题仍有取值。
        answer[id] = values.value[id];
        if ((comments.value[id] ?? "").trim() !== "") notes[id] = comments.value[id]!;
    }
    emit("submit", {values: answer, comments: notes, note: note.value.trim() === "" ? null : note.value});
}
</script>

<template>
    <form class="flex flex-col gap-4" @submit.prevent="submit">
        <p v-if="disabledReason" class="rounded-[var(--radius-control)] px-2 py-1 nbdev-hint">{{ disabledReason }}</p>
        <p class="nbdev-empty" v-if="live.length === 0">没有能答的题</p>
        <fieldset v-for="state in live" :key="state.question.id" class="flex flex-col gap-1.5 border-b pb-3 last:border-b-0 nbdev-divider" :disabled="disabledReason !== null || pending">
            <legend class="flex flex-wrap items-center gap-1.5 pb-1">
                <span class="font-medium">{{ state.question.label }}</span>
                <Badge v-if="state.state === 'answered'" tone="success" variant="soft" size="sm">已答</Badge>
                <Badge v-else-if="state.question.required" tone="warning" variant="soft" size="sm">必答</Badge>
                <Badge v-else tone="neutral" variant="soft" size="sm">选答</Badge>
                <span class="nbdev-note">#{{ state.question.id }}</span>
            </legend>
            <p class="nbdev-note" v-if="state.question.about">关于 {{ state.question.about }}</p>
            <RadioGroup v-if="state.question.type === 'single'" :model-value="typeof values[state.question.id] === 'string' ? (values[state.question.id] as string) : ''" :options="optionsOf(state.question)" size="sm" @update:model-value="(value: string) => set(state.question.id, value)" />
            <CheckboxGroup v-else-if="state.question.type === 'multi'" :model-value="Array.isArray(values[state.question.id]) ? (values[state.question.id] as string[]) : []" :options="optionsOf(state.question)" @update:model-value="(value: string[]) => set(state.question.id, value)" />
            <RadioGroup v-else-if="state.question.type === 'confirm'" :model-value="values[state.question.id] === undefined ? '' : String(values[state.question.id])" :options="CONFIRM_OPTIONS" orientation="horizontal" size="sm" @update:model-value="(value: string) => set(state.question.id, value === 'true')" />
            <FormTextarea v-else :model-value="typeof values[state.question.id] === 'string' ? (values[state.question.id] as string) : ''" :rows="3" :aria-label="state.question.label" @update:model-value="(value: string) => set(state.question.id, value)" />
            <FormField v-if="commenting[state.question.id]" label="说明（可选）">
                <FormTextarea :model-value="comments[state.question.id] ?? ''" :rows="2" @update:model-value="(value: string) => (comments = {...comments, [state.question.id]: value})" />
            </FormField>
            <button v-else type="button" class="self-start nbdev-note" @click="commenting = {...commenting, [state.question.id]: true}">加说明</button>
            <p class="nbdev-danger nbdev-small" v-if="problems[state.question.id] ?? errors[state.question.id]" role="alert">{{ problems[state.question.id] ?? errors[state.question.id] }}</p>
        </fieldset>
        <FormField v-if="live.length > 0" label="整份答复的备注（可选）" :error="noteProblem ?? ''">
            <FormTextarea v-model="note" :rows="2" :disabled="disabledReason !== null || pending" />
        </FormField>
        <div v-if="live.length > 0" class="flex flex-wrap items-center gap-2">
            <Button type="submit" :loading="pending" :disabled="!ready || disabledReason !== null">提交 {{ chosen.length }} 题</Button>
            <span class="nbdev-note" v-if="slow">在等别的写入完成…</span>
            <span class="nbdev-empty nbdev-small" v-else-if="chosen.length === 0 && !disabledReason">还没有改任何一题</span>
        </div>
    </form>
</template>
