<script setup lang="ts">
import {Badge, Tooltip} from "@notnotype/nb-ui/components";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch} from "vue";
import {taskLabel, workLabel} from "../host/format.js";
import {entryActive, NAV_GROUPS, NAV_RECENT_DAYS, splitNavWorks, type NavCount} from "../host/nav.js";
import {isPlainClick, taskHref, workHref} from "../host/routes.js";
import type {OverviewWork} from "../host/types.js";

/** 面板的导航：上段固定入口、下段单独滚动的 Work 树；桌面左栏与手机抽屉共用。契约见同名 .md。 */
const props = withDefaults(defineProps<{
    works: OverviewWork[] | null;
    current: {path: string; workId: string | null; taskId: string | null};
    expanded: Record<string, boolean>;
    counts?: Partial<Record<NavCount, number>>;
    writable: {ok: boolean; code: string | null} | null;
    now?: Date;
    inset?: boolean;
}>(), {counts: () => ({}), now: undefined, inset: true});
const emit = defineEmits<{navigate: [href: string]; toggle: [workId: string, open: boolean]}>();
/** 桌面左栏与抽屉里各有一份导航，“工作”标题的 id 要各自唯一。 */
const worksHeadingId = `nbdev-nav-works-${useId()}`;

type Row = {key: string; kind: "work" | "task"; workId: string; href: string; number: string; title: string; current: boolean; ancestor: boolean; open: boolean};
/** 树里的一个 Work 与它展开后的 Task（读屏器按 tree、treeitem、group 读出层级）。 */
type Branch = {work: Row; tasks: Row[]};

const split = computed(() => splitNavWorks(props.works ?? [], props.now ?? new Date()));
const moreOpen = ref(false);
const currentInMore = computed(() => split.value.more.some((work) => work.workId === props.current.workId));
// 当前 Work 在“更多”里时打开“更多”一次；之后开发者照样能收起它。
watch(currentInMore, (inMore) => {
    if (inMore) moreOpen.value = true;
}, {immediate: true});
const isOpen = (workId: string) => props.expanded[workId] ?? workId === props.current.workId;

function branchesOf(works: readonly OverviewWork[]): Branch[] {
    return works.map((work) => {
        const href = workHref(work.workId);
        const open = isOpen(work.workId);
        const tasks = open ? work.tasks.map((task): Row => {
            const taskPath = taskHref(work.workId, task.taskId);
            return {key: `t:${work.workId}/${task.taskId}`, kind: "task", workId: work.workId, href: taskPath, number: taskLabel(task.taskId), title: task.title ?? task.taskId, current: props.current.path === taskPath, ancestor: props.current.path !== taskPath && props.current.workId === work.workId && props.current.taskId === task.taskId, open: false};
        }) : [];
        return {work: {key: `w:${work.workId}`, kind: "work", workId: work.workId, href, number: workLabel(work.workId), title: work.title ?? work.workId, current: props.current.path === href, ancestor: props.current.path !== href && props.current.workId === work.workId, open}, tasks};
    });
}
/** 活跃的 Work 在前，“更多”展开时其余的接在后面；方向键在整棵树里走。 */
const branches = computed(() => [...branchesOf(split.value.shown), ...(moreOpen.value ? branchesOf(split.value.more) : [])]);
const allRows = computed(() => branches.value.flatMap((branch) => [branch.work, ...branch.tasks]));

function follow(event: MouseEvent, href: string): void {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    emit("navigate", href);
}

