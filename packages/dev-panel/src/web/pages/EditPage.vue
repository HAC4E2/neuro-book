<script setup lang="ts">
import {Badge, Button} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, onMounted} from "vue";
import {onBeforeRouteLeave, onBeforeRouteUpdate, RouterLink, useRoute, useRouter} from "vue-router";
import {useFileEditSession} from "../host/file-edit-session.js";
import {renderMarkdown} from "../host/markdown.js";
import {useResource} from "../host/panel-data.js";
import {docHref} from "../host/routes.js";
import type {Meta} from "../host/types.js";
import DiffView from "../parts/DiffView.vue";
import FileEditor from "../parts/FileEditor.vue";
import LoadState from "../parts/LoadState.vue";
import UncommittedDialog from "../parts/UncommittedDialog.vue";
import WriteNotice from "../parts/WriteNotice.vue";

/**
 * 编辑页（`/edit?path=`）：只编辑主工作区里的文件（Work 与 Task 的 README、文档类产物、文档树上的文档），保存即在 master 上提交这一个路径。
 * 保存带打开时的哈希（`baseHash`）：别人在打开之后改过就不写，显示两版之间的差异（前端按行算）；目标有别人没提交的改动时先弹差异再确认。
 * 未保存的改动：站内跳转（左栏、链接、改 `?path=`）用路由守卫拦，关标签页与刷新用 `beforeunload` 拦。
 * 文件身份、基线与草稿、保存与冲突在 `host/file-edit-session.ts`（t15）；这里只接路由守卫、剪贴板与模板。
 */
const route = useRoute();
const router = useRouter();
const path = computed(() => (typeof route.query.path === "string" ? route.query.path : null));
const session = useFileEditSession(path);
const {file, draft, dirty, write, saving, notice, uncommitted, mismatch} = session;
const meta = useResource<Meta>(() => "/api/meta", ["records"]);

const blocked = computed(() => {
    const writable = meta.data.value?.mainWritable;
    if (writable && !writable.ok) return `主工作区现在不能写（${writable.message ?? writable.code}）`;
    const data = file.data.value;
    if (data?.stagedRename) return "这个文件是暂存区里一次改名的一端，只提交它会拆开那次改名；先在终端处理暂存区";
    if (data && !data.editable) return data.reason?.message ?? "不能编辑";
    return null;
});
const previewHtml = computed(() => (path.value ? renderMarkdown(draft.value.replace(/^---\n[\s\S]*?\n---\n/u, ""), {checkoutKey: "main", path: path.value, artifactBase: meta.data.value?.artifactBase ?? null}) : ""));

async function copyDraft(): Promise<void> {
    try {
        await navigator.clipboard.writeText(draft.value);
        notice.value = {tone: "info", title: "已复制你的改动", message: "载入新版本之后可以对照着重新改", items: [], retry: false};
    } catch (error) {
        console.error("复制失败", error);
        notice.value = {tone: "error", title: "复制失败", message: "浏览器不让写剪贴板；手动全选编辑框里的文字复制", items: [], retry: false};
    }
}

