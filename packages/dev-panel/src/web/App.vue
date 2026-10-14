<script setup lang="ts">
import {Badge, Button, Drawer, FormInput, IconButton, Popover, Splitter, Tooltip, type SplitterGestureState, type SplitterPanelConfig} from "@notnotype/nb-ui/components";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {RouterLink, RouterView, useRoute, useRouter} from "vue-router";
import {relativeTime} from "./host/format.js";
import {pageKey} from "./host/routes.js";
import {confirmRelogin, panelState, startPanelData, stopPanelData, useResource} from "./host/panel-data.js";
import {readAppearance, readNavCollapsed, readNavOpen, readNavWidth, writeAppearance, writeNavCollapsed, writeNavOpen, writeNavWidth, type Appearance} from "./host/prefs.js";
import {applyAppearance, followSystem} from "./host/theme.js";
import {attentionCount} from "./host/notify-actions.js";
import {wantsSearchFocus} from "./host/shortcuts.js";
import PanelNav from "./parts/PanelNav.vue";
import type {Meta, NotifyData, Overview} from "./host/types.js";

/**
 * 外壳：左栏（`PanelNav`）、顶栏（搜索、数据新旧、代码已更新、通知要处理的计数、审计、herdr、明暗）、页面。
 * 外壳与页面按组件规范豁免（它们是宿主）；左栏的展开、宽度、收起与明暗经 host/prefs.ts 记住。
 * 左栏与正文是 nb-ui 的 `Splitter` 的两块面板（t15 阶段 2c）：可拖宽度、可收起；窄于 1024px 时同一个 Splitter 把左栏收成 0、禁用拖动，
 * 导航改由抽屉显示。面板按 id 渲染，断点来回切换时正文（RouterView 与页面实例）不重挂。
 */
startPanelData();
onBeforeUnmount(stopPanelData);
const route = useRoute();
const router = useRouter();
const overview = useResource<Overview>(() => "/api/overview", ["records", "activity"]);
const meta = useResource<Meta>(() => "/api/meta", ["records", "activity", "sessions", "notify"]);
const notify = useResource<NotifyData>(() => "/api/notify", ["notify"]);
const attention = computed(() => attentionCount(notify.data.value));
/** 代码更新之后怎么重启：作为服务运行时给 systemctl 命令（不放重启按钮：面板不经 HTTP 结束自己）。 */
const restartHint = computed(() => {
    const command = meta.data.value?.service.restartCommand;
    return command ? `代码已更新：运行 ${command} 后生效` : "代码已更新：在终端重启 nbdev panel serve 后生效";
});

/** 登录失效的提示：出现时把焦点放进去；“我已重新登录”重探之后解除，失败写明原因。 */
const authDialog = ref<HTMLElement | null>(null);
const relogging = ref(false);
const reloginError = ref<string | null>(null);
watch(() => panelState.unauthorized, (lost) => {
    reloginError.value = null;
    if (lost) void nextTick(() => authDialog.value?.querySelector("button")?.focus());
});
async function relogin(): Promise<void> {
    relogging.value = true;
    try {
        reloginError.value = await confirmRelogin();
    } finally {
        relogging.value = false;
    }
}

const appearance = ref<Appearance>(readAppearance());
const appearanceLabel = computed(() => ({system: "明暗：跟随系统", light: "明暗：亮", dark: "明暗：暗"})[appearance.value]);
function cycleAppearance(): void {
    appearance.value = appearance.value === "system" ? "light" : appearance.value === "light" ? "dark" : "system";
    writeAppearance(appearance.value);
    applyAppearance(appearance.value);
}
let unfollow: () => void = () => undefined;
onMounted(() => {
    unfollow = followSystem(() => appearance.value);
});
onBeforeUnmount(() => unfollow());

const navOpen = ref<Record<string, boolean>>(readNavOpen());
function toggleWork(workId: string, open: boolean): void {
    navOpen.value = {...navOpen.value, [workId]: open};
    writeNavOpen(navOpen.value);
}
/** 导航的“当前页”：路径不含查询参数；Work 级产物的 taskId 写成 `-`，不算 Task。 */
const navCurrent = computed(() => {
    const one = (value: unknown) => (typeof value === "string" ? value : null);
    const taskId = one(route.params.taskId);
    return {path: route.path, workId: one(route.params.workId), taskId: taskId === "-" ? null : taskId};
});
const drawerOpen = ref(false);

