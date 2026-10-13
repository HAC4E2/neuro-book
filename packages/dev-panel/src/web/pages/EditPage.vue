<script setup lang="ts">
import {Badge, Button} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {onBeforeRouteLeave, onBeforeRouteUpdate, RouterLink, useRoute, useRouter} from "vue-router";
import {ApiError, getJson, sendJson} from "../host/api.js";
import {diffText, lineDiff} from "../host/line-diff.js";
import {renderMarkdown} from "../host/markdown.js";
import {useResource} from "../host/panel-data.js";
import {docHref} from "../host/routes.js";
import type {EditableFileData, Meta, UncommittedChanges, WriteData} from "../host/types.js";
import {failureNotice, successNotice, uncommittedOf, useWrite, type Notice, type WriteFailure} from "../host/writes.js";
import DiffView from "../parts/DiffView.vue";
import FileEditor from "../parts/FileEditor.vue";
import LoadState from "../parts/LoadState.vue";
import UncommittedDialog from "../parts/UncommittedDialog.vue";
import WriteNotice from "../parts/WriteNotice.vue";

/**
 * 编辑页（`/edit?path=`）：只编辑主工作区里的文件（Work 与 Task 的 README、文档类产物、文档树上的文档），保存即在 master 上提交这一个路径。
 * 保存带打开时的哈希（`baseHash`）：别人在打开之后改过就不写，显示两版之间的差异（前端按行算）；目标有别人没提交的改动时先弹差异再确认。
 * 未保存的改动：站内跳转（左栏、链接、改 `?path=`）用路由守卫拦，关标签页与刷新用 `beforeunload` 拦。
 */
const route = useRoute();
const router = useRouter();
const path = computed(() => (typeof route.query.path === "string" ? route.query.path : null));
// 不订阅推送：别人改了文件时不能悄悄换掉开发者正在改的文本，保存时由 baseHash 发现。
const file = useResource<EditableFileData>(() => (path.value ? `/api/files?path=${encodeURIComponent(path.value)}` : null), []);
const meta = useResource<Meta>(() => "/api/meta", ["records"]);

/** 打开时（或上次保存、上次载入时）的版本：保存以它为基准。 */
const base = ref<{text: string; hash: string} | null>(null);
const draft = ref("");
const dirty = computed(() => base.value !== null && draft.value !== base.value.text);
watch(() => file.data.value, (data) => {
    if (!data || dirty.value) return;
    base.value = {text: data.text, hash: data.hash};
    draft.value = data.text;
}, {immediate: true});

const blocked = computed(() => {
    const writable = meta.data.value?.mainWritable;
    if (writable && !writable.ok) return `主工作区现在不能写（${writable.message ?? writable.code}）`;
    const data = file.data.value;
    if (data?.stagedRename) return "这个文件是暂存区里一次改名的一端，只提交它会拆开那次改名；先在终端处理暂存区";
    if (data && !data.editable) return data.reason?.message ?? "不能编辑";
    return null;
});
const previewHtml = computed(() => (path.value ? renderMarkdown(draft.value.replace(/^---\n[\s\S]*?\n---\n/u, ""), {checkoutKey: "main", path: path.value, artifactBase: meta.data.value?.artifactBase ?? null}) : ""));

const write = useWrite();
const notice = ref<Notice | null>(null);
const uncommitted = ref<{currentHash: string; changes: UncommittedChanges} | null>(null);
/** `maybeMine`：结果未知之后取到的新版本，差异多半就是自己刚才那次保存。 */
const mismatch = ref<{text: string; hash: string; diff: string; maybeMine?: boolean} | null>(null);

async function save(includeUncommitted = false, baseHash = base.value?.hash ?? ""): Promise<void> {
    if (!path.value || !base.value) return;
    notice.value = null;
    const outcome = await write.run(() => sendJson<WriteData & {text: string; nextHash: string}>("PUT", `/api/files?path=${encodeURIComponent(path.value!)}`, {content: draft.value, baseHash, includeUncommitted}));
    if (outcome.ok) {
        uncommitted.value = null;
        mismatch.value = null;
        // 核心会改 README 的 updated：编辑器换成服务端写下的最终文本，下一次保存以它为基准。
        base.value = {text: outcome.body.data.text, hash: outcome.body.data.nextHash};
        draft.value = outcome.body.data.text;
        notice.value = successNotice("已保存", outcome.body);
        // 重取一次元信息：一起提交了别人的改动之后，“有别人没提交的改动”的提示要消失。编辑器此时没有未保存的改动，重取不会冲掉文字。
        file.reload();
        return;
    }
    const {failure} = outcome;
    if (failure.action === "confirm_uncommitted") {
        uncommitted.value = {currentHash: String(failure.details.currentHash ?? baseHash), changes: uncommittedOf(failure.details)};
        return;
    }
    uncommitted.value = null;
    if (failure.action === "show_diff") {
        await loadMismatch();
        return;
    }
    if (failure.action === "unknown") {
        await checkAfterUnknown(failure);
        return;
    }
    notice.value = failureNotice("没有保存", failure);
}

