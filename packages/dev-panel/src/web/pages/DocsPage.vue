<script setup lang="ts">
import {Badge, Switch} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";
import {useRoute, useRouter} from "vue-router";
import {relativeDay} from "../host/format.js";
import {renderMarkdown} from "../host/markdown.js";
import {useResource} from "../host/panel-data.js";
import {editHref} from "../host/routes.js";
import type {DocFileData, DocTreeData, Meta} from "../host/types.js";
import CheckoutSwitch from "../parts/CheckoutSwitch.vue";
import DocTree from "../parts/DocTree.vue";
import LoadState from "../parts/LoadState.vue";
import MarkdownView from "../parts/MarkdownView.vue";
import StaleNotice from "../parts/StaleNotice.vue";

/**
 * 文档页（t03 第二轮文档页）：左边按类型的树，顶部切 checkout（缺省主工作区；从 Task 进入时是它的执行 checkout，`prefer` 带上候选），
 * 不是主工作区时标出来并列出与 master 的差异；右边渲染 Markdown，frontmatter 变成徽章，带最近的改动与哪些分支改了它。
 */
const route = useRoute();
const router = useRouter();
const checkout = computed(() => (typeof route.query.checkout === "string" ? route.query.checkout : "main"));
const path = computed(() => (typeof route.query.path === "string" ? route.query.path : null));
const prefer = computed(() => (typeof route.query.prefer === "string" ? route.query.prefer.split(",").filter(Boolean) : []));
const tree = useResource<DocTreeData>(() => `/api/docs/tree?checkout=${encodeURIComponent(checkout.value)}`, ["records"]);
const file = useResource<DocFileData>(() => (path.value ? `/api/docs/file?checkout=${encodeURIComponent(checkout.value)}&path=${encodeURIComponent(path.value)}` : null), ["records"]);
const meta = useResource<Meta>(() => "/api/meta", ["records"]);
/** 文档找不到（404）时回到同一 checkout 的文档树。 */
const treeHref = computed(() => `/docs?checkout=${encodeURIComponent(checkout.value)}`);
const changedOnly = ref(false);

const html = computed(() => (file.data.value ? renderMarkdown(file.data.value.body, {checkoutKey: checkout.value, path: file.data.value.path, artifactBase: meta.data.value?.artifactBase ?? null}) : ""));
const otherBranches = computed(() => (file.data.value?.changedIn ?? []).filter((key) => key !== checkout.value));
const frontmatter = computed(() => Object.entries(file.data.value?.frontmatter ?? {}).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value)).slice(0, 8));

function go(query: Record<string, string | undefined>): void {
    void router.push({name: "docs", query: Object.fromEntries(Object.entries({...route.query, ...query}).filter(([, value]) => value !== undefined)) as Record<string, string>});
}
</script>

<template>
    <!-- 铺满型页面（路由 layout: fill）：宽屏上树与正文各自滚动；窄屏上下堆叠，整页由根滚动，仍只有一个竖向滚动者。 -->
    <div class="grid h-full min-h-0 grid-cols-1 overflow-y-auto [scrollbar-gutter:stable] md:grid-cols-[18rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden md:[scrollbar-gutter:auto]">
        <aside class="flex min-h-0 flex-col gap-3 border-b p-3 md:overflow-y-auto md:border-b-0 md:border-r md:[scrollbar-gutter:stable]" style="border-color: var(--divider)" aria-label="文档树">
            <CheckoutSwitch v-if="tree.data.value" :checkouts="tree.data.value.checkouts" :model-value="checkout" :preferred="prefer" @update:model-value="(key) => go({checkout: key})" />
            <div v-if="tree.data.value && !tree.data.value.checkout.isMain" class="flex flex-col gap-1.5" style="font-size: var(--text-xs)">
                <p style="color: var(--text-secondary)">与主工作区（master）的差异 {{ tree.data.value.changes.length }} 处</p>
                <label class="flex items-center gap-2"><Switch v-model="changedOnly" aria-label="只看有差异的" />只看有差异的</label>
            </div>
            <StaleNotice v-if="tree.stale.value" :error="tree.error.value!" :received-at="tree.receivedAt.value" @retry="tree.reload()" />
            <LoadState v-if="!tree.data.value" :loading="tree.loading.value" :error="tree.error.value" label="正在读取文档树" @retry="tree.reload()" />
            <DocTree v-else :docs="tree.data.value.docs" :changes="tree.data.value.changes" :selected="path" :changed-only="changedOnly" @open="(value) => go({path: value})" />
        </aside>
        <section class="min-h-0 min-w-0 p-4 md:overflow-y-auto md:p-6 md:[scrollbar-gutter:stable]">
            <StaleNotice v-if="file.stale.value" :error="file.error.value!" :received-at="file.receivedAt.value" :up-href="treeHref" up-label="回到文档树" @navigate="(href) => router.push(href)" @retry="file.reload()" />
            <p v-if="!path" style="color: var(--text-muted)">在左边选一份文档</p>
            <LoadState v-else-if="!file.data.value" :loading="file.loading.value" :error="file.error.value" label="正在读取文档" @retry="file.reload()" />
            <article v-else class="flex flex-col gap-3">
                <div class="flex flex-wrap items-center gap-2" style="font-size: var(--text-xs); color: var(--text-secondary)">
                    <code>{{ file.data.value.path }}</code>
                    <Badge v-if="!file.data.value.checkout.isMain" tone="warning" variant="soft" size="sm">{{ file.data.value.checkout.key }}（{{ file.data.value.checkout.branch ?? "分离 HEAD" }}）</Badge>
                    <Badge v-for="[key, value] in frontmatter" :key="key" tone="neutral" variant="outline" size="sm">{{ key }}：{{ value }}</Badge>
                    <!-- 只编辑主工作区的文件：worktree 的暂存区与分支属于别的会话，面板的写事务管不到。能不能改以编辑页的判定为准。 -->
                    <RouterLink v-if="file.data.value.checkout.isMain && meta.data.value?.mainWritable.ok" class="ml-auto" :to="editHref(file.data.value.path)">编辑</RouterLink>
                </div>
                <p v-if="otherBranches.length > 0" style="font-size: var(--text-xs); color: var(--status-warning)">
                    {{ file.data.value.checkout.isMain ? "这些分支改了它" : "别的分支也改了它" }}：<button v-for="key in otherBranches" :key="key" type="button" class="mr-2 underline" @click="go({checkout: key})">{{ key }}</button>
                </p>
                <MarkdownView :html="html" @navigate="(href) => router.push(href)" />
                <section v-if="file.data.value.recent.length > 0" class="flex flex-col gap-1 border-t pt-3" style="border-color: var(--divider); font-size: var(--text-xs)">
                    <h2 class="font-semibold">最近的改动</h2>
                    <ol class="flex flex-col gap-0.5">
                        <li v-for="commit in file.data.value.recent" :key="commit.sha" class="flex min-w-0 gap-2">
                            <code style="color: var(--text-muted)">{{ commit.sha.slice(0, 9) }}</code><span class="min-w-0 flex-1 truncate">{{ commit.subject }}</span><span style="color: var(--text-secondary)">{{ relativeDay(commit.date) }}</span>
                        </li>
                    </ol>
                </section>
            </article>
        </section>
    </div>
</template>
