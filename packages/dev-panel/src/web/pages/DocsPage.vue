<script setup lang="ts">
import {Badge, Button, Drawer, SegmentedControl} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, ref, watch} from "vue";
import {useRoute, useRouter} from "vue-router";
import {relativeDay} from "../host/format.js";
import {renderMarkdown} from "../host/markdown.js";
import {loadStateOf, useResource} from "../host/panel-data.js";
import {editHref} from "../host/routes.js";
import type {DocDiffData, DocFileData, DocTreeData, Meta} from "../host/types.js";
import ActionLink from "../parts/ActionLink.vue";
import DiffView from "../parts/DiffView.vue";
import DocsSidebar from "../parts/DocsSidebar.vue";
import LoadState from "../parts/LoadState.vue";
import MarkdownView from "../parts/MarkdownView.vue";
import PageShell from "../parts/PageShell.vue";
import TruncatedText from "../parts/TruncatedText.vue";

/**
 * 文档页（t03 第二轮文档页）：左边按类型的树，顶部切 checkout（缺省主工作区；从 Task 进入时是它的执行 checkout，`prefer` 带上候选），
 * 不是主工作区时标出来并列出与 master 的差异；右边渲染 Markdown，frontmatter 变成徽章，带最近的改动与哪些分支改了它。
 * t15 阶段 4 第 4 批：在差异里的文档可以切到“与 master 的差异”（`?view=diff`，与文档树同口径，删去的与 master 才有的只有差异）；
 * “只看有差异的”写进网址（`?changed=1`）；手机上文档树收进抽屉。
 */
const route = useRoute();
const router = useRouter();
const checkout = computed(() => (typeof route.query.checkout === "string" ? route.query.checkout : "main"));
const path = computed(() => (typeof route.query.path === "string" ? route.query.path : null));
const prefer = computed(() => (typeof route.query.prefer === "string" ? route.query.prefer.split(",").filter(Boolean) : []));
const tree = useResource<DocTreeData>(() => `/api/docs/tree?checkout=${encodeURIComponent(checkout.value)}`, ["records"]);
/** 这份文档在差异里是哪一种；删去的与 master 才有的在这个 checkout 里没有正文，只能看差异。 */
const change = computed(() => (path.value ? tree.data.value?.changes.find((entry) => entry.path === path.value)?.change ?? null : null));
const diffOnly = computed(() => change.value === "deleted" || change.value === "master_only");
const showDiff = computed(() => change.value !== null && (diffOnly.value || route.query.view === "diff"));
const file = useResource<DocFileData>(() => (path.value && !diffOnly.value && tree.data.value ? `/api/docs/file?checkout=${encodeURIComponent(checkout.value)}&path=${encodeURIComponent(path.value)}` : null), ["records"]);
const diff = useResource<DocDiffData>(() => (path.value && showDiff.value ? `/api/docs/diff?checkout=${encodeURIComponent(checkout.value)}&path=${encodeURIComponent(path.value)}` : null), ["records"]);
const viewOptions = computed(() => [{value: "render", label: "渲染", disabled: diffOnly.value}, {value: "diff", label: "与 master 的差异"}]);
const CHANGE_NOTE: Record<string, string> = {added: "这个分支新增的", modified: "这个分支改过的", deleted: "这个分支删去的", master_only: "分支分出之后 master 新增的（这个 checkout 里没有）"};
const diffBase = computed(() => {
    const data = diff.data.value;
    if (!data) return null;
    if (data.change === "master_only") return "整份是主工作区里的那一份";
    return `合并基点 ${data.mergeBase?.slice(0, 9) ?? "?"} → 这个 checkout 的工作区（含未提交）`;
});
const meta = useResource<Meta>(() => "/api/meta", ["records"]);
/**
 * 这个 checkout 的文档树找不到（worktree 合并后删掉了，书签与历史里常见）：上一级改去主工作区的文档，
 * 否则“回到文档树”与面包屑都指回同一个 404。
 */
