<script setup lang="ts">
import {Switch} from "@notnotype/nb-ui/components";
import type {DocTreeData} from "../host/types.js";
import CheckoutSwitch from "./CheckoutSwitch.vue";
import DocTree from "./DocTree.vue";

/** 文档页左边的一栏：切 checkout、与 master 的差异计数与“只看有差异的”、文档树。桌面上在左栏，手机上在抽屉里；契约见同名 .md。 */
withDefaults(defineProps<{tree: DocTreeData; checkout: string; preferred?: string[]; selected?: string | null; changedOnly?: boolean}>(), {preferred: () => [], selected: null, changedOnly: false});
const emit = defineEmits<{checkout: [key: string]; "update:changedOnly": [value: boolean]; open: [path: string]}>();
</script>

<template>
    <div class="nbdev-stack gap-3">
        <CheckoutSwitch :checkouts="tree.checkouts" :model-value="checkout" :preferred="preferred" @update:model-value="(key) => emit('checkout', key)" />
        <div v-if="!tree.checkout.isMain" class="nbdev-stack-tight nbdev-small">
            <p class="nbdev-secondary">与主工作区（master）的差异 {{ tree.changes.length }} 处</p>
            <label class="flex items-center gap-2"><Switch :model-value="changedOnly" aria-label="只看有差异的" @update:model-value="(value) => emit('update:changedOnly', value)" />只看有差异的</label>
        </div>
        <DocTree :docs="tree.docs" :changes="tree.changes" :selected="selected" :changed-only="changedOnly" @open="(path) => emit('open', path)" />
    </div>
</template>
