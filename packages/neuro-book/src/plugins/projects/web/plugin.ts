/**
 * `nbook.projects` 浏览器入口：向命令系统贡献“打开项目”与“欢迎”，向工作台的 `workbench.home` 贡献书架页、向编辑器的
 * `editor.pages` 贡献欢迎页（docs/specs/workbench/bookshelf.md）。选择候选用工作台的选择服务（命令面板的选择模式），整页导航与新标签页用宿主能力 `windowNavigationKey`。
 */

import {Type} from "typebox";
import {computed} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {COMMANDS_POINT, commandServiceKey, currentKeyPlatform, formatKeybinding} from "nbook/plugins/commands/shared/contracts";
import {EDITOR_PAGES_POINT, OPEN_PAGE_COMMAND} from "nbook/plugins/editor/shared/contracts";
import type {EditorPageDeclaration} from "nbook/plugins/editor/shared/contracts";
import type {EditorPageImplementation} from "nbook/plugins/editor/web/pages";
import {filesKey} from "nbook/plugins/files/shared/contracts";
import type {CommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {displayLocale, settingsKey} from "nbook/plugins/settings/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {notificationsKey, quickPickKey, WORKBENCH_HOME_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {HomeDeclaration} from "nbook/plugins/workbench/shared/contracts";
import type {WorkbenchHomeImplementation} from "nbook/plugins/workbench/web/contracts";
import {clockKey, windowNavigationKey} from "nbook/shared/host";
import {windowProjectKey} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {projectsRemoteContract} from "../shared/contracts";
import {projectCoverUrl} from "../shared/cover";
import {createBookshelfHome} from "./bookshelf-home";
import {OPEN_PROJECT_COMMAND, OPEN_PROJECT_DECLARATION, openProject} from "./open-project";
import type {OpenProjectHost} from "./open-project";
import {createShelfPage} from "./shelf-page";
import type {CoverTransport, CoverTransportResult} from "./shelf-page";
import {shelfPreferencesStore} from "./shelf-preferences";
import type {ShelfPreferencesStore} from "./shelf-preferences";
import {createWelcomeHost, WELCOME_PAGE_ID} from "./welcome";

const DECLARATION: CommandDeclaration = {...OPEN_PROJECT_DECLARATION, args: Type.Object({}, {additionalProperties: false})};

export const BOOKSHELF_HOME_ID = "nbook.projects.bookshelf";
const HOME_DECLARATION: HomeDeclaration = {title: {"zh-CN": "书架", "en-US": "Bookshelf"}};

/** “帮助 > 欢迎”与命令面板打开欢迎页的命令。 */
export const WELCOME_COMMAND = "nbook.help.welcome";
const WELCOME_DECLARATION: CommandDeclaration = {
    title: {"zh-CN": "欢迎", "en-US": "Welcome"},
    category: {"zh-CN": "帮助", "en-US": "Help"},
    description: "Open the welcome page of the work in this window: overview, new chapter, recent files and getting-started tips.",
    args: Type.Object({}, {additionalProperties: false}),
    effect: "read",
    expose: {agent: "never"},
};
/** 作品第一次在本窗口打开时自动打开（docs/specs/workbench/editor.md 输出 33）。 */
const WELCOME_PAGE: EditorPageDeclaration = {title: {"zh-CN": "欢迎", "en-US": "Welcome"}, icon: "i-lucide-book-open", openOnFirstVisit: true};

/** 命令面板的命令（与工作台的命令搜索同一条）：欢迎页的入门提示显示它的快捷键。 */
const OPEN_COMMANDS_ID = "nbook.quick-open.open-commands";

export const projectsBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        // 命令随贡献方入口激活才进命令表（还没有按命令触发的激活事件）：启动即激活，面板里才列得出“打开项目”。
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}, {key: quickPickKey}, {key: windowNavigationKey}, {key: settingsKey}, {key: storageKey}, {key: clockKey}, {key: notificationsKey}, {key: commandServiceKey}, {key: windowProjectKey}, {key: filesKey, required: false}],
        contributions: [
            {capability: COMMANDS_POINT, id: OPEN_PROJECT_COMMAND, declaration: DECLARATION},
            {capability: COMMANDS_POINT, id: WELCOME_COMMAND, declaration: WELCOME_DECLARATION},
            {capability: WORKBENCH_HOME_POINT, id: BOOKSHELF_HOME_ID, declaration: HOME_DECLARATION},
            {capability: EDITOR_PAGES_POINT, id: WELCOME_PAGE_ID, declaration: WELCOME_PAGE},
        ],
        activate: async (context) => {
            const quickPick = context.services.require(quickPickKey);
            const navigation = context.services.require(windowNavigationKey);
            const remote = context.remote.use(projectsRemoteContract);
            const settings = context.services.require(settingsKey);
            const diagnostics = context.services.require(diagnosticsKey);
            const storage = context.services.require(storageKey);
            const clock = context.services.require(clockKey);
            const notifications = context.services.require(notificationsKey);
            const commands = context.services.require(commandServiceKey);
            const locale = computed(() => displayLocale(settings));
            const host: OpenProjectHost = {
                remote,
                quickPick,
                navigateDocument: (href) => navigation.navigateDocument(href),
                locale: () => locale.value,
                recordFailure: (reason, detail) => diagnostics.record({level: "info", event: "projects.register-failed", message: "登记项目失败", data: {reason, detail}, source: {plugin: descriptor.id}}),
            };
            // 偏好记录在书架第一次渲染时才打开：绑定了项目的窗口不读它。
            let store: ShelfPreferencesStore | null = null;
            const preferences = (): ShelfPreferencesStore => (store ??= shelfPreferencesStore.create(context, {storage, diagnostics}));
            const home: WorkbenchHomeImplementation = {
                load: async () => createBookshelfHome({
                    component: (await import("./components/BookshelfHost.vue")).default,
                    locale,
                    createPage: () => createShelfPage({
                        remote,
                        clock,
                        locale: () => locale.value,
                        preferences: {
                            view: computed(() => preferences().state.preferences.display.view),
                            sort: computed(() => preferences().state.preferences.display.sort),
                            setView: (view) => preferences().actions.setView(view),
                            setSort: (sort) => preferences().actions.setSort(sort),
                        },
                        settings,
                        navigation,
                        notifications,
                        cover: coverTransport(),
                        commands: {execute: async (id) => {
                            const result = await commands.execute(id, undefined, {source: "user"});
                            return result.ok ? {ok: true} : {ok: false, reason: `${result.code}：${result.reason}`};
                        }},
                        report: (event, message) => diagnostics.record({level: "warn", event, message, source: {plugin: descriptor.id}}),
                    }),
                }),
            };
            const project = context.services.require(windowProjectKey).project;
            // 欢迎页的快捷入口与“新建章节”要文件服务；书架不要，没有装文件插件的窗口照样有书架。
            const files = await context.services.resolve(filesKey);
            const welcome: EditorPageImplementation = {
                load: async () => createWelcomeHost({
                    component: (await import("./components/WelcomePage.vue")).default,
                    project: project === null ? null : {id: project.id, title: project.title},
                    remote,
                    files: files.status === "resolved" ? files.instance : null,
                    commands,
                    navigateDocument: (href) => navigation.navigateDocument(href),
                    locale: () => locale.value,
                    now: () => clock.now(),
                    shortcut: () => {
                        const command = commands.get(OPEN_COMMANDS_ID);
                        return command.ok && command.value.keybinding !== undefined ? formatKeybinding(command.value.keybinding, currentKeyPlatform()) : null;
                    },
                    report: (message) => diagnostics.record({level: "warn", event: "projects.welcome", message, source: {plugin: descriptor.id}}),
                }),
            };
            return {contributions: {
                [COMMANDS_POINT]: {
                    [OPEN_PROJECT_COMMAND]: {run: () => openProject(host)},
                    [WELCOME_COMMAND]: {run: () => commands.execute(OPEN_PAGE_COMMAND, {id: WELCOME_PAGE_ID}, {source: "user"})},
                },
                [WORKBENCH_HOME_POINT]: {[BOOKSHELF_HOME_ID]: home},
                [EDITOR_PAGES_POINT]: {[WELCOME_PAGE_ID]: welcome},
            }};
        },
    })],
};

/** 封面经服务端入口的 HTTP 路由（docs/specs/runtime/projects.md 输出第 21 条）：同源，浏览器直接 fetch。 */
function coverTransport(): CoverTransport {
    const failure = async (response: Response): Promise<CoverTransportResult> => {
        const body = await response.json().catch(() => null) as {readonly code?: string; readonly detail?: string} | null;
        return {ok: false, code: body?.code ?? String(response.status), detail: body?.detail ?? response.statusText};
    };
    const url = (id: string): string => projectCoverUrl(id, "").split("?")[0] ?? "";
    return {
        upload: async (id, file) => {
            const form = new FormData();
            form.set("file", file, file.name);
            try {
                const response = await fetch(url(id), {method: "PUT", body: form});
                return response.ok ? {ok: true} : failure(response);
            } catch (error) {
                return {ok: false, code: "network", detail: error instanceof Error ? error.message : String(error)};
            }
        },
        remove: async (id) => {
            try {
                const response = await fetch(url(id), {method: "DELETE"});
                return response.ok ? {ok: true} : failure(response);
            } catch (error) {
                return {ok: false, code: "network", detail: error instanceof Error ? error.message : String(error)};
            }
        },
    };
}
