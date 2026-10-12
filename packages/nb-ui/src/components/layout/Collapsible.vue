<script setup lang="ts">
import {
    CollapsibleContent,
    CollapsibleRoot,
    CollapsibleTrigger,
} from "reka-ui";

import {markCollapseAnimation} from "./collapse-animation";

const props = withDefaults(defineProps<{
    open?: boolean;
    defaultOpen?: boolean;
    disabled?: boolean;
}>(), {
    open: undefined,
    defaultOpen: false,
    disabled: false,
});

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
}>();
</script>

<template>
    <CollapsibleRoot
        :open="props.open"
        :default-open="props.defaultOpen"
        :disabled="props.disabled"
        class="w-full"
        @update:open="(val) => emit('update:open', val)"
    >
        <CollapsibleTrigger as-child>
            <slot name="trigger" />
        </CollapsibleTrigger>

        <CollapsibleContent
            class="transition-[height,opacity] [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] nb-collapsible-content"
            @animationstart.self="markCollapseAnimation"
            @animationend.self="markCollapseAnimation"
            @animationcancel.self="markCollapseAnimation"
        >
            <slot />
        </CollapsibleContent>
    </CollapsibleRoot>
</template>