// ---- Work 树的键盘：整棵树只有一个 Tab 停靠点，方向键在行之间走 ----
const tree = ref<HTMLElement | null>(null);
/** Work 树的滚动者（树外面那一层：“更多”按钮也在里面一起滚）。 */
const scroller = ref<HTMLElement | null>(null);
const focusKey = ref<string | null>(null);
const rovingKey = computed(() => {
    const rows = allRows.value;
    if (focusKey.value && rows.some((row) => row.key === focusKey.value)) return focusKey.value;
    return (rows.find((row) => row.current) ?? rows.find((row) => row.ancestor) ?? rows[0])?.key ?? null;
});
function focusRow(key: string | undefined): void {
    if (!key) return;
    focusKey.value = key;
    void nextTick(() => tree.value?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`)?.focus());
}
function onTreeKey(event: KeyboardEvent): void {
    const key = (event.target as HTMLElement | null)?.dataset.rowKey;
    const rows = allRows.value;
    const index = rows.findIndex((row) => row.key === key);
    if (index < 0) return;
    const row = rows[index]!;
    let handled = true;
    if (event.key === "ArrowDown") focusRow(rows[index + 1]?.key);
    else if (event.key === "ArrowUp") focusRow(rows[index - 1]?.key);
    else if (event.key === "Home") focusRow(rows[0]?.key);
    else if (event.key === "End") focusRow(rows.at(-1)?.key);
    else if (event.key === "ArrowRight" && row.kind === "work") {
        if (!row.open) emit("toggle", row.workId, true);
        else if (rows[index + 1]?.kind === "task") focusRow(rows[index + 1]!.key);
    } else if (event.key === "ArrowLeft") {
        if (row.kind === "task") focusRow(`w:${row.workId}`);
        else if (row.open) emit("toggle", row.workId, false);
    } else handled = false;
    if (handled) event.preventDefault();
}

// ---- 被截断的标题：只给这些行挂全文提示；宽度变了重量 ----
const truncated = ref<ReadonlySet<string>>(new Set());
function measure(): void {
    const next = new Set<string>();
    for (const label of tree.value?.querySelectorAll<HTMLElement>("[data-label-key]") ?? []) {
        if (label.scrollWidth > label.clientWidth) next.add(label.dataset.labelKey!);
    }
    const same = next.size === truncated.value.size && [...next].every((key) => truncated.value.has(key));
    if (!same) truncated.value = next;
}
let observer: ResizeObserver | null = null;

/**
 * 把当前那一行滚进 Work 树的可视区：只调树自己的 scrollTop，不用 scrollIntoView（它会连带滚动外面裁切溢出的面板）。
 * 回答找没找到那一行。
 */
function revealCurrent(): boolean {
    const box = scroller.value;
    // 先找当前页那一行（Task 页上是 Task），没有再找所属的那一行（产物页上是它的 Task 或 Work）。
    const row = box?.querySelector<HTMLElement>("[aria-current='page']") ?? box?.querySelector<HTMLElement>("[data-ancestor='true']:not([data-row-key^='w:'])") ?? box?.querySelector<HTMLElement>("[data-ancestor='true']");
    if (!box || !row) return false;
    const outer = box.getBoundingClientRect();
    const inner = row.getBoundingClientRect();
    if (inner.top < outer.top) box.scrollTop -= outer.top - inner.top;
    else if (inner.bottom > outer.bottom) box.scrollTop += inner.bottom - outer.bottom;
    return true;
}
/**
 * 只在当前页变了之后滚一次（行第一次出现时：数据刚到、所属 Work 刚展开）。每次推送都会换一份 `works`、行会重算，
 * 若每次都滚，开发者往上翻树找别的 Work、或展开别的 Work 时会被拽回当前行。量截断不改滚动，随行重算。
 */
let revealedFor: string | null = null;
function revealOnce(): void {
    if (revealedFor === props.current.path) return;
    if (revealCurrent()) revealedFor = props.current.path;
}
watch(() => props.current.path, () => {
    revealedFor = null;
    revealOnce();
}, {flush: "post"});
watch(allRows, () => {
    measure();
    revealOnce();
}, {flush: "post"});
onMounted(() => {
    measure();
    revealOnce();
    if (tree.value) {
        observer = new ResizeObserver(() => measure());
        observer.observe(tree.value);
    }
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
    <nav class="flex h-full min-h-0 flex-col" aria-label="面板导航">
        <div class="flex shrink-0 flex-col gap-3 pt-3 pb-2" :class="inset ? 'px-3' : ''">
            <div class="flex min-h-7 items-center gap-1">
                <a href="/" class="flex min-w-0 flex-1 items-center gap-2 px-2 font-semibold" @click="follow($event, '/')"><span class="i-lucide-layout-dashboard size-4" aria-hidden="true" />nbdev 面板</a>
                <slot name="actions" />
            </div>
            <section v-for="group in NAV_GROUPS" :key="group.title ?? 'top'" class="flex flex-col gap-0.5" :aria-label="group.title ?? undefined">
                <h2 v-if="group.title" class="nbdev-nav-heading">{{ group.title }}</h2>
                <template v-for="entry in group.entries" :key="entry.key">
                    <template v-if="entry.needsWritable && writable?.ok !== true">
                        <p v-if="writable" class="px-2 nbdev-empty nbdev-small">主工作区现在不能写（{{ writable.code }}），写入口已隐藏</p>
                    </template>
                    <a v-else :href="entry.href" class="nbdev-nav-item" :class="{'nbdev-nav-current': entryActive(entry, current.path)}" :aria-current="entryActive(entry, current.path) ? 'page' : undefined" @click="follow($event, entry.href)">
                        <span :class="entry.icon" class="size-4 shrink-0" aria-hidden="true" />
                        <span class="min-w-0 truncate">{{ entry.label }}</span>
                        <template v-if="entry.count && counts[entry.count] !== undefined">
                            <Badge v-if="entry.count === 'inbox' && (counts.inbox ?? 0) > 0" tone="warning" variant="soft" size="sm" class="ml-auto">{{ counts.inbox }}</Badge>
                            <span v-else-if="entry.count !== 'inbox'" class="ml-auto nbdev-note">{{ counts[entry.count] }}</span>
                        </template>
                    </a>
                </template>
            </section>
            <h2 :id="worksHeadingId" class="nbdev-nav-heading">工作</h2>
        </div>
        <div ref="scroller" class="nbdev-scroll-y min-h-0 flex-1 pb-3" :class="inset ? 'px-3' : ''">
            <p v-if="works === null" class="px-2 nbdev-empty nbdev-small">正在读取</p>
            <p v-else-if="split.shown.length === 0" class="px-2 nbdev-empty nbdev-small">没有进行中或 {{ NAV_RECENT_DAYS }} 天内更新过的 Work</p>
            <!-- WAI-ARIA 的导航树：tree 里是 Work（第 1 层）与展开后的 Task（第 2 层，在 group 里）；整棵树一个 Tab 停靠点，方向键在行间走。 -->
            <div ref="tree" role="tree" :aria-labelledby="worksHeadingId" @keydown="onTreeKey">
                <div v-for="branch in branches" :key="branch.work.key" role="none" class="flex flex-col">
                    <div role="none" class="flex items-center">
                        <!-- 展开按钮只给鼠标：读屏器从 treeitem 的 aria-expanded 知道展开状态，键盘用左右键。 -->
                        <button type="button" tabindex="-1" aria-hidden="true" class="nbdev-nav-toggle" @click="emit('toggle', branch.work.workId, !branch.work.open)">
                            <span :class="branch.work.open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5" aria-hidden="true" />
                        </button>
                        <Tooltip :text="`${branch.work.number} ${branch.work.title}`" placement="right" :disabled="!truncated.has(branch.work.key)">
                            <a role="treeitem" aria-level="1" :aria-expanded="branch.work.open" :href="branch.work.href" class="nbdev-nav-item min-w-0 flex-1" :class="{'nbdev-nav-current': branch.work.current, 'nbdev-nav-ancestor': branch.work.ancestor}" :aria-current="branch.work.current ? 'page' : undefined" :data-ancestor="branch.work.ancestor || undefined" :data-row-key="branch.work.key" :tabindex="branch.work.key === rovingKey ? 0 : -1" @focus="focusKey = branch.work.key" @click="follow($event, branch.work.href)">
                                <span class="min-w-0 truncate" :data-label-key="branch.work.key"><span class="nbdev-secondary">{{ branch.work.number }}</span> {{ branch.work.title }}</span>
                            </a>
                        </Tooltip>
                    </div>
                    <div v-if="branch.tasks.length > 0" role="group" class="flex flex-col pl-5">
                        <Tooltip v-for="row in branch.tasks" :key="row.key" :text="`${row.number} ${row.title}`" placement="right" :disabled="!truncated.has(row.key)">
                            <a role="treeitem" aria-level="2" :href="row.href" class="nbdev-nav-item min-w-0" :class="{'nbdev-nav-current': row.current, 'nbdev-nav-ancestor': row.ancestor}" :aria-current="row.current ? 'page' : undefined" :data-ancestor="row.ancestor || undefined" :data-row-key="row.key" :tabindex="row.key === rovingKey ? 0 : -1" @focus="focusKey = row.key" @click="follow($event, row.href)">
                                <span class="min-w-0 truncate" :data-label-key="row.key"><span class="nbdev-secondary">{{ row.number }}</span> {{ row.title }}</span>
                            </a>
                        </Tooltip>
                    </div>
                </div>
            </div>
            <button v-if="works !== null && split.more.length > 0" type="button" class="nbdev-nav-item nbdev-nav-more mt-1 w-full" :aria-expanded="moreOpen" @click="moreOpen = !moreOpen">
                <span :class="moreOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5 shrink-0" aria-hidden="true" />
                <span class="min-w-0 truncate">{{ moreOpen ? "收起" : "更多" }} {{ split.more.length }} 个（完成、搁置或 {{ NAV_RECENT_DAYS }} 天没有更新）</span>
            </button>
        </div>
    </nav>
</template>

<style scoped>
.nbdev-nav-item {
    display: flex;
    min-height: 1.875rem;
    align-items: center;
    gap: 0.5rem;
    border-radius: var(--radius-control);
    padding: 0.25rem 0.5rem;
    color: var(--text-secondary);
    text-align: left;
}
.nbdev-nav-item:hover, .nbdev-nav-item:focus-visible {
    background: var(--bg-hover);
    color: var(--text-main);
}
.nbdev-nav-current {
    background: var(--accent-bg);
    color: var(--text-main);
}
.nbdev-nav-ancestor {
    color: var(--text-main);
    background: color-mix(in srgb, var(--accent-bg) 45%, transparent);
}
.nbdev-nav-more {
    font-size: var(--text-xs);
}
.nbdev-nav-heading {
    padding: 0 0.5rem 0.25rem;
    font-size: var(--text-2xs);
    color: var(--text-secondary);
}
.nbdev-nav-toggle {
    display: inline-flex;
    width: 1.25rem;
    height: 1.25rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-control);
    color: var(--text-muted);
}
.nbdev-nav-toggle:hover {
    background: var(--bg-hover);
}
</style>
