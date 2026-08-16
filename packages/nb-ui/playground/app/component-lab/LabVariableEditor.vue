<script setup lang="ts">
import {computed, ref} from "vue";
import type {LabTokenGroup} from "./registry";

const props = defineProps<{
    groups: LabTokenGroup[];
    resolvedValues: Record<string, string>;
    overrides: Record<string, string>;
}>();

const emit = defineEmits<{
    (event: "update", name: string, value: string): void;
    (event: "reset", name: string): void;
}>();

const query = ref("");

const filteredGroups = computed(() => {
    const needle = query.value.trim().toLowerCase();
    if (needle === "") return props.groups;
    return props.groups
        .map((group) => ({...group, tokens: group.tokens.filter((token) => token.toLowerCase().includes(needle))}))
        .filter((group) => group.tokens.length > 0);
});

function tokenKind(name: string, value: string): string {
    if (name.startsWith("--bg-") || name.startsWith("--text-") || name.startsWith("--accent-") || name.startsWith("--status-") || name.includes("surface") || name.includes("outline") || name === "--divider") return "颜色";
    if (name.includes("motion")) return "时长";
    if (name.includes("radius") || name.includes("space") || name.includes("control-h") || name.includes("control-px") || name.includes("panel-p") || name.includes("gap")) return "长度";
    if (name.includes("shadow") || name.includes("elevation") || name.includes("blur") || name.includes("backdrop")) return "效果";
    if (/^-?\d+(\.\d+)?$/u.test(value)) return "数值";
    return "CSS";
}

function swatchStyle(value: string): Record<string, string> {
    return {background: value};
}
</script>

<template>
    <div class="lab-variable-editor">
        <label class="lab-search">
            <span class="i-lucide-search" aria-hidden="true"></span>
            <input v-model="query" type="search" placeholder="筛选变量" aria-label="筛选 CSS 变量">
        </label>

        <div v-if="filteredGroups.length === 0" class="lab-empty">没有匹配变量</div>
        <section v-for="group in filteredGroups" :key="group.id" class="lab-token-group">
            <h3>{{ group.label }}</h3>
            <div v-for="token in group.tokens" :key="token" class="lab-token-row" :class="{'is-overridden': token in props.overrides}">
                <div class="lab-token-meta">
                    <span class="lab-token-swatch" :style="swatchStyle(props.overrides[token] ?? props.resolvedValues[token] ?? 'transparent')"></span>
                    <code>{{ token }}</code>
                    <span>{{ tokenKind(token, props.resolvedValues[token] ?? "") }}</span>
                </div>
                <div class="lab-token-input-row">
                    <input
                        type="text"
                        :value="props.overrides[token] ?? ''"
                        :placeholder="props.resolvedValues[token] || '未定义'"
                        :aria-label="`${token} 覆盖值`"
                        @change="emit('update', token, ($event.target as HTMLInputElement).value)"
                        @keydown.enter="($event.target as HTMLInputElement).blur()"
                    >
                    <button v-if="token in props.overrides" type="button" title="重置变量" :aria-label="`重置 ${token}`" @click="emit('reset', token)">
                        <span class="i-lucide-rotate-ccw" aria-hidden="true"></span>
                    </button>
                </div>
                <div class="lab-token-value">{{ props.overrides[token] ?? props.resolvedValues[token] ?? "未定义" }}</div>
            </div>
        </section>
    </div>
</template>
