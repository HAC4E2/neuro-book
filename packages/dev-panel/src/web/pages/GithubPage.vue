<script setup lang="ts">
import {Badge, Button} from "@notnotype/nb-ui/components";
import {computed, onMounted, ref} from "vue";
import {useRouter} from "vue-router";
import {ApiError, sendJson} from "../host/api.js";
import {relativeTime} from "../host/format.js";
import {loadStateOf, useResource} from "../host/panel-data.js";
import type {GithubData} from "../host/types.js";
import IssueList from "../parts/IssueList.vue";
import LoadState from "../parts/LoadState.vue";
import PageShell from "../parts/PageShell.vue";
import PrList from "../parts/PrList.vue";

/**
 * GitHub 只读页（t14，Proposal 待决问题 12）：开着的 PR（检查结果）与 Issue，都链到 GitHub；没有任何写按钮。
 * 数据由面板在后台用 `gh` 取：打开页面时发一次“需要数据”（`ifStale`，到了间隔才取），有浏览器连着时每 5 分钟刷新；“刷新”立即取。
 * 取完之后经 `/ws` 推“github 变了”，页面只重取 `/api/github`（这个 GET 不触发取数，推送与取数不会互相引发）。
 */
const router = useRouter();
const github = useResource<GithubData>(() => "/api/github", ["github"]);
const data = computed(() => github.data.value);
const pending = ref(false);
const refreshError = ref<string | null>(null);
async function refresh(): Promise<void> {
    pending.value = true;
    refreshError.value = null;
    try {
        await sendJson<GithubData>("POST", "/api/github/refresh", {});
    } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        refreshError.value = error.message;
    } finally {
        pending.value = false;
    }
}
onMounted(() => {
    void sendJson<GithubData>("POST", "/api/github/refresh", {ifStale: true}).catch((error: unknown) => {
        if (!(error instanceof ApiError)) throw error;
        refreshError.value = error.message;
    });
});
const STATE: Record<GithubData["state"], {label: string; tone: "success" | "warning" | "danger" | "neutral"}> = {
    idle: {label: "还没取", tone: "neutral"}, ok: {label: "最新", tone: "success"}, stale: {label: "旧数据", tone: "warning"},
    unavailable: {label: "没有 gh", tone: "warning"}, not_logged_in: {label: "gh 没登录", tone: "warning"}, error: {label: "取不到", tone: "danger"},
};
</script>

<template>
    <PageShell :crumbs="[{label: '首页', href: '/'}, {label: 'GitHub'}]" title="GitHub" @navigate="(href) => void router.push(href)">
        <template v-if="data" #status><Badge :tone="STATE[data.state].tone" variant="soft" size="sm">{{ STATE[data.state].label }}</Badge></template>
        <template #actions>
            <Button size="sm" variant="secondary" icon-class="i-lucide-refresh-cw" :loading="pending || data?.refreshing === true" @click="refresh">刷新</Button>
        </template>
        <template v-if="data?.at" #meta><span>{{ relativeTime(data.at) }}取的</span></template>
        <LoadState v-bind="loadStateOf(github)" label="正在读取" @retry="github.reload()" />
        <template v-if="data">
            <p v-if="data.error" class="nbdev-small" :class="data.state === 'stale' ? 'nbdev-secondary' : 'nbdev-warn'">{{ data.state === "stale" ? `这次没取到，显示的是 ${relativeTime(data.at!)}的数据：` : "" }}{{ data.error }}</p>
            <p v-if="refreshError" class="nbdev-warn nbdev-small">{{ refreshError }}</p>
            <p v-if="data.state === 'idle' || (data.refreshing && !data.at)" class="nbdev-empty">正在取……</p>
            <template v-if="data.at">
                <section class="nbdev-stack" aria-label="开着的 PR">
                    <h2 class="nbdev-heading">开着的 PR（{{ data.prs.length }}）</h2>
                    <p v-if="data.truncated.prs" class="nbdev-note">只列最近更新的 {{ data.prs.length }} 个，可能还有更多</p>
                    <PrList :prs="data.prs" @navigate="(href) => void router.push(href)" />
                </section>
                <section class="nbdev-stack" aria-label="开着的 Issue">
                    <h2 class="nbdev-heading">开着的 Issue（{{ data.issues.length }}）</h2>
                    <p v-if="data.truncated.issues" class="nbdev-note">只列最近更新的 {{ data.issues.length }} 个，可能还有更多</p>
                    <IssueList :issues="data.issues" />
                </section>
            </template>
        </template>
    </PageShell>
</template>