/**
 * 结果未知（连接中途断开）：取一次现在的文件。与打开时不同，多半是刚才那次保存已经生效，进“别人改了什么”并写明；
 * 相同，就是没写成，可以再保存。
 */
async function checkAfterUnknown(failure: WriteFailure): Promise<void> {
    if (!path.value || !base.value) return;
    try {
        const current = (await getJson<EditableFileData>(`/api/files?path=${encodeURIComponent(path.value)}`)).data;
        if (current.hash === base.value.hash) {
            notice.value = {...failureNotice("没有保存", failure), message: "连接中途断开了；重新取了一次，文件没有变，这次保存没有生效，可以再保存"};
            return;
        }
        mismatch.value = {text: current.text, hash: current.hash, diff: diffText(lineDiff(base.value.text, current.text)), maybeMine: true};
        notice.value = {...failureNotice("结果未知", failure), message: "连接中途断开了；重新取了一次，文件已经变了，多半是你刚才那次保存已经生效，看下面的差异"};
    } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        notice.value = {...failureNotice("结果未知", failure), message: `${failure.message}。重新取文件也失败了（${error.message}），刷新页面再看`};
    }
}

/** 打开之后别人改了：取现在的版本，与打开时的原文按行比，给“别人改了什么”。 */
async function loadMismatch(): Promise<void> {
    if (!path.value || !base.value) return;
    try {
        const current = (await getJson<EditableFileData>(`/api/files?path=${encodeURIComponent(path.value)}`)).data;
        mismatch.value = {text: current.text, hash: current.hash, diff: diffText(lineDiff(base.value.text, current.text))};
    } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        notice.value = {tone: "error", title: "没有保存", message: `文件在你打开之后被改过，取现在的版本也失败了：${error.message}`, items: [], retry: false};
    }
}

function takeCurrent(): void {
    if (!mismatch.value) return;
    base.value = {text: mismatch.value.text, hash: mismatch.value.hash};
    draft.value = mismatch.value.text;
    mismatch.value = null;
}

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
onBeforeRouteLeave(() => !dirty.value || window.confirm(LEAVE));
onBeforeRouteUpdate((to) => to.query.path === route.query.path || !dirty.value || window.confirm(LEAVE));
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
            <WriteNotice v-if="notice" :notice="notice" @dismiss="notice = null" @retry="save()" />
            <section v-if="mismatch" class="flex flex-col gap-2 rounded-[var(--radius-panel)] p-3" style="border: var(--border-w, 1px) solid var(--status-warning)">
                <p class="font-semibold">{{ mismatch.maybeMine ? "文件变了，多半是你刚才那次保存已经生效。与打开时相比：" : "文件在你打开之后被改过，没有保存。别人改了什么：" }}</p>
                <DiffView :text="mismatch.diff || '（只有空白不同）'" />
                <div class="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" @click="copyDraft">复制我的改动</Button>
                    <Button size="sm" variant="danger" @click="takeCurrent">{{ mismatch.maybeMine ? "载入新版本" : "载入新版本（丢掉我的改动）" }}</Button>
                </div>
            </section>
            <FileEditor v-model="draft" :preview-html="previewHtml" :readonly="blocked !== null" :line-limit="file.data.value.lineLimit" @navigate="(href) => router.push(href)" />
            <div class="flex flex-wrap items-center gap-2">
                <Button :loading="write.pending.value" :disabled="!dirty || blocked !== null || mismatch !== null" @click="save()">保存并提交</Button>
                <Button variant="ghost" :disabled="!dirty || write.pending.value" @click="base && (draft = base.text)">放弃改动</Button>
                <span v-if="write.slow.value" style="color: var(--text-secondary); font-size: var(--text-xs)">在等别的写入完成…</span>
            </div>
            <UncommittedDialog :open="uncommitted !== null" :path="path" :changes="uncommitted?.changes ?? null" :pending="write.pending.value" @confirm="uncommitted && save(true, uncommitted.currentHash)" @cancel="uncommitted = null" />
        </template>
    </div>
</template>