const treeMissing = computed(() => tree.error.value?.status === 404 && checkout.value !== "main");
/** 文档找不到（404）时回到同一 checkout 的文档树。 */
const treeHref = computed(() => (treeMissing.value ? "/docs" : `/docs?checkout=${encodeURIComponent(checkout.value)}`));
const changedOnly = computed(() => route.query.changed === "1");
/** 手机上（窄于 768px）文档树收进抽屉，正文上方一个“文档树”按钮；选了文档就关上。 */
const phoneQuery = window.matchMedia("(max-width: 767px)");
const phone = ref(phoneQuery.matches);
const onPhone = () => {
    phone.value = phoneQuery.matches;
};
phoneQuery.addEventListener("change", onPhone);
onBeforeUnmount(() => phoneQuery.removeEventListener("change", onPhone));
const treeOpen = ref(false);
watch(path, () => {
    treeOpen.value = false;
});

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

function go(query: Record<string, string | undefined>, replace = false): void {
    const next = {name: "docs", query: Object.fromEntries(Object.entries({...route.query, ...query}).filter(([, value]) => value !== undefined)) as Record<string, string>};
    void (replace ? router.replace(next) : router.push(next));
}
/** 换 checkout 时差异视图与网址里的路径都不一定还在：只留 checkout 与“只看有差异的”。 */
function switchCheckout(key: string): void {
    void router.push({name: "docs", query: {checkout: key, ...(changedOnly.value ? {changed: "1"} : {})}});
}
</script>