// ---- 左栏的宽度与收起（D4、决定点 7、8） ----
const viewportWidth = ref(window.innerWidth);
const onViewportResize = () => {
    viewportWidth.value = window.innerWidth;
};
onMounted(() => window.addEventListener("resize", onViewportResize));
onBeforeUnmount(() => window.removeEventListener("resize", onViewportResize));
/** 抽屉的断点是 lg（1024）：窄于它时左栏收进抽屉。会话页的“手机”判定（767px 或粗指针）管接管，与它分开。 */
const narrow = computed(() => viewportWidth.value < 1024);
watch(narrow, (value) => {
    if (!value) drawerOpen.value = false;
});
/** 面板 id 也是分隔线的可读名（Splitter 拿它拼“调整 导航 与 正文 的宽度”）。 */
const NAV = "导航";
const CONTENT = "正文";
const NAV_SLOT = `panel-${NAV}` as const;
const CONTENT_SLOT = `panel-${CONTENT}` as const;
/** 用户要的宽度：渲染前同步读出（免得刷新时先 300 再跳），拖完写回。窗口窄时由上限夹住，变宽时恢复到它。 */
const navWidth = ref(readNavWidth());
const navCollapsed = ref(readNavCollapsed());
type NavCollapse = NonNullable<SplitterPanelConfig["collapse"]>;
/**
 * 用 computed 生成：Splitter 未受控时，`panels` 换了对象就按 defaultSizePx 重新分配；模板里写字面量数组的话，外壳每 15 秒的
 * 时钟重渲染都会把左栏弹回缺省宽度。这里的值只随宽度、收起与视口变，重新分配是幂等的。
 */
const panels = computed<SplitterPanelConfig[]>(() => [
    {
        id: NAV,
        defaultSizePx: navWidth.value,
        minSizePx: 200,
        maxSizePx: Math.min(480, Math.floor(viewportWidth.value * 0.4)),
        sizing: "fixed",
        // 拖到最小宽度以内再过 80px 就收起，从收起处往外拖 80px 恢复（D4）。
        collapse: {collapsedSize: 0, restoreSize: navWidth.value, collapseThreshold: 80, expandThreshold: 80, collapsed: narrow.value || navCollapsed.value} satisfies NavCollapse,
    },
    {id: CONTENT, minSizePx: 360, sizing: "weight"},
]);
function setNavCollapsed(value: boolean): void {
    navCollapsed.value = value;
    writeNavCollapsed(value);
}
/** 拖完（或键盘调完）：收起状态要回写，否则下一次重新分配又展开；展开着时记下新宽度。 */
function onNavGestureEnd(state: SplitterGestureState): void {
    const collapsed = state.collapsed[NAV];
    if (collapsed !== undefined) setNavCollapsed(collapsed);
    const width = state.sizesPx[0];
    if (!navCollapsed.value && width !== undefined && width > 0) {
        navWidth.value = width;
        writeNavWidth(width);
    }
}
watch(() => route.fullPath, () => {
    drawerOpen.value = false;
});

const mainWritable = computed(() => meta.data.value?.mainWritable ?? null);
const navCounts = computed(() => ({inbox: overview.data.value?.inbox.length ?? 0, sessions: overview.data.value?.sessions.total, runs: overview.data.value?.runs}));
const navWritable = computed(() => (mainWritable.value ? {ok: mainWritable.value.ok, code: mainWritable.value.code} : null));

const query = ref(typeof route.query.q === "string" ? route.query.q : "");
watch(() => route.query.q, (value) => {
    if (typeof value === "string") query.value = value;
});
function submitSearch(): void {
    const q = query.value.trim();
    if (q.length >= 2) void router.push({name: "search", query: {q}});
}
/** `/` 与 Ctrl+K 聚焦搜索框（判定见 host/shortcuts.ts）：冒泡阶段监听，焦点在可编辑的地方或对话框里时不处理。 */
const searchForm = ref<HTMLFormElement | null>(null);
function onShortcut(event: KeyboardEvent): void {
    if (panelState.unauthorized) return;
    if (!wantsSearchFocus(event, event.target instanceof HTMLElement ? event.target : null)) return;
    const input = searchForm.value?.querySelector("input");
    if (!input) return;
    event.preventDefault();
    input.focus();
    input.select();
}
onMounted(() => document.addEventListener("keydown", onShortcut));
onBeforeUnmount(() => document.removeEventListener("keydown", onShortcut));

const tick = ref(Date.now());
const ticker = setInterval(() => {
    tick.value = Date.now();
}, 15_000);
onBeforeUnmount(() => clearInterval(ticker));
const freshness = computed(() => {
    void tick.value;
    const at = meta.data.value?.parts.records?.at;
    return at ? `${relativeTime(at)}读到` : "还没有读到";
});
const PART_LABEL: Record<string, string> = {records: "记录", activity: "活动"};

/**
 * 顶栏的状态点（t15 阶段 2d）：推送、herdr、数据新旧这几样正常时只是一个绿点，点开看详情；有一样不正常时点变黄，旁边写出是哪一样。
 */
