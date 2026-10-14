<script setup lang="ts">
import {Badge, Button} from "@notnotype/nb-ui/components";
import {computed, onMounted, ref} from "vue";
import {useRouter} from "vue-router";
import {ApiError, sendJson} from "../host/api.js";
import {relativeTime} from "../host/format.js";
import {useResource} from "../host/panel-data.js";
import type {GithubData} from "../host/types.js";
import IssueList from "../parts/IssueList.vue";
import LoadState from "../parts/LoadState.vue";
import PrList from "../parts/PrList.vue";
import StaleNotice from "../parts/StaleNotice.vue";

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
    <div class="mx-auto flex w-full max-w-[90rem] flex-col gap-5 p-4 md:p-6">
        <div class="flex flex-wrap items-center gap-2">
            <h1 class="font-semibold" style="font-size: var(--text-xl)">GitHub</h1>
            <Badge v-if="data" :tone="STATE[data.state].tone" variant="soft" size="sm">{{ STATE[data.state].label }}</Badge>
            <span v-if="data?.at" style="color: var(--text-muted); font-size: var(--text-xs)">{{ relativeTime(data.at) }}取的</span>
            <Button class="ml-auto" size="sm" variant="secondary" icon-class="i-lucide-refresh-cw" :loading="pending || data?.refreshing === true" @click="refresh">刷新</Button>
        </div>
        <StaleNotice v-if="github.stale.value" :error="github.error.value!" :received-at="github.receivedAt.value" @retry="github.reload()" />
        <LoadState v-if="!data" :loading="github.loading.value" :error="github.error.value" label="正在读取" @retry="github.reload()" />
        <template v-else>
            <p v-if="data.error" :style="{color: data.state === 'stale' ? 'var(--text-secondary)' : 'var(--status-warning)', fontSize: 'var(--text-xs)'}">{{ data.state === "stale" ? `这次没取到，显示的是 ${relativeTime(data.at!)}的数据：` : "" }}{{ data.error }}</p>
            <p v-if="refreshError" style="color: var(--status-warning); font-size: var(--text-xs)">{{ refreshError }}</p>
            <p v-if="data.state === 'idle' || (data.refreshing && !data.at)" style="color: var(--text-muted)">正在取……</p>
            <template v-if="data.at">
                <section class="flex flex-col gap-2" aria-label="开着的 PR">
                    <h2 class="font-semibold">开着的 PR（{{ data.prs.length }}）</h2>
                    <p v-if="data.truncated.prs" style="color: var(--text-muted); font-size: var(--text-xs)">只列最近更新的 {{ data.prs.length }} 个，可能还有更多</p>
                    <PrList :prs="data.prs" @navigate="(href) => void router.push(href)" />
                </section>
                <section class="flex flex-col gap-2" aria-label="开着的 Issue">
                    <h2 class="font-semibold">开着的 Issue（{{ data.issues.length }}）</h2>
                    <p v-if="data.truncated.issues" style="color: var(--text-muted); font-size: var(--text-xs)">只列最近更新的 {{ data.issues.length }} 个，可能还有更多</p>
                    <IssueList :issues="data.issues" />
                </section>
            </template>
        </template>
    </div>
</template>