<template>
    <!-- 铺满型页面（路由 layout: fill）：宽屏上树与正文各自滚动；窄屏上下堆叠，整页由根滚动，仍只有一个竖向滚动者。 -->
    <div class="relative grid h-full min-h-0 grid-cols-1 overflow-y-auto [scrollbar-gutter:stable] md:grid-cols-[18rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden md:[scrollbar-gutter:auto]">
        <aside v-if="!phone" class="nbdev-stack nbdev-divider relative min-h-0 gap-3 border-r p-3 md:overflow-y-auto md:[scrollbar-gutter:stable]" aria-label="文档树">
            <LoadState v-bind="loadStateOf(tree)" label="正在读取文档树" :subject="`${checkout} 这个 checkout`" :up-href="checkout === 'main' ? '/' : '/docs'" :up-label="checkout === 'main' ? '回到首页' : '去主工作区的文档'" @navigate="navigate" @retry="tree.reload()" />
            <DocsSidebar v-if="tree.data.value" :tree="tree.data.value" :checkout="checkout" :preferred="prefer" :selected="path" :changed-only="changedOnly" @checkout="switchCheckout" @update:changed-only="(value) => go({changed: value ? '1' : undefined}, true)" @open="(value) => go({path: value})" />
        </aside>
        <Drawer v-else v-model:open="treeOpen" direction="left" title="文档树">
            <DocsSidebar v-if="tree.data.value" :tree="tree.data.value" :checkout="checkout" :preferred="prefer" :selected="path" :changed-only="changedOnly" @checkout="switchCheckout" @update:changed-only="(value) => go({changed: value ? '1' : undefined}, true)" @open="(value) => go({path: value})" />
        </Drawer>
        <!-- 正文一栏套 PageShell 的阅读档：Markdown 按阅读宽度收窄并居中，右边不再空一片。 -->
        <section class="relative min-h-0 min-w-0 md:overflow-y-auto md:[scrollbar-gutter:stable]">
            <PageShell width="reading" :crumbs="crumbs" :title="docTitle" @navigate="navigate">
                <template v-if="file.data.value || change !== null || phone" #actions>
                    <Button v-if="phone" size="sm" variant="secondary" icon-class="i-lucide-folder-tree" @click="treeOpen = true">文档树</Button>
                    <SegmentedControl v-if="change !== null" :model-value="showDiff ? 'diff' : 'render'" :options="viewOptions" aria-label="渲染还是与 master 的差异" @update:model-value="(value) => go({view: value === 'diff' ? 'diff' : undefined}, true)" />
                    <!-- 只编辑主工作区的文件：worktree 的暂存区与分支属于别的会话，面板的写事务管不到。能不能改以编辑页的判定为准。 -->
                    <ActionLink v-if="file.data.value && file.data.value.checkout.isMain && meta.data.value?.mainWritable.ok" :href="editHref(file.data.value.path)" icon="i-lucide-pencil" @navigate="navigate">编辑</ActionLink>
                </template>
                <template v-if="file.data.value" #meta>
                    <TruncatedText :text="file.data.value.path" mono />
                    <Badge v-if="!file.data.value.checkout.isMain" tone="warning" variant="soft" size="sm">{{ file.data.value.checkout.key }}（{{ file.data.value.checkout.branch ?? "分离 HEAD" }}）</Badge>
                    <Badge v-for="[key, value] in frontmatter" :key="key" tone="neutral" variant="outline" size="sm">{{ key }}：{{ value }}</Badge>
                </template>
                <!-- 阅读档的宽度由正文里定宽的东西撑开：没选文档、加载、出错时也放在同一个阅读栏里，数据到了标题不横移。 -->
                <div class="nbdev-stack nbdev-reading-column">
                    <LoadState v-if="phone" v-bind="loadStateOf(tree)" label="正在读取文档树" :subject="`${checkout} 这个 checkout`" :up-href="checkout === 'main' ? '/' : '/docs'" :up-label="checkout === 'main' ? '回到首页' : '去主工作区的文档'" @navigate="navigate" @retry="tree.reload()" />
                    <p v-if="!path" class="nbdev-empty">{{ phone ? "点上面的“文档树”选一份文档" : "在左边选一份文档" }}</p>
                    <template v-else-if="showDiff">
                        <p class="nbdev-note">{{ change ? CHANGE_NOTE[change] : "" }}<template v-if="diffBase"> · {{ diffBase }}</template></p>
                        <LoadState v-bind="loadStateOf(diff)" label="正在读取差异" :subject="`${path} 的差异`" :up-href="treeHref" up-label="回到文档树" @navigate="navigate" @retry="diff.reload()" />
                        <DiffView v-if="diff.data.value" :text="diff.data.value.text || '没有差异'" />
                    </template>
                    <LoadState v-else v-bind="loadStateOf(file)" label="正在读取文档" :subject="`${path} 这份文档`" :up-href="treeHref" :up-label="treeMissing ? '去主工作区的文档' : '回到文档树'" @navigate="navigate" @retry="file.reload()" />
                    <article v-if="path && !showDiff && file.data.value" class="nbdev-stack">
                        <p v-if="otherBranches.length > 0" class="nbdev-warn nbdev-small">
                            {{ file.data.value.checkout.isMain ? "这些分支改了它" : "别的分支也改了它" }}：<button v-for="key in otherBranches" :key="key" type="button" class="mr-2 underline" @click="go({checkout: key})">{{ key }}</button>
                        </p>
                        <MarkdownView :html="html" @navigate="navigate" />
                        <section v-if="file.data.value.recent.length > 0" class="nbdev-stack-tight nbdev-divider nbdev-small border-t pt-3">
                            <h2 class="nbdev-heading">最近的改动</h2>
                            <ol class="nbdev-stack-tight">
                                <li v-for="commit in file.data.value.recent" :key="commit.sha" class="flex min-w-0 items-center gap-2">
                                    <span class="nbdev-secondary shrink-0"><TruncatedText :text="commit.sha.slice(0, 9)" mono /></span><span class="min-w-0 flex-1 truncate">{{ commit.subject }}</span><span class="nbdev-secondary shrink-0">{{ relativeDay(commit.date) }}</span>
                                </li>
                            </ol>
                        </section>
                    </article>
                </div>
            </PageShell>
        </section>
    </div>
</template>
