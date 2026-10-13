import {computed, ref, watch, type Ref} from "vue";
import {ApiError, getJson, sendJson} from "./api.js";
import {diffText, lineDiff} from "./line-diff.js";
import {useResource} from "./panel-data.js";
import type {EditableFileData, UncommittedChanges, WriteData} from "./types.js";
import {failureNotice, successNotice, uncommittedOf, useWrite, type Notice, type WriteFailure} from "./writes.js";

/**
 * 编辑页（宿主）的一次编辑会话：文件身份（`path`）、基线与草稿、保存、冲突与结果未知。合同见 docs/panel.md 的“写入的界面”与
 * “编辑页的未保存改动”；路由守卫、`beforeunload`、剪贴板仍在页面里。
 * - 换文件（`path` 变了）：会话代号加一，基线、草稿、冲突与提示都清掉，新文件到达后建立新基线；旧文件在途的回包回来时代号对不上，
 *   只丢状态更新，写入本身照样发生（t15 阶段 1.3）；
 * - 保存在途时 `saving` 为真：页面据此把编辑器置只读、拒绝站内离开（t15 阶段 1.4）。
 * 不订阅推送：别人改了文件时不能悄悄换掉开发者正在改的文本，保存时由 `baseHash` 发现。
 */

/** `maybeMine`：结果未知之后取到的新版本，差异多半就是自己刚才那次保存。 */
export type EditMismatch = {text: string; hash: string; diff: string; maybeMine?: boolean};

export function useFileEditSession(path: Ref<string | null>) {
    const file = useResource<EditableFileData>(() => (path.value ? `/api/files?path=${encodeURIComponent(path.value)}` : null), []);
    /** 打开时（或上次保存、上次载入时）的版本：保存以它为基准。 */
    const base = ref<{text: string; hash: string} | null>(null);
    const draft = ref("");
    const dirty = computed(() => base.value !== null && draft.value !== base.value.text);
    const write = useWrite();
    const saving = computed(() => write.pending.value);
    const notice = ref<Notice | null>(null);
    const uncommitted = ref<{currentHash: string; changes: UncommittedChanges} | null>(null);
    const mismatch = ref<EditMismatch | null>(null);
    let generation = 0;

    watch(path, () => {
        generation += 1;
        base.value = null;
        draft.value = "";
        notice.value = null;
        uncommitted.value = null;
        mismatch.value = null;
    });
    watch(() => file.data.value, (data) => {
        if (!data || data.path !== path.value || dirty.value) return;
        base.value = {text: data.text, hash: data.hash};
        draft.value = data.text;
    }, {immediate: true});

    async function save(includeUncommitted = false, baseHash = base.value?.hash ?? ""): Promise<void> {
        const target = path.value;
        if (!target || !base.value) return;
        const mine = generation;
        const submitted = draft.value;
        notice.value = null;
        const outcome = await write.run(() => sendJson<WriteData & {text: string; nextHash: string}>("PUT", `/api/files?path=${encodeURIComponent(target)}`, {content: submitted, baseHash, includeUncommitted}));
        if (mine !== generation) return;
        if (outcome.ok) {
            uncommitted.value = null;
            mismatch.value = null;
            // 核心会改 README 的 updated：基线换成服务端写下的最终文本，下一次保存以它为基准。保存在途时编辑器只读，草稿
            // 本该仍等于提交的文本；不等时（只读被绕过）留着草稿，它比基线新，仍算未保存。
            base.value = {text: outcome.body.data.text, hash: outcome.body.data.nextHash};
            if (draft.value === submitted) draft.value = outcome.body.data.text;
            notice.value = successNotice("已保存", outcome.body);
            // 重取一次元信息：一起提交了别人的改动之后，“有别人没提交的改动”的提示要消失。草稿与基线相同时重取不会冲掉文字。
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
            await loadMismatch(mine, target);
            return;
        }
        if (failure.action === "unknown") {
            await checkAfterUnknown(failure, mine, target);
            return;
        }
        notice.value = failureNotice("没有保存", failure);
    }

    /**
     * 结果未知（连接中途断开）：取一次现在的文件。与打开时不同，多半是刚才那次保存已经生效，进“别人改了什么”并写明；
     * 相同，就是没写成，可以再保存。
     */
    async function checkAfterUnknown(failure: WriteFailure, mine: number, target: string): Promise<void> {
        const opened = base.value;
        if (!opened) return;
        try {
            const current = (await getJson<EditableFileData>(`/api/files?path=${encodeURIComponent(target)}`)).data;
            if (mine !== generation) return;
            if (current.hash === opened.hash) {
                notice.value = {...failureNotice("没有保存", failure), message: "连接中途断开了；重新取了一次，文件没有变，这次保存没有生效，可以再保存"};
                return;
            }
            mismatch.value = {text: current.text, hash: current.hash, diff: diffText(lineDiff(opened.text, current.text)), maybeMine: true};
            notice.value = {...failureNotice("结果未知", failure), message: "连接中途断开了；重新取了一次，文件已经变了，多半是你刚才那次保存已经生效，看下面的差异"};
        } catch (error) {
            if (!(error instanceof ApiError)) throw error;
            if (mine !== generation) return;
            notice.value = {...failureNotice("结果未知", failure), message: `${failure.message}。重新取文件也失败了（${error.message}），刷新页面再看`};
        }
    }

    /** 打开之后别人改了：取现在的版本，与打开时的原文按行比，给“别人改了什么”。 */
    async function loadMismatch(mine: number, target: string): Promise<void> {
        const opened = base.value;
        if (!opened) return;
        try {
            const current = (await getJson<EditableFileData>(`/api/files?path=${encodeURIComponent(target)}`)).data;
            if (mine !== generation) return;
            mismatch.value = {text: current.text, hash: current.hash, diff: diffText(lineDiff(opened.text, current.text))};
        } catch (error) {
            if (!(error instanceof ApiError)) throw error;
            if (mine !== generation) return;
            notice.value = {tone: "error", title: "没有保存", message: `文件在你打开之后被改过，取现在的版本也失败了：${error.message}`, items: [], retry: false};
        }
    }

    function takeCurrent(): void {
        if (!mismatch.value) return;
        base.value = {text: mismatch.value.text, hash: mismatch.value.hash};
        draft.value = mismatch.value.text;
        mismatch.value = null;
    }

    function discard(): void {
        if (base.value) draft.value = base.value.text;
    }

    return {file, base, draft, dirty, write, saving, notice, uncommitted, mismatch, save, takeCurrent, discard};
}