type StatusLine = {label: string; text: string; ok: boolean};
const statusLines = computed<StatusLine[]>(() => {
    const connection = panelState.connection;
    const herdr = meta.data.value?.herdr;
    const lines: StatusLine[] = [
        {label: "推送", text: connection === "open" ? "已连接" : connection === "connecting" ? "正在连接" : "断开了，正在重连", ok: connection === "open"},
    ];
    if (herdr) lines.push({label: "herdr", text: !herdr.available ? `不可用${herdr.error ? `：${herdr.error}` : ""}` : herdr.mode === "subscribed" ? `已订阅${herdr.version ? `（${herdr.version}）` : ""}` : "轮询中", ok: herdr.available});
    lines.push({label: "数据", text: freshness.value, ok: true});
    return lines;
});
const statusProblem = computed(() => statusLines.value.find((line) => !line.ok) ?? null);
const statusLabel = computed(() => (statusProblem.value ? `状态：${statusProblem.value.label}${statusProblem.value.text}` : "状态：正常"));

/**
 * 顶栏下面的横幅（t15 阶段 2d）：要开发者做点什么、或者显示的东西可能不对的情形。正常时没有横幅。
 */
type Banner = {key: string; tone: "accent" | "danger" | "warning"; icon: string; text: string};
const banners = computed<Banner[]>(() => {
    const data = meta.data.value;
    const list: Banner[] = [];
    if (data?.codeChanged) list.push({key: "code", tone: "accent", icon: "i-lucide-refresh-cw", text: restartHint.value});
    if (data?.build.failed) list.push({key: "build", tone: "danger", icon: "i-lucide-triangle-alert", text: `前端构建失败，用的是旧版${data.build.message ? `：${data.build.message}` : ""}`});
    if (data && !data.audit.enabled) list.push({key: "audit", tone: "warning", icon: "i-lucide-shield-off", text: data.audit.reason === "not_initialized" ? "审计未开启：不发通知，也不能替你打字或按键。运行 bun run --cwd packages/dev-panel audit-init 开启" : `审计不可用：不发通知，也不能替你打字或按键。${data.audit.detail}`});
    for (const [name, part] of Object.entries(data?.parts ?? {})) {
        // 后台重算失败：服务端保留上一份，页面显示的就是它。
        if (part.error !== null) list.push({key: `part-${name}`, tone: "warning", icon: "i-lucide-history", text: `后台重算${PART_LABEL[name] ?? name}失败，显示的是上一份：${part.error}`});
    }
    return list;
});
const BANNER_COLOR: Record<Banner["tone"], string> = {accent: "var(--accent-main)", danger: "var(--status-danger)", warning: "var(--status-warning)"};
</script>