const LEAVE = "有未保存的改动，离开会丢掉。确定离开？";
/** 站内离开：保存在途时直接拒绝（这次保存照样会提交，离开不会丢掉它，等结果回来再走）；有未保存的改动时确认。 */
function mayLeave(): boolean {
    if (saving.value) {
        notice.value = {tone: "warning", title: "正在保存", message: "等它完成再离开（等别的写入最长 30 秒）", items: [], retry: false};
        return false;
    }
    return !dirty.value || window.confirm(LEAVE);
}
onBeforeRouteLeave(() => mayLeave());
onBeforeRouteUpdate((to) => to.query.path === route.query.path || mayLeave());
function guardUnload(event: BeforeUnloadEvent): void {
    if (!dirty.value) return;
    event.preventDefault();
    event.returnValue = "";
}
onMounted(() => window.addEventListener("beforeunload", guardUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", guardUnload));
</script>

<template>
    <div class="mx-auto flex w-full max-w-[90rem] flex-col gap-3 p-4 md:p-6">
        <LoadState v-if="!path" :loading="false" :error="{message: '没有指定要编辑的文件'}" :retryable="false" />
        <LoadState v-else-if="!file.data.value" :loading="file.loading.value" :error="file.error.value" label="正在读取文件" @retry="file.reload()" />
        <template v-else>
            <header class="flex flex-wrap items-center gap-2">
                <h1 class="min-w-0 break-all font-semibold" style="font-size: var(--text-lg)"><code>{{ path }}</code></h1>
                <Badge v-if="dirty" tone="warning" variant="soft" size="sm">未保存</Badge>
                <RouterLink class="ml-auto" :to="docHref('main', path)" style="font-size: var(--text-xs)">看文档</RouterLink>
            </header>
            <p v-if="file.data.value.changedIn.length > 0" class="rounded-[var(--radius-control)] px-2 py-1" style="background: var(--bg-subtle); font-size: var(--text-xs)">
                这些分支改过它：{{ file.data.value.changedIn.map((entry) => entry.branch ?? entry.key).join("、") }}。在 master 上直接改，合并时可能与它们冲突。
            </p>
            <p v-if="file.data.value.uncommitted" class="rounded-[var(--radius-control)] px-2 py-1" style="background: var(--bg-subtle); font-size: var(--text-xs)">
                主工作区里这个文件有别人没提交的改动（{{ file.data.value.uncommitted.status.join("、") }}）；保存时会先给你看差异再确认。
            </p>
            <p v-if="file.data.value.kind === 'work_readme' || file.data.value.kind === 'task_readme'" style="color: var(--text-secondary); font-size: var(--text-xs)">
                frontmatter 的 schema、id、issueId 与 status 不能在这里改（改状态用 Work 或 Task 页的状态切换）；保存时 updated 会改成今天。
            </p>
            <p v-if="blocked" style="color: var(--status-warning)">{{ blocked }}</p>
            <WriteNotice v-if="notice" :notice="notice" @dismiss="notice = null" @retry="session.save()" />
            <section v-if="mismatch" class="flex flex-col gap-2 rounded-[var(--radius-panel)] p-3" style="border: var(--border-w, 1px) solid var(--status-warning)">
                <p class="font-semibold">{{ mismatch.maybeMine ? "文件变了，多半是你刚才那次保存已经生效。与打开时相比：" : "文件在你打开之后被改过，没有保存。别人改了什么：" }}</p>
                <DiffView :text="mismatch.diff || '（只有空白不同）'" />
                <div class="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" @click="copyDraft">复制我的改动</Button>
                    <Button size="sm" variant="danger" @click="session.takeCurrent">{{ mismatch.maybeMine ? "载入新版本" : "载入新版本（丢掉我的改动）" }}</Button>
                </div>
            </section>
            <FileEditor v-model="draft" :preview-html="previewHtml" :readonly="blocked !== null || saving" :line-limit="file.data.value.lineLimit" @navigate="(href) => router.push(href)" />
            <div class="flex flex-wrap items-center gap-2">
                <Button :loading="write.pending.value" :disabled="!dirty || blocked !== null || mismatch !== null" @click="session.save()">保存并提交</Button>
                <Button variant="ghost" :disabled="!dirty || write.pending.value" @click="session.discard">放弃改动</Button>
                <span v-if="write.slow.value" style="color: var(--text-secondary); font-size: var(--text-xs)">在等别的写入完成…</span>
            </div>
            <UncommittedDialog :open="uncommitted !== null" :path="path" :changes="uncommitted?.changes ?? null" :pending="write.pending.value" @confirm="uncommitted && session.save(true, uncommitted.currentHash)" @cancel="uncommitted = null" />
        </template>
    </div>
</template>
