<script setup lang="ts">
import {Badge, Switch} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";
import {useRoute, useRouter} from "vue-router";
import {relativeDay} from "../host/format.js";
import {renderMarkdown} from "../host/markdown.js";
import {loadStateOf, useResource} from "../host/panel-data.js";
import {editHref} from "../host/routes.js";
import type {DocFileData, DocTreeData, Meta} from "../host/types.js";
import ActionLink from "../parts/ActionLink.vue";
import CheckoutSwitch from "../parts/CheckoutSwitch.vue";
import DocTree from "../parts/DocTree.vue";
import LoadState from "../parts/LoadState.vue";
import MarkdownView from "../parts/MarkdownView.vue";
import PageShell from "../parts/PageShell.vue";
import TruncatedText from "../parts/TruncatedText.vue";

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

/** 文档开头的一级标题当页标题（页头已经是 h1，正文里不再重复）；没有就用文件名。 */
const LEADING_H1 = /^\s*# (.+)\n?/u;
const docTitle = computed(() => {
    const data = file.data.value;
    if (!data) return path.value ? path.value.slice(path.value.lastIndexOf("/") + 1) : "文档";
    return LEADING_H1.exec(data.body)?.[1]?.trim() ?? data.path.slice(data.path.lastIndexOf("/") + 1);
});
const html = computed(() => (file.data.value ? renderMarkdown(file.data.value.body.replace(LEADING_H1, ""), {checkoutKey: checkout.value, path: file.data.value.path, artifactBase: meta.data.value?.artifactBase ?? null}) : ""));
const crumbs = computed(() => [{label: "首页", href: "/"}, {label: "文档", href: treeHref.value}, ...(path.value ? [{label: path.value.slice(path.value.lastIndexOf("/") + 1)}] : [])]);
const navigate = (href: string) => void router.push(href);
const otherBranches = computed(() => (file.data.value?.changedIn ?? []).filter((key) => key !== checkout.value));
const frontmatter = computed(() => Object.entries(file.data.value?.frontmatter ?? {}).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value)).slice(0, 8));

function go(query: Record<string, string | undefined>): void {
    void router.push({name: "docs", query: Object.fromEntries(Object.entries({...route.query, ...query}).filter(([, value]) => value !== undefined)) as Record<string, string>});
}
</script>

<template>
    <!-- 铺满型页面（路由 layout: fill）：宽屏上树与正文各自滚动；窄屏上下堆叠，整页由根滚动，仍只有一个竖向滚动者。 -->
    <div class="grid h-full min-h-0 grid-cols-1 overflow-y-auto [scrollbar-gutter:stable] md:grid-cols-[18rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden md:[scrollbar-gutter:auto]">
        <aside class="nbdev-stack nbdev-divider min-h-0 gap-3 border-b p-3 md:overflow-y-auto md:border-b-0 md:border-r md:[scrollbar-gutter:stable]" aria-label="文档树">
            <CheckoutSwitch v-if="tree.data.value" :checkouts="tree.data.value.checkouts" :model-value="checkout" :preferred="prefer" @update:model-value="(key) => go({checkout: key})" />
            <div v-if="tree.data.value && !tree.data.value.checkout.isMain" class="nbdev-stack-tight nbdev-small">
                <p class="nbdev-secondary">与主工作区（master）的差异 {{ tree.data.value.changes.length }} 处</p>
                <label class="flex items-center gap-2"><Switch v-model="changedOnly" aria-label="只看有差异的" />只看有差异的</label>
            </div>
            <LoadState v-bind="loadStateOf(tree)" label="正在读取文档树" @retry="tree.reload()" />
            <DocTree v-if="tree.data.value" :docs="tree.data.value.docs" :changes="tree.data.value.changes" :selected="path" :changed-only="changedOnly" @open="(value) => go({path: value})" />
        </aside>
        <!-- 正文一栏套 PageShell 的阅读档：Markdown 按阅读宽度收窄并居中，右边不再空一片。 -->
        <section class="min-h-0 min-w-0 md:overflow-y-auto md:[scrollbar-gutter:stable]">
            <PageShell width="reading" :crumbs="crumbs" :title="docTitle" @navigate="navigate">
                <template v-if="file.data.value" #actions>
                    <!-- 只编辑主工作区的文件：worktree 的暂存区与分支属于别的会话，面板的写事务管不到。能不能改以编辑页的判定为准。 -->
                    <ActionLink v-if="file.data.value.checkout.isMain && meta.data.value?.mainWritable.ok" :href="editHref(file.data.value.path)" icon="i-lucide-pencil" @navigate="navigate">编辑</ActionLink>
                </template>
                <template v-if="file.data.value" #meta>
                    <TruncatedText :text="file.data.value.path" mono />
                    <Badge v-if="!file.data.value.checkout.isMain" tone="warning" variant="soft" size="sm">{{ file.data.value.checkout.key }}（{{ file.data.value.checkout.branch ?? "分离 HEAD" }}）</Badge>
                    <Badge v-for="[key, value] in frontmatter" :key="key" tone="neutral" variant="outline" size="sm">{{ key }}：{{ value }}</Badge>
                </template>
                <!-- 阅读档的宽度由正文里定宽的东西撑开：没选文档、加载、出错时也放在同一个阅读栏里，数据到了标题不横移。 -->
                <div class="nbdev-stack nbdev-reading-column">
                    <p v-if="!path" class="nbdev-empty">在左边选一份文档</p>
                    <LoadState v-else v-bind="loadStateOf(file)" label="正在读取文档" :up-href="treeHref" up-label="回到文档树" @navigate="navigate" @retry="file.reload()" />
                    <article v-if="path && file.data.value" class="nbdev-stack">
                        <p v-if="otherBranches.length > 0" class="nbdev-warn nbdev-small">
                            {{ file.data.value.checkout.isMain ? "这些分支改了它" : "别的分支也改了它" }}：<button v-for="key in otherBranches" :key="key" type="button" class="mr-2 underline" @click="go({checkout: key})">{{ key }}</button>
                        </p>
                        <MarkdownView :html="html" @navigate="navigate" />
                        <section v-if="file.data.value.recent.length > 0" class="nbdev-stack-tight nbdev-divider nbdev-small border-t pt-3">
                            <h2 class="nbdev-heading">最近的改动</h2>
                            <ol class="nbdev-stack-tight">
                                <li v-for="commit in file.data.value.recent" :key="commit.sha" class="flex min-w-0 items-center gap-2">
                                    <TruncatedText class="nbdev-secondary shrink-0" :text="commit.sha.slice(0, 9)" mono /><span class="min-w-0 flex-1 truncate">{{ commit.subject }}</span><span class="nbdev-secondary shrink-0">{{ relativeDay(commit.date) }}</span>
                                </li>
                            </ol>
                        </section>
                    </article>
                </div>
            </PageShell>
        </section>
    </div>
</template>
