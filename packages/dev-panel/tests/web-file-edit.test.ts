import {describe, expect, test} from "bun:test";
import {effectScope, nextTick, ref} from "vue";
import {useFileEditSession} from "../src/web/host/file-edit-session.js";
import {stopPanelData} from "../src/web/host/panel-data.js";
import {gate, until, useWebEnv, type FetchCall, type Reply} from "./web-env.js";

/** 编辑页的编辑会话（`host/file-edit-session.ts`，L3，t15 阶段 1.3、1.4）。环境见 `tests/web-env.ts`。 */
const web = useWebEnv();

const file = (path: string, text: string, hash: string) => ({path, kind: "task_readme", text, hash, editable: true, reason: null, uncommitted: null, stagedRename: false, changedIn: [], lineLimit: null});
const commit = {committed: true, sha: "abcdef0123456789", reason: null};

function serveFiles(texts: Record<string, {text: string; hash: string}>): (call: FetchCall) => Reply | undefined {
    return (call) => {
        if (call.method !== "GET" || !call.url.startsWith("/api/files?path=")) return undefined;
        const path = decodeURIComponent(call.url.slice("/api/files?path=".length));
        const entry = texts[path];
        return entry ? {data: file(path, entry.text, entry.hash)} : undefined;
    };
}

function mount(initial: string) {
    const path = ref<string | null>(initial);
    const scope = effectScope();
    const session = scope.run(() => useFileEditSession(path))!;
    return {path, session, stop: () => {
        scope.stop();
        stopPanelData();
    }};
}

describe("换文件之后不留旧文件的状态（1.3）", () => {
    test("A 改了一半换到 B：基线、草稿都是 B 的，提示与冲突清空", async () => {
        web.env.respond(serveFiles({"a.md": {text: "A 原文", hash: "ha"}, "b.md": {text: "B 原文", hash: "hb"}}));
        const {path, session, stop} = mount("a.md");
        await until(() => session.base.value, (value) => value !== null);
        session.draft.value = "A 改了";
        session.notice.value = {tone: "info", title: "旧提示", message: "", items: [], retry: false};
        path.value = "b.md";
        await nextTick();
        await until(() => session.base.value, (value) => value?.hash === "hb");
        expect([session.draft.value, session.dirty.value, session.notice.value, session.mismatch.value]).toEqual(["B 原文", false, null, null]);
        stop();
    });

    test("A 的保存在途时换到 B：A 的回包不改 B 的草稿，也没有“已保存”", async () => {
        const hold = gate();
        web.env.respond(serveFiles({"a.md": {text: "A 原文", hash: "ha"}, "b.md": {text: "B 原文", hash: "hb"}}));
        web.env.respond((call) => (call.method === "PUT" ? {data: {changed: true, commit, text: "A 新\n", nextHash: "ha2"}, wait: hold.promise} : undefined));
        const {path, session, stop} = mount("a.md");
        await until(() => session.base.value, (value) => value !== null);
        session.draft.value = "A 新";
        const saving = session.save();
        path.value = "b.md";
        await nextTick();
        await until(() => session.base.value, (value) => value?.hash === "hb");
        hold.open();
        await saving;
        expect([session.draft.value, session.base.value?.hash, session.notice.value]).toEqual(["B 原文", "hb", null]);
        stop();
    });

    test("哈希冲突后取现在版本挂起时换到 B：B 的状态不受影响", async () => {
        const hold = gate();
        let calls = 0;
        web.env.respond((call) => {
            if (call.method !== "GET" || call.url !== "/api/files?path=a.md") return undefined;
            calls += 1;
            return calls === 1 ? {data: file("a.md", "A 原文", "ha")} : {data: file("a.md", "别人改了", "hx"), wait: hold.promise};
        });
        web.env.respond(serveFiles({"b.md": {text: "B 原文", hash: "hb"}}));
        web.env.respond((call) => (call.method === "PUT" ? {status: 409, errors: [{code: "hash_mismatch", message: "改过了"}]} : undefined));
        const {path, session, stop} = mount("a.md");
        await until(() => session.base.value, (value) => value !== null);
        session.draft.value = "A 改了";
        const saving = session.save();
        await until(() => calls, (count) => count === 2);
        path.value = "b.md";
        await nextTick();
        await until(() => session.base.value, (value) => value?.hash === "hb");
        hold.open();
        await saving;
        expect([session.mismatch.value, session.draft.value]).toEqual([null, "B 原文"]);
        stop();
    });

    test("同一个文件重取、有未保存的改动时，草稿不被覆盖", async () => {
        web.env.respond(serveFiles({"a.md": {text: "A 原文", hash: "ha"}}));
        const {session, stop} = mount("a.md");
        await until(() => session.base.value, (value) => value !== null);
        session.draft.value = "A 改了";
        session.file.reload();
        await until(() => web.env.calls.length, (count) => count === 2);
        await Bun.sleep(20);
        expect([session.draft.value, session.dirty.value]).toEqual(["A 改了", true]);
        stop();
    });
});

describe("保存在途时（1.4）", () => {
    test("saving 为真；挂起期间草稿被改了（绕过只读）：回包不覆盖草稿、仍算未保存；正常保存后草稿换成服务端文本", async () => {
        const hold = gate();
        web.env.respond(serveFiles({"a.md": {text: "A 原文", hash: "ha"}}));
        let puts = 0;
        web.env.respond((call) => {
            if (call.method !== "PUT") return undefined;
            puts += 1;
            return puts === 1 ? {data: {changed: true, commit, text: "A 一\n", nextHash: "h1"}, wait: hold.promise} : {data: {changed: true, commit, text: "A 二（updated 改过）\n", nextHash: "h2"}};
        });
        const {session, stop} = mount("a.md");
        await until(() => session.base.value, (value) => value !== null);
        session.draft.value = "A 一";
        const saving = session.save();
        expect(session.saving.value).toBe(true);
        session.draft.value = "A 一，又打了几个字";
        hold.open();
        await saving;
        expect([session.saving.value, session.base.value?.hash, session.draft.value, session.dirty.value]).toEqual([false, "h1", "A 一，又打了几个字", true]);
        session.draft.value = "A 二";
        await session.save();
        expect([session.draft.value, session.dirty.value, session.notice.value?.title]).toEqual(["A 二（updated 改过）\n", false, "已保存"]);
        stop();
    });
});
