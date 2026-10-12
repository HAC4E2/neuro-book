/**
 * 最近打开的记录（docs/specs/workbench/editor.md 输出 31）：真实 Storage 场地上绑定项目的窗口里，打开的地址移到最前、
 * 去重、至多 10 个，已经在最前时不写；同一客户端的另一个窗口读到同一份。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageService} from "nbook/shared/storage";

import {EDITOR_RECENT_RECORD, editorRecentStore, MAX_RECENT} from "./web/recent-record";
import type {EditorRecentStore} from "./web/recent-record";

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-editor", "recent");
});

afterEach(async () => {
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function world(): Promise<StorageWorld> {
    counter += 1;
    const created = await storageWorld(join(tmp, `case-${String(counter)}`), []);
    worlds.push(created);
    await created.project(1, []);
    return created;
}

/** 绑定项目 `book` 的窗口里建最近打开的 store（插件 id 与产品的编辑器一致），等记录读完。 */
async function openRecent(w: StorageWorld, id: string): Promise<{store: EditorRecentStore; storage: StorageService}> {
    const hosted: {current: {store: EditorRecentStore; storage: StorageService} | null} = {current: null};
    const plugin: PluginDefinition = {
        id: "nbook.editor",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}, {key: storageKey}],
            activate: (context) => {
                const storage = context.services.require(storageKey);
                hosted.current = {store: editorRecentStore.create(context, {storage, diagnostics: context.services.require(diagnosticsKey)}), storage};
                return {};
            },
        }],
    };
    await w.window(id, "c", [plugin], {bound: true});
    if (hosted.current === null) throw new Error("store 没有创建");
    const {store} = hosted.current;
    await waitUntil(`${id} 的最近打开读完`, () => store.state.recent.ready);
    return hosted.current;
}

async function stored(storage: StorageService): Promise<unknown> {
    const opened = await storage.open(EDITOR_RECENT_RECORD);
    if (!opened.ok) throw new Error(`${opened.code} ${opened.detail}`);
    const snapshot = await opened.handle.read();
    return snapshot.status === "ok" ? snapshot.value : snapshot.status;
}

async function settled(store: EditorRecentStore): Promise<void> {
    await waitUntil("最近打开写完", () => store.state.recent.queue === 0);
}

describe("Spec workbench.editor 输出 31：最近打开", () => {
    it("打开的地址移到最前、去重；已经在最前时不写；另一个窗口读到同一份", async () => {
        const w = await world();
        const {store, storage} = await openRecent(w, "a");
        expect(store.state.recent.display.addresses).toEqual([]);
        for (const address of ["project://a.md", "project://b.md", "project://a.md"]) store.actions.opened(address);
        await settled(store);
        expect(await stored(storage)).toEqual({addresses: ["project://a.md", "project://b.md"]});
        store.actions.opened("project://a.md");
        expect(store.state.recent.queue).toBe(0);

        const other = await openRecent(w, "b");
        expect(other.store.state.recent.display.addresses).toEqual(["project://a.md", "project://b.md"]);
    });

    it(`至多 ${String(MAX_RECENT)} 个：超出时丢掉最早的`, async () => {
        const w = await world();
        const {store, storage} = await openRecent(w, "a");
        const addresses = Array.from({length: MAX_RECENT + 2}, (_, index) => `project://${String(index)}.md`);
        for (const address of addresses) store.actions.opened(address);
        await settled(store);
        expect(await stored(storage)).toEqual({addresses: addresses.slice(2).reverse()});
    });
});
