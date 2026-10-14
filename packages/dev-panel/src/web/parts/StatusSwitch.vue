<script setup lang="ts">
import {Button, FormSelect} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";
import {statusLabel} from "../host/format.js";

/**
 * Work 页与 Task 页的状态切换：下拉选了不立即写，先在原地确认一次（“把 t09 改成完成”），确认后发 `confirm`，由页面发请求。
 * 不能切换时（来自分支、主工作区不能写）只显示原因。
 */
const props = defineProps<{
    /** 现在的状态取值；没有字段或不合规时为 null。 */
    status: string | null;
    /** 可选的取值（Work：active、done、shelved；Task 另有 planned）。 */
    options: readonly string[];
    /** 确认句里的主语，例如 t09 或 w00022。 */
    subject: string;
    disabledReason: string | null;
    pending: boolean;
    slow: boolean;
}>();
const emit = defineEmits<{confirm: [status: string]}>();

const choice = ref<string | null>(null);
watch(() => props.status, () => {
    choice.value = null;
});
const selectOptions = computed(() => props.options.map((value) => ({value, label: statusLabel(value)})));
</script>

<template>
    <div class="flex flex-wrap items-center gap-2 nbdev-small">
        <template v-if="disabledReason">
            <span class="nbdev-empty">{{ disabledReason }}</span>
        </template>
        <template v-else>
            <div class="w-32">
                <FormSelect :model-value="choice ?? status ?? ''" :options="selectOptions" aria-label="改状态" placeholder="未标" size="sm" :disabled="pending" @update:model-value="(value: string) => (choice = value === status ? null : value)" />
            </div>
            <template v-if="choice">
                <span>把 {{ subject }} 改成{{ statusLabel(choice) }}？</span>
                <Button size="sm" :loading="pending" @click="emit('confirm', choice)">确认</Button>
                <Button size="sm" variant="ghost" :disabled="pending" @click="choice = null">取消</Button>
                <span class="nbdev-secondary" v-if="slow">在等别的写入完成…</span>
            </template>
        </template>
    </div>
</template>