<template>
    <!-- 登录失效时页面不卸载（草稿、填了一半的答复都还在），盖一层提示、整个外壳 inert；重新登录后点按钮接着用（t15）。 -->
    <div v-if="panelState.unauthorized" class="fixed inset-0 z-50 flex items-center justify-center p-6" style="background: color-mix(in srgb, var(--bg-main) 75%, transparent)">
        <section ref="authDialog" role="alertdialog" aria-modal="true" aria-labelledby="auth-lost-title" aria-describedby="auth-lost-message" class="flex max-w-md flex-col gap-3 rounded-[var(--radius-panel)] p-5" style="background: var(--panel-surface); border: var(--border-w, 1px) solid var(--divider)">
            <h2 id="auth-lost-title" class="font-semibold">没有登录，或登录已失效</h2>
            <p id="auth-lost-message" style="color: var(--text-secondary)">在终端运行 <code>nbdev panel open</code>，用它给的一次性链接登录（在这个浏览器的另一个标签页里打开也行；面板重启后要重新登录）。这一页还开着，没保存的改动都在；登录后点下面的按钮接着用。</p>
            <p v-if="reloginError" role="status" style="color: var(--status-warning); font-size: var(--text-xs)">{{ reloginError }}</p>
            <Button variant="primary" :loading="relogging" @click="relogin">我已重新登录</Button>
        </section>
    </div>
    <Splitter class="h-full" :panels="panels" :sash-sizes="[narrow ? 0 : 1]" :disabled="narrow" :inert="panelState.unauthorized || undefined" @gesture-end="onNavGestureEnd">
        <template #[NAV_SLOT]>
            <aside class="h-full overflow-hidden" style="background: var(--sidebar-surface, var(--bg-sidebar))">
                <PanelNav :works="overview.data.value?.works ?? null" :current="navCurrent" :expanded="navOpen" :counts="navCounts" :writable="navWritable" @navigate="(href) => router.push(href)" @toggle="toggleWork">
                    <template #actions>
                        <Tooltip text="收起左栏"><IconButton icon-class="i-lucide-panel-left-close" aria-label="收起左栏" @click="setNavCollapsed(true)" /></Tooltip>
                    </template>
                </PanelNav>
            </aside>
        </template>
        <template #[CONTENT_SLOT]>
            <div class="flex h-full min-h-0 min-w-0 flex-col">
                <header class="flex min-w-0 flex-wrap items-center gap-2 border-b px-3 py-2" style="background: var(--toolbar-surface, var(--bg-main)); border-color: var(--divider)">
                    <IconButton v-if="narrow" icon-class="i-lucide-menu" aria-label="打开导航" @click="drawerOpen = true" />
                    <Tooltip v-else-if="navCollapsed" text="展开左栏"><IconButton icon-class="i-lucide-panel-left-open" aria-label="展开左栏" @click="setNavCollapsed(false)" /></Tooltip>
                    <form ref="searchForm" class="min-w-0 max-w-xl flex-1 basis-48" role="search" @submit.prevent="submitSearch">
                        <FormInput v-model="query" placeholder="搜索 Work、Task、产物、会话与文件（/ 或 Ctrl+K）" aria-label="搜索" aria-keyshortcuts="/ Control+K" />
                    </form>
                    <div class="ml-auto flex items-center gap-2" style="font-size: var(--text-xs); color: var(--text-secondary)">
                        <RouterLink v-if="attention > 0" to="/live/sessions#notify" aria-label="有要处理的通知，去会话页"><Badge tone="warning" variant="soft" size="sm" icon-class="i-lucide-bell">通知要处理 {{ attention }}</Badge></RouterLink>
                        <Popover side="bottom" align="end">
                            <template #trigger>
                                <button type="button" class="nbdev-status flex items-center gap-1.5 rounded-[var(--radius-control)] px-1.5 py-1" :aria-label="statusLabel">
                                    <span class="size-2 rounded-full" :style="{background: statusProblem ? 'var(--status-warning)' : 'var(--status-success)'}" aria-hidden="true" />
                                    <span v-if="statusProblem" style="color: var(--status-warning)">{{ statusProblem.label }}{{ statusProblem.text }}</span>
                                </button>
                            </template>
                            <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1" style="font-size: var(--text-xs)">
                                <template v-for="line in statusLines" :key="line.label">
                                    <dt style="color: var(--text-secondary)">{{ line.label }}</dt>
                                    <dd :style="{color: line.ok ? 'var(--text-main)' : 'var(--status-warning)'}">{{ line.text }}</dd>
                                </template>
                            </dl>
                        </Popover>
                        <Tooltip :text="appearanceLabel"><IconButton :icon-class="appearance === 'dark' ? 'i-lucide-moon' : appearance === 'light' ? 'i-lucide-sun' : 'i-lucide-sun-moon'" :aria-label="appearanceLabel" @click="cycleAppearance" /></Tooltip>
                    </div>
                </header>
                <div v-if="banners.length > 0" role="status" class="flex flex-col border-b" style="background: var(--bg-subtle); border-color: var(--divider); font-size: var(--text-xs)">
                    <p v-for="banner in banners" :key="banner.key" class="flex items-start gap-2 px-3 py-1.5">
                        <span :class="banner.icon" class="mt-0.5 size-3.5 shrink-0" :style="{color: BANNER_COLOR[banner.tone]}" aria-hidden="true" />
                        <span class="min-w-0 break-words" style="color: var(--text-main)">{{ banner.text }}</span>
                    </p>
                </div>
                <!-- 一页一个竖向滚动者：流式页面由 main 滚，铺满的页面（文档页）由它的分栏各自滚（路由元信息 layout）。 -->
                <main class="min-h-0 flex-1" :class="route.meta.layout === 'fill' ? 'overflow-hidden' : 'nbdev-scroll-y'">
                    <!-- 按路由名与路径参数重建页面实例，查询参数变化不重建（t15）。 -->
                    <RouterView v-slot="{Component, route: viewRoute}">
                        <component :is="Component" :key="pageKey(viewRoute)" />
                    </RouterView>
                </main>
            </div>
        </template>
    </Splitter>
    <Drawer v-model:open="drawerOpen" direction="left" title="导航">
        <PanelNav :works="overview.data.value?.works ?? null" :current="navCurrent" :expanded="navOpen" :counts="navCounts" :writable="navWritable" @navigate="(href) => router.push(href)" @toggle="toggleWork" />
    </Drawer>
</template>

<style scoped>
.nbdev-status:hover, .nbdev-status:focus-visible {
    background: var(--bg-hover);
}
</style>
