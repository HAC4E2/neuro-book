<script setup lang="ts">
import {computed, ref, watch} from "vue";
import type {DocChange, DocEntry} from "../host/types.js";

const props = withDefaults(defineProps<{docs: DocEntry[]; changes: DocChange[]; selected?: string | null; changedOnly?: boolean}>(), {selected: null, changedOnly: false});
defineEmits<{open: [path: string]}>();

const GROUP_TITLE: Record<string, string> = {
    entry: "入口", spec: "Spec", adr: "ADR", proposal: "Proposal", module: "模块", standard: "规范", testing: "测试", intent: "意图", repo: "仓库文档", package: "包文档", skill: "Skill", site: "文档站",
};
const ORDER = ["entry", "spec", "adr", "proposal", "module", "standard", "testing", "intent", "repo", "package", "skill", "site"];
const CHANGE_LABEL: Record<DocChange["change"], string> = {added: "新增", modified: "改动", deleted: "删去", master_only: "master 才有"};

const changeOf = computed(() => new Map(props.changes.map((change) => [change.path, change.change])));
type Row = {path: string; name: string; change: DocChange["change"] | null; present: boolean};
const groups = computed(() => {
    const rows = new Map<string, Map<string, Row[]>>();
    const add = (entry: DocEntry, present: boolean) => {
        const change = changeOf.value.get(entry.path) ?? null;
        if (props.changedOnly && !change) return;
        const sections = rows.get(entry.group) ?? new Map<string, Row[]>();
        const list = sections.get(entry.section) ?? [];
        list.push({path: entry.path, name: entry.path.slice(entry.path.lastIndexOf("/") + 1), change, present});
        sections.set(entry.section, list);
        rows.set(entry.group, sections);
    };
    for (const entry of props.docs) add(entry, true);
    const known = new Set(props.docs.map((entry) => entry.path));
    for (const change of props.changes) {
        if (known.has(change.path)) continue;
        const guess = props.docs.find((entry) => change.path.startsWith(`${entry.path.slice(0, entry.path.lastIndexOf("/"))}/`));
        add({path: change.path, group: guess?.group ?? "repo", section: guess?.section ?? change.path.slice(0, change.path.lastIndexOf("/"))}, false);
    }
    return ORDER.filter((group) => rows.has(group)).map((group) => ({
        key: group,
        title: GROUP_TITLE[group] ?? group,
        changed: [...rows.get(group)!.values()].flat().filter((row) => row.change).length,
        sections: [...rows.get(group)!.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([section, list]) => ({section, rows: list.sort((left, right) => left.path.localeCompare(right.path))})),
    }));
});

const open = ref<Record<string, boolean>>({});
watch(() => [props.selected, props.changes] as const, () => {
    const next: Record<string, boolean> = {...open.value};
    for (const group of groups.value) {
        if (group.changed > 0 || group.sections.some((section) => section.rows.some((row) => row.path === props.selected))) next[group.key] = true;
    }
    open.value = next;
}, {immediate: true});
</script>

<template>
    <nav class="flex flex-col gap-1 nbdev-small" aria-label="文档树">
        <section v-for="group in groups" :key="group.key">
            <button type="button" class="flex w-full items-center gap-1 rounded-[var(--radius-control)] px-1 py-1 font-semibold hover:bg-[var(--bg-hover)]" :aria-expanded="open[group.key] ?? false" @click="open = {...open, [group.key]: !(open[group.key] ?? false)}">
                <span :class="open[group.key] ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5" aria-hidden="true" />
                {{ group.title }}
                <span v-if="group.changed > 0" class="ml-auto nbdev-warn">{{ group.changed }} 处差异</span>
            </button>
            <div v-if="open[group.key]" class="ml-4 flex flex-col">
                <div v-for="section in group.sections" :key="section.section" class="flex flex-col">
                    <p v-if="section.section" class="truncate px-1 pt-1 nbdev-secondary">{{ section.section }}</p>
                    <template v-for="row in section.rows" :key="row.path">
                        <button v-if="row.present" type="button" class="flex min-w-0 items-center gap-1.5 rounded-[var(--radius-control)] px-1 py-0.5 text-left hover:bg-[var(--bg-hover)]" :class="{'bg-[var(--accent-bg)]': row.path === selected}" :aria-current="row.path === selected ? 'page' : undefined" :title="row.path" @click="$emit('open', row.path)">
                            <span class="min-w-0 flex-1 truncate">{{ row.name }}</span>
                            <span v-if="row.change" class="shrink-0" :class="row.change === 'added' ? 'nbdev-ok' : 'nbdev-warn'">{{ CHANGE_LABEL[row.change] }}</span>
                        </button>
                        <span v-else class="flex min-w-0 items-center gap-1.5 px-1 py-0.5 nbdev-empty" :title="row.path">
                            <span class="min-w-0 flex-1 truncate" :class="{'line-through': row.change === 'deleted'}">{{ row.name }}</span>
                            <span class="shrink-0">{{ row.change ? CHANGE_LABEL[row.change] : "" }}</span>
                        </span>
                    </template>
                </div>
            </div>
        </section>
    </nav>
</template>
