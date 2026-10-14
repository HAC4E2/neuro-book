/**
 * 在 Storage 场地的浏览器窗口里建工作台布局 store（`nbook.storage` 按插件分命名空间：测试插件用工作台的 id，记录地址
 * 与产品一致）。只由测试使用，不含断言。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {storageKey} from "nbook/plugins/storage/shared/contracts";
import type {StorageWorld, WorldWindow} from "nbook/plugins/storage/testing/world";
import type {StorageService} from "nbook/shared/storage";

import {layoutStoreFor} from "../state/layout-store";
import type {LayoutStore} from "../state/layout-store";
import type {ViewCatalog} from "../views/placement";

export interface LayoutWindow {
    readonly store: LayoutStore;
    readonly storage: StorageService;
    readonly window: WorldWindow;
}

/**
 * 常见的工作台：右栏与面板里各有一个视图，两处缺省都显示（ui/workbench-shell.md 输出 39 只让空着、没主动显示过的区域
 * 缺省不显示）。测空区域规则时传空目录。
 */
export const BUSY_CATALOG: ViewCatalog = new Map([
    ["test.aux", {title: {"zh-CN": "大纲", "en-US": "Outline"}, icon: "i-aux", location: "auxiliarybar", layout: "scroll"}],
    ["test.panel", {title: {"zh-CN": "输出", "en-US": "Output"}, icon: "i-panel", location: "panel", layout: "scroll"}],
]);

/**
 * `bound` 决定尺寸记录的分区，也决定窗口是否绑定项目 `book`。视图目录在 store 建好后立刻交入（与产品的工作台入口一样）。
 * 等到三条记录都读完才返回。
 */
export async function openLayout(world: StorageWorld, id: string, client: string, bound = false, catalog: ViewCatalog = BUSY_CATALOG): Promise<LayoutWindow> {
    const hosted: {current: {store: LayoutStore; storage: StorageService} | null} = {current: null};
    const plugin: PluginDefinition = {
        id: "nbook.workbench",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}, {key: storageKey}],
            activate: (context) => {
                const storage = context.services.require(storageKey);
                const store = layoutStoreFor(bound).create(context, {storage, diagnostics: context.services.require(diagnosticsKey)});
                store.actions.acceptViewCatalog(catalog);
                hosted.current = {store, storage};
                return {};
            },
        }],
    };
    const window = await world.window(id, client, [plugin], {bound});
    if (hosted.current === null) throw new Error("store 没有创建");
    const {store, storage} = hosted.current;
    await waitUntil(`${id} 的布局就绪`, () => store.state.ready);
    return {store, storage, window};
}
