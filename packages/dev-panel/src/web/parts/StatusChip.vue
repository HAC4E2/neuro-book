<script setup lang="ts">
import {Badge} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import {statusDisplay} from "../host/format.js";
import type {RecordedValue} from "../host/types.js";

const props = withDefaults(defineProps<{status: RecordedValue; size?: "sm" | "md"}>(), {size: "sm"});
const display = computed(() => statusDisplay(props.status));
</script>

<template>
    <Badge :tone="display.tone" :variant="display.marked ? 'soft' : 'outline'" :size="size" :dot="display.marked">{{ display.label }}</Badge>
</template>
