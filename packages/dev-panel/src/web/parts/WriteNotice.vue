<script setup lang="ts">
import {Notification} from "@notnotype/nb-ui/components";
import type {Notice} from "../host/writes.js";

/** 一次写入的结果：成功（含“内容没变”与警告）、失败的原因与补救、结果未知。只有确定什么都没写的失败给“重试”。 */
defineProps<{notice: Notice}>();
const emit = defineEmits<{dismiss: []; retry: []}>();
</script>

<template>
    <Notification :tone="notice.tone" :title="notice.title" dismissible :action-label="notice.retry ? '重试' : ''" @dismiss="emit('dismiss')" @action="emit('retry')">
        <p v-if="notice.message">{{ notice.message }}</p>
        <ul v-if="notice.items.length > 0" class="mt-1 flex list-disc flex-col gap-0.5 pl-4" style="font-size: var(--text-xs)">
            <li v-for="(item, index) in notice.items" :key="index">{{ item }}</li>
        </ul>
    </Notification>
</template>
