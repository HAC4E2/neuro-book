<script setup lang="ts">
import {Badge, Collapsible} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";
import type {QuestionState, VersionQuestion} from "../host/types.js";

/** `answering`：上面有答复表单时不再重复列未答的题，只留已答与已取代、撤回的。 */
const props = withDefaults(defineProps<{questions: QuestionState[]; version: number; latestVersion: number; answering?: boolean}>(), {answering: false});
const answeredOpen = ref(false);
const retiredOpen = ref(false);

const open = computed(() => props.questions.filter((state) => state.state === "open").sort((left, right) => Number(right.question.required) - Number(left.question.required)));
const answered = computed(() => props.questions.filter((state) => state.state === "answered"));
const retired = computed(() => props.questions.filter((state) => state.state === "withdrawn" || state.state === "superseded"));
const TYPE_LABEL: Record<VersionQuestion["type"], string> = {single: "单选", multi: "多选", text: "文字", confirm: "确认"};

function valueText(question: VersionQuestion, value: unknown): string {
    const label = (entry: unknown) => question.options.find((option) => option.value === entry)?.label ?? String(entry);
    if (question.type === "confirm") return value === true ? "同意" : value === false ? "不同意" : String(value);
    if (Array.isArray(value)) return value.map(label).join("、");
    return question.type === "single" ? label(value) : String(value);
}

function outcomeText(state: QuestionState): string {
    const outcome = state.question.outcome;
    if (!outcome) return "";
    if (outcome.kind === "withdrawn") return outcome.reason === "closed" ? `v${outcome.in} 关闭产物时撤回` : `v${outcome.in} 撤回`;
    if (!outcome.by) return `被 v${outcome.in} 的页面取代`;
    return `被 ${outcome.by.artifactId}#${outcome.by.questionId} 取代（v${outcome.in}）`;
}
</script>

<template>
    <div class="flex flex-col gap-4">
        <p v-if="version !== latestVersion && !answering" class="rounded-[var(--radius-control)] px-2 py-1 nbdev-hint">
            看的是 v{{ version }} 的题表（最新是 v{{ latestVersion }}）；状态按全部答复现算
        </p>
        <section v-if="!answering" class="flex flex-col gap-2">
            <h3 class="font-semibold">未答 {{ open.length }}</h3>
            <p class="nbdev-empty" v-if="open.length === 0">没有未答的题</p>
            <article v-for="state in open" :key="state.question.id" class="flex flex-col gap-1.5 border-b pb-3 last:border-b-0 nbdev-divider">
                <div class="flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral" variant="outline" size="sm">{{ TYPE_LABEL[state.question.type] }}</Badge>
                    <Badge v-if="!state.question.required" tone="neutral" variant="soft" size="sm">选答</Badge>
                    <span class="nbdev-note">#{{ state.question.id }} · 自 v{{ state.question.since }}</span>
                </div>
                <p class="font-medium">{{ state.question.label }}</p>
                <ul v-if="state.question.options.length > 0" class="flex flex-col gap-0.5 pl-1 nbdev-note">
                    <li v-for="option in state.question.options" :key="option.value" class="flex items-center gap-1.5">
                        <span class="i-lucide-circle size-3" aria-hidden="true" />{{ option.label }}
                        <Badge v-if="state.question.recommend.includes(option.value)" tone="accent" variant="soft" size="sm">推荐</Badge>
                    </li>
                </ul>
                <p class="nbdev-note" v-if="state.question.about">关于 {{ state.question.about }}</p>
                <p v-if="state.stale" class="nbdev-hint nbdev-hint-warn">
                    旧答复“{{ valueText(state.question, state.stale.value) }}”{{ state.stale.code === "stale_value" ? `按 v${state.stale.artifactVersion} 合法，但选项后来改了` : "本身就不合法" }}，要重新答
                </p>
            </article>
        </section>
        <Collapsible v-if="answered.length > 0" v-model:open="answeredOpen">
            <template #trigger>
                <button type="button" class="flex items-center gap-1 font-semibold" :aria-expanded="answeredOpen">
                    <span :class="answeredOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4" aria-hidden="true" />已答 {{ answered.length }}
                </button>
            </template>
            <div class="mt-2 flex flex-col gap-2">
                <article v-for="state in answered" :key="state.question.id" class="flex flex-col gap-0.5">
                    <p class="font-medium">{{ state.question.label }}</p>
                    <p class="nbdev-note">
                        {{ valueText(state.question, state.answer?.value) }} · 针对 v{{ state.answer?.artifactVersion }}<template v-if="state.answer?.comment"> · {{ state.answer.comment }}</template>
                    </p>
                </article>
            </div>
        </Collapsible>
        <Collapsible v-if="retired.length > 0" v-model:open="retiredOpen">
            <template #trigger>
                <button type="button" class="flex items-center gap-1 font-semibold nbdev-secondary" :aria-expanded="retiredOpen">
                    <span :class="retiredOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4" aria-hidden="true" />已取代与撤回 {{ retired.length }}
                </button>
            </template>
            <ul class="mt-2 flex flex-col gap-1.5 nbdev-empty">
                <li v-for="state in retired" :key="state.question.id">
                    <span class="line-through">{{ state.question.label }}</span>
                    <span class="nbdev-small"> · {{ outcomeText(state) }}</span>
                </li>
            </ul>
        </Collapsible>
    </div>
</template>
