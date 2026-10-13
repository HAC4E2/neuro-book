<script setup lang="ts">
import {EmptyState} from "@notnotype/nb-ui/components";
</script>

<template>
    <div class="flex h-full items-center justify-center p-6">
        <EmptyState icon-class="i-lucide-map-pin-off" title="没有这一页" description="地址可能写错了，或者面板还没有这个视图" />
    </div>
</template>
