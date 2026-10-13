import {ref, type Ref} from "vue";
import {sendJson} from "./api.js";
import type {UncommittedChanges, WriteData} from "./types.js";
import {failureNotice, successNotice, uncommittedOf, useWrite, type Notice, type WriteRun} from "./writes.js";

/**
 * Work 页与 Task 页的状态切换（宿主逻辑）：带开发者看到的 README 哈希（`expectedHash`）；
 * 目标有未提交改动时先弹差异，确认后带 `includeUncommitted` 与服务端给的 `currentHash` 重发。
 */
export type PendingUncommitted = {status: string; path: string; currentHash: string; changes: UncommittedChanges};

export function useStatusChange(endpoint: () => string, expectedHash: () => string | null, reload: () => void): {
    write: WriteRun;
    notice: Ref<Notice | null>;
    pending: Ref<PendingUncommitted | null>;
    change(status: string): Promise<void>;
    confirmUncommitted(): Promise<void>;
    /** 确定什么都没写的失败（等锁超时）之后按原样再发一次。 */
    retry(): Promise<void>;
} {
    const write = useWrite();
    const notice = ref<Notice | null>(null);
    const pending = ref<PendingUncommitted | null>(null);
    let last: string | null = null;

    async function send(status: string, hash: string, includeUncommitted: boolean): Promise<void> {
        last = status;
        notice.value = null;
        const outcome = await write.run(() => sendJson<WriteData & {next: string}>("POST", endpoint(), {status, expectedHash: hash, includeUncommitted}));
        if (outcome.ok) {
            pending.value = null;
            notice.value = successNotice("状态已改", outcome.body);
            reload();
            return;
        }
        const {failure} = outcome;
        if (failure.action === "confirm_uncommitted") {
            pending.value = {status, path: String(failure.details.path ?? ""), currentHash: String(failure.details.currentHash ?? hash), changes: uncommittedOf(failure.details)};
            return;
        }
        pending.value = null;
        notice.value = failure.action === "show_diff"
            ? {tone: "warning", title: "没有改", message: "README 在你打开之后被改过，已重新载入；看过之后再改", items: [], retry: false}
            : failure.action === "unknown"
                ? {...failureNotice("结果未知", failure), message: `${failure.message}。已重新载入，看状态有没有改过来`}
                : failureNotice("没有改", failure);
        if (failure.action === "show_diff" || failure.action === "reload" || failure.action === "unknown") reload();
    }

    async function change(status: string): Promise<void> {
        const hash = expectedHash();
        if (hash === null) {
            notice.value = {tone: "error", title: "没有改", message: "读不出 README，刷新后再试", items: [], retry: false};
            return;
        }
        await send(status, hash, false);
    }

    return {
        write,
        notice,
        pending,
        change,
        async confirmUncommitted() {
            if (pending.value) await send(pending.value.status, pending.value.currentHash, true);
        },
        async retry() {
            if (last) await change(last);
        },
    };
}
