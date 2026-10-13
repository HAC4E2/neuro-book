<script setup lang="ts">
import {Badge, Button, Drawer, FormInput, IconButton, Tooltip} from "@notnotype/nb-ui/components";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {RouterLink, RouterView, useRoute, useRouter} from "vue-router";
import {relativeTime, taskLabel, workLabel} from "./host/format.js";
import {pageKey} from "./host/routes.js";
import {confirmRelogin, panelState, startPanelData, stopPanelData, useResource} from "./host/panel-data.js";
import {readAppearance, readNavOpen, writeAppearance, writeNavOpen, type Appearance} from "./host/prefs.js";
import {applyAppearance, followSystem} from "./host/theme.js";
import {attentionCount} from "./host/notify-actions.js";
import type {Meta, NotifyData, Overview} from "./host/types.js";

/**
 * 外壳：左栏（首页与收件箱、工作的 Work › Task 树、产物、文档、现场）、顶栏（搜索、数据新旧、代码已更新、通知要处理的计数、审计、herdr、明暗）、页面。
 * 外壳与页面按组件规范豁免（它们是宿主）；左栏的展开与明暗经 host/prefs.ts 记住。390 宽时左栏收进抽屉。
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
function toggleWork(workId: string): void {
    navOpen.value = {...navOpen.value, [workId]: !(navOpen.value[workId] ?? false)};
    writeNavOpen(navOpen.value);
}
const drawerOpen = ref(false);
watch(() => route.fullPath, () => {
    drawerOpen.value = false;
});

const mainWritable = computed(() => meta.data.value?.mainWritable ?? null);
const navWorks = computed(() => (overview.data.value?.works ?? []).filter((work) => work.status.value === null || work.status.value === "active"));
const inboxCount = computed(() => overview.data.value?.inbox.length ?? 0);

const query = ref(typeof route.query.q === "string" ? route.query.q : "");
watch(() => route.query.q, (value) => {
    if (typeof value === "string") query.value = value;
});
function submitSearch(): void {
    const q = query.value.trim();
    if (q.length >= 2) void router.push({name: "search", query: {q}});
}

const tick = ref(Date.now());
const ticker = setInterval(() => {
    tick.value = Date.now();
}, 15_000);
onBeforeUnmount(() => clearInterval(ticker));
const freshness = computed(() => {
    void tick.value;
    const at = meta.data.value?.parts.records?.at;
    return at ? `数据 ${relativeTime(at)}` : "数据还没有读到";
});
const herdrLabel = computed(() => {
    const herdr = meta.data.value?.herdr;
    if (!herdr) return null;
    if (!herdr.available) return {text: "herdr 不可用", tone: "warning" as const};
    return {text: herdr.mode === "subscribed" ? "herdr 已订阅" : "herdr 轮询中", tone: "neutral" as const};
});
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
    <div class="grid h-full grid-cols-1 md:grid-cols-[15.5rem_minmax(0,1fr)]" :inert="panelState.unauthorized || undefined">
        <aside class="hidden min-h-0 flex-col overflow-y-auto border-r md:flex" style="background: var(--sidebar-surface, var(--bg-sidebar)); border-color: var(--divider)" aria-label="面板导航">
            <nav class="flex flex-col gap-4 p-3">
                <RouterLink to="/" class="flex items-center gap-2 px-2 font-semibold"><span class="i-lucide-layout-dashboard size-4" aria-hidden="true" />nbdev 面板</RouterLink>
                <section class="flex flex-col gap-0.5">
                    <RouterLink to="/" class="nav-item" exact-active-class="nav-active"><span class="i-lucide-inbox size-4" aria-hidden="true" />首页与收件箱<Badge v-if="inboxCount > 0" tone="warning" variant="soft" size="sm" class="ml-auto">{{ inboxCount }}</Badge></RouterLink>
                </section>
                <section class="flex flex-col gap-0.5" aria-label="工作">
                    <h2 class="nav-heading">工作</h2>
                    <div v-for="work in navWorks" :key="work.workId" class="flex flex-col">
                        <div class="flex items-center">
                            <button type="button" class="nav-toggle" :aria-expanded="navOpen[work.workId] ?? false" :aria-label="`展开 ${work.workId} 的 Task`" @click="toggleWork(work.workId)">
                                <span :class="navOpen[work.workId] ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5" aria-hidden="true" />
                            </button>
                            <RouterLink :to="`/work/${work.workId}`" class="nav-item min-w-0 flex-1" active-class="nav-active"><span class="truncate"><span style="color: var(--text-muted)">{{ workLabel(work.workId) }}</span> {{ work.title ?? work.workId }}</span></RouterLink>
                        </div>
                        <div v-if="navOpen[work.workId]" class="ml-5 flex flex-col">
                            <RouterLink v-for="task in work.tasks" :key="task.taskId" :to="`/work/${work.workId}/task/${task.taskId}`" class="nav-item" active-class="nav-active">
                                <span class="truncate"><span style="color: var(--text-muted)">{{ taskLabel(task.taskId) }}</span> {{ task.title ?? task.taskId }}</span>
                            </RouterLink>
                        </div>
                    </div>
                    <p v-if="overview.data.value && navWorks.length === 0" class="px-2" style="color: var(--text-muted); font-size: var(--text-xs)">没有进行中或未标的 Work</p>
                </section>
                <section class="flex flex-col gap-0.5">
                    <RouterLink v-if="mainWritable?.ok" to="/new" class="nav-item" active-class="nav-active"><span class="i-lucide-plus size-4" aria-hidden="true" />新建 Work 或 Task</RouterLink>
                    <p v-else-if="mainWritable" class="px-2" style="color: var(--text-muted); font-size: var(--text-xs)">主工作区现在不能写（{{ mainWritable.code }}），写入口已隐藏</p>
                </section>
                <section class="flex flex-col gap-0.5">
                    <h2 class="nav-heading">资料</h2>
                    <RouterLink to="/artifacts" class="nav-item" active-class="nav-active"><span class="i-lucide-files size-4" aria-hidden="true" />产物</RouterLink>
                    <RouterLink to="/docs" class="nav-item" active-class="nav-active"><span class="i-lucide-book-open size-4" aria-hidden="true" />文档</RouterLink>
                </section>
                <section class="flex flex-col gap-0.5">
                    <h2 class="nav-heading">现场</h2>
                    <RouterLink to="/live/sessions" class="nav-item" active-class="nav-active"><span class="i-lucide-terminal size-4" aria-hidden="true" />会话<span v-if="overview.data.value" class="ml-auto" style="color: var(--text-muted); font-size: var(--text-xs)">{{ overview.data.value.sessions.total }}</span></RouterLink>
                    <RouterLink to="/live/runs" class="nav-item" active-class="nav-active"><span class="i-lucide-activity size-4" aria-hidden="true" />在跑<span v-if="overview.data.value" class="ml-auto" style="color: var(--text-muted); font-size: var(--text-xs)">{{ overview.data.value.runs }}</span></RouterLink>
                    <RouterLink to="/live/checkouts" class="nav-item" active-class="nav-active"><span class="i-lucide-git-fork size-4" aria-hidden="true" />checkout</RouterLink>
                    <RouterLink to="/live/github" class="nav-item" active-class="nav-active"><span class="i-lucide-git-pull-request size-4" aria-hidden="true" />GitHub</RouterLink>
                </section>
            </nav>
        </aside>
        <div class="flex min-h-0 min-w-0 flex-col">
            <header class="flex min-w-0 flex-wrap items-center gap-2 border-b px-3 py-2" style="background: var(--toolbar-surface, var(--bg-main)); border-color: var(--divider)">
                <IconButton class="md:hidden" icon-class="i-lucide-menu" aria-label="打开导航" @click="drawerOpen = true" />
                <form class="min-w-0 flex-1 basis-48" role="search" @submit.prevent="submitSearch">
                    <FormInput v-model="query" placeholder="搜索 Work、Task、产物、会话与 checkout 里的文件" aria-label="搜索" />
                </form>
                <div class="flex flex-wrap items-center gap-2" style="font-size: var(--text-xs); color: var(--text-secondary)">
                    <Badge v-if="meta.data.value?.codeChanged" tone="accent" variant="soft" size="sm" icon-class="i-lucide-refresh-cw">{{ restartHint }}</Badge>
                    <RouterLink v-if="attention > 0" to="/live/sessions#notify" aria-label="有要处理的通知，去会话页"><Badge tone="warning" variant="soft" size="sm" icon-class="i-lucide-bell">通知要处理 {{ attention }}</Badge></RouterLink>
                    <Tooltip v-if="meta.data.value && !meta.data.value.audit.enabled" :text="meta.data.value.audit.reason === 'not_initialized' ? '不发通知，也不能替你打字或按键：运行 bun run --cwd packages/dev-panel audit-init' : `不发通知，也不能替你打字或按键：${meta.data.value.audit.detail}`"><Badge tone="neutral" variant="outline" size="sm">审计未开启</Badge></Tooltip>
                    <Badge v-if="meta.data.value?.build.failed" tone="danger" variant="soft" size="sm">前端构建失败，用的是旧版</Badge>
                    <Badge v-if="panelState.connection !== 'open'" tone="warning" variant="soft" size="sm">{{ panelState.connection === "connecting" ? "正在连接" : "推送断开，正在重连" }}</Badge>
                    <Badge v-if="herdrLabel" :tone="herdrLabel.tone" variant="outline" size="sm">{{ herdrLabel.text }}</Badge>
                    <span>{{ freshness }}</span>
                    <Tooltip :text="appearanceLabel"><IconButton :icon-class="appearance === 'dark' ? 'i-lucide-moon' : appearance === 'light' ? 'i-lucide-sun' : 'i-lucide-sun-moon'" :aria-label="appearanceLabel" @click="cycleAppearance" /></Tooltip>
                </div>
            </header>
            <main class="min-h-0 flex-1 overflow-y-auto">
                <!-- 按路由名与路径参数重建页面实例，查询参数变化不重建（t15）。 -->
                <RouterView v-slot="{Component, route: viewRoute}">
                    <component :is="Component" :key="pageKey(viewRoute)" />
                </RouterView>
            </main>
        </div>
        <Drawer v-model:open="drawerOpen" direction="left" title="导航">
            <nav class="flex flex-col gap-1 p-2" aria-label="面板导航">
                <RouterLink to="/" class="nav-item">首页与收件箱<Badge v-if="inboxCount > 0" tone="warning" variant="soft" size="sm" class="ml-auto">{{ inboxCount }}</Badge></RouterLink>
                <RouterLink v-for="work in navWorks" :key="work.workId" :to="`/work/${work.workId}`" class="nav-item"><span class="truncate"><span style="color: var(--text-muted)">{{ workLabel(work.workId) }}</span> {{ work.title ?? work.workId }}</span></RouterLink>
                <RouterLink v-if="mainWritable?.ok" to="/new" class="nav-item">新建 Work 或 Task</RouterLink>
                <RouterLink to="/artifacts" class="nav-item">产物</RouterLink>
                <RouterLink to="/docs" class="nav-item">文档</RouterLink>
                <RouterLink to="/live/sessions" class="nav-item">会话</RouterLink>
                <RouterLink to="/live/runs" class="nav-item">在跑</RouterLink>
                <RouterLink to="/live/checkouts" class="nav-item">checkout</RouterLink>
                <RouterLink to="/live/github" class="nav-item">GitHub</RouterLink>
            </nav>
        </Drawer>
    </div>
</template>

<style scoped>
.nav-item {
    display: flex;
    min-height: 1.875rem;
    align-items: center;
    gap: 0.5rem;
    border-radius: var(--radius-control);
    padding: 0.25rem 0.5rem;
    color: var(--text-secondary);
}
.nav-item:hover, .nav-item:focus-visible {
    background: var(--bg-hover);
    color: var(--text-main);
}
.nav-active {
    background: var(--accent-bg);
    color: var(--text-main);
}
.nav-heading {
    padding: 0 0.5rem 0.25rem;
    font-size: var(--text-2xs);
    color: var(--text-muted);
}
.nav-toggle {
    display: inline-flex;
    width: 1.25rem;
    height: 1.25rem;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-control);
    color: var(--text-muted);
}
.nav-toggle:hover {
    background: var(--bg-hover);
}
</style>
