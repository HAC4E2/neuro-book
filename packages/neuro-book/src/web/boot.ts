/**
 * 窗口启动（runtime.browser-host 启动序列）：先建立窗口运行实例、连上服务端、激活 `nbook.workbench`，再挂载界面。
 * 挂载时窗口要么已经 ready，要么已经落在某种失败状态，所以首屏不会出现半个工作台。产品入口与 e2e 的测试外壳都经这里，
 * 两者只差构建进去的插件。
 */

// 样式顺序：reset 在最前（nb-ui 不带 reset，由消费方负责）；UnoCSS 在 nb-ui 之后，否则 nb-ui 对 `i-lucide-*` 的同特异性
// 规则会盖掉 UnoCSS 的图标遮罩；宿主样式最后。
import "the-new-css-reset/css/reset.css";
import "@notnotype/nb-ui/styles.css";
import "virtual:uno.css";
import "./styles.css";

import {createWebHistory} from "vue-router";

import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import type {PluginDescriptor} from "nbook/manifest";
import type {WindowNavigation} from "nbook/shared/host";

import {rememberDocumentAppearance} from "./host/appearance-hint";
import {readClientIdentity} from "./host/client-identity";
import {createConnection} from "./host/connection";
import {createBrowserWindow} from "./host/window";
import {mountWindowUi} from "./mount";

export interface WindowUiBoot {
    /** 本外壳构建进去的浏览器插件及其定义（宿主适配器固定在 `plugins.ts`）。 */
    readonly builtin: ReadonlyArray<PluginDescriptor>;
    readonly definitions: Readonly<Record<string, PluginDefinition>>;
}

export async function bootWindowUi(options: WindowUiBoot): Promise<void> {
    const container = document.querySelector("#app");
    if (container === null) throw new Error("index.html 缺少 #app");
    const clientIdentity = readClientIdentity(() => window.localStorage);
    if (clientIdentity.problem !== null) console.warn(`[nbook] ${clientIdentity.problem}；客户端身份只在本页有效`);
    // 页面存活期间一直记录，不停止：下一次打开时加载页的第一帧用这里记下的明暗与颜色。
    rememberDocumentAppearance({root: document.documentElement, storage: () => window.localStorage, warn: (message) => console.warn(`[nbook] ${message}`)});
    const navigation: WindowNavigation = {
        navigateDocument: (href) => location.assign(href),
        reloadDocument: () => location.reload(),
        openExternal: (href) => {
            // 不用 `noopener` 特性：带上它时 window.open 总是返回 null，分不出是否被拦截；打开后再切断 opener。
            const opened = window.open(href, "_blank");
            if (opened === null) return "blocked";
            opened.opener = null;
            return "opened";
        },
        currentUrl: () => location.href,
        replaceUrl: (href) => history.replaceState(history.state, "", href),
    };
    const browserWindow = createBrowserWindow({
        connection: createConnection(location.origin),
        page: window,
        console,
        navigation,
        project: new URLSearchParams(location.search).get("project"),
        clientIdentity: clientIdentity.id,
        builtin: options.builtin,
        definitions: options.definitions,
    });
    // 启动期间屏幕上只有 index.html 的静态加载页（界面在 start 之后才挂载）：引导给出书名后写进它预留的位置。
    const stopTitle = browserWindow.onChange((state) => {
        if (state.status !== "starting" || state.projectTitle === null) return;
        const title = container.querySelector("[data-host-loading-title]");
        const hint = container.querySelector("[data-host-loading-hint]");
        if (title !== null) title.textContent = state.projectTitle;
        if (hint !== null) hint.textContent = "正在打开";
    });
    await browserWindow.start();
    stopTitle();
    await mountWindowUi({
        browserWindow,
        container,
        history: createWebHistory(),
        navigateDocument: navigation.navigateDocument,
        reloadDocument: navigation.reloadDocument,
    });
}
