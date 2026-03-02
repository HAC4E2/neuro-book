<script setup lang="ts">
import {NodeViewWrapper} from "@tiptap/vue-3";
import type {NodeViewProps} from "@tiptap/core";
import type {ReferenceKind} from "nbook/shared/reference-link";
import ReferenceChip from "nbook/app/components/common/ReferenceChip.vue";

const props = defineProps<NodeViewProps>();

const attrs = computed(() => props.node.attrs as {
    kind: ReferenceKind;
    targetId: string;
    label: string;
});

const rawSource = computed(() => `[${attrs.value.label}](${attrs.value.kind}://${attrs.value.targetId})`);
</script>

<template>
    <!-- Agent 引用节点 -->
    <NodeViewWrapper as="span" class="nb-agent-reference-node">
        <span class="nb-agent-reference-node__source">{{ rawSource }}</span>
        <ReferenceChip
            :label="attrs.label"
            :target="`${attrs.kind}://${attrs.targetId}`"
            :entry-type="attrs.kind"
        />
    </NodeViewWrapper>
</template>

<style scoped>
.nb-agent-reference-node {
    display: inline-flex;
    vertical-align: baseline;
}
</style>
