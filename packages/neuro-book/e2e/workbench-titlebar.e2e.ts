/**
 * 标题栏在真实 Chrome 中的验收（docs/specs/ui/workbench-shell.md 外壳四验收 32–37）：生产构建的后端与前端，项目
 * `book` 先登记好，文件在真实目录里。文档站的地址被拦到本地回应，测试不访问外网。等页面上可观察的变化，不按时长等待。
 */

import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

let tmp = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "workbench-titlebar");
    const projectDir = join(tmp, "Book");
    const stateRoot = join(tmp, "state");
    const id = randomUUID();
    const files: Record<string, string> = {".nbook/project.json": JSON.stringify({schema: 1, id}), "notes/a.md": "第一章\n", "notes/b.md": "第二章\n"};
    for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(projectDir, path)), {recursive: true});
        await writeFile(join(projectDir, path), text);
    }
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const titlebar = (page: Page) => page.locator("[data-workbench-titlebar]");
const prose = (page: Page) => page.locator("[data-editor-group-active] [data-editor-kind=\"markdown\"]:visible [data-editor-prose]");
const openMenu = (page: Page) => page.locator('[role="menu"][data-state="open"]');

async function open(page: Page, project = true): Promise<void> {
    await page.goto(new URL(project ? "/?project=book" : "/", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(titlebar(page)).toBeVisible();
}

/** 打开 notes/a.md 并在正文末尾输入。 */
async function editA(page: Page, typed: string): Promise<void> {
    const notes = page.locator('[data-explorer-row="project://notes"]');
    if (await notes.getAttribute("aria-expanded") !== "true") await notes.click();
    await page.locator('[data-explorer-row="project://notes/a.md"]').dblclick();
    await expect(prose(page)).toContainText("第一章");
    await prose(page).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(typed);
    await expect(prose(page)).toContainText(typed);
}

test("标题栏 36px、状态栏 22px；菜单只有命令目录里有的项，禁用项带原因，旧桌面专属项都不出现", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await open(page);
    expect((await titlebar(page).boundingBox())?.height).toBe(36);
    expect((await page.locator("[data-workbench-status-bar]").boundingBox())?.height).toBe(22);
    await expect(titlebar(page)).toHaveAttribute("data-titlebar-level", "0");

    const labels: string[] = [];
    for (const group of ["文件", "编辑", "视图", "帮助"]) {
        await titlebar(page).getByRole("menuitem", {name: group}).click();
        await expect(openMenu(page)).toBeVisible();
        labels.push(...(await openMenu(page).locator('[role^="menuitem"]').allTextContents()).map((text) => text.trim()));
        await page.keyboard.press("Escape");
        await expect(openMenu(page)).toHaveCount(0);
    }
    for (const absent of ["打开文件", "设置", "退出", "剪切", "复制", "粘贴", "全选", "放大", "缩小", "关于"]) expect(labels.some((label) => label.startsWith(absent)), absent).toBe(false);
    expect(labels.some((label) => label.startsWith("重新载入"))).toBe(true);

    await titlebar(page).getByRole("menuitem", {name: "编辑"}).click();
    const undo = openMenu(page).getByRole("menuitem", {name: "撤销"});
    await expect(undo).toHaveAttribute("aria-disabled", "true");
    await expect(undo).toHaveAttribute("aria-description", /活动/u);
    await page.keyboard.press("Escape");
});

test("从“编辑”菜单撤销：点击与 F10 加方向键两条路径都让活动编辑器的正文回退；Escape 还焦点", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await open(page);
    await editA(page, "甲");
    await titlebar(page).getByRole("menuitem", {name: "编辑"}).click();
    await openMenu(page).getByRole("menuitem", {name: "撤销"}).click();
    await expect(prose(page)).not.toContainText("甲");

    await prose(page).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("乙");
    await expect(prose(page)).toContainText("乙");
    await page.keyboard.press("F10");
    await expect(titlebar(page).getByRole("menuitem", {name: "文件"})).toBeFocused();
    await page.keyboard.press("ArrowRight");
    // 用 Enter 打开时焦点直接落在第一项上。
    await page.keyboard.press("Enter");
    await expect(openMenu(page).getByRole("menuitem", {name: "撤销"})).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(prose(page)).not.toContainText("乙");

    // 菜单都关着时，F10 之后按 Escape，焦点回到按 F10 之前的编辑器正文。
    await prose(page).click();
    await page.keyboard.press("F10");
    await expect(titlebar(page).getByRole("menuitem", {name: "文件"})).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(prose(page)).toBeFocused();

    // 菜单从浮层里按 Escape 关闭：焦点同样回到打开前的正文，不停在组标题上。
    await page.keyboard.press("F10");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(openMenu(page).getByRole("menuitem", {name: "撤销"})).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(openMenu(page)).toHaveCount(0);
    await expect(prose(page)).toBeFocused();

    // F10 之后把焦点挪到搜索按钮再按 Escape：与会话无关，焦点留在搜索按钮上。
    await page.keyboard.press("F10");
    await page.keyboard.press("Tab");
    await expect(titlebar(page).locator("[data-titlebar-search]")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(titlebar(page).locator("[data-titlebar-search]")).toBeFocused();
});

test("逐级让位：从 1440 收到 390 依次收起横排标志、菜单栏、快捷键提示、布局按钮、项目名；任何宽度都有可点的菜单入口，关键按钮完整可见；放宽要多 40px", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await open(page);
    // 测量层里的复本不算
    const live = (selector: string) => titlebar(page).locator(`${selector}:not(.workbench-titlebar__measure *)`);
    const levelAt = async () => Number(await titlebar(page).getAttribute("data-titlebar-level"));
    const firstWidth: Record<number, number> = {};
    let previous = 0;
    for (let width = 1440; width >= 390; width -= 10) {
        await page.setViewportSize({width, height: 700});
        await expect.poll(async () => (await titlebar(page).boundingBox())!.width).toBeLessThanOrEqual(width);
        const level = await levelAt();
        expect(level, `${String(width)} 档位只增不减`).toBeGreaterThanOrEqual(previous);
        previous = level;
        firstWidth[level] ??= width;
        // 每一档的样子
        await expect(live(".workbench-titlebar__brand")).toHaveCount(level < 1 ? 1 : 0);
        await expect(live(".workbench-titlebar__mark")).toHaveCount(level < 1 ? 0 : 1);
        await expect(live("[data-titlebar-search] kbd")).toHaveCount(level < 3 ? 1 : 0);
        await expect(live("[data-titlebar-layout]")).toHaveCount(level < 4 ? 3 : 0);
        await expect(live(".workbench-titlebar__project-name")).toHaveCount(level < 5 ? 1 : 0);
        const entry = level < 2 ? titlebar(page).getByRole("menuitem", {name: "文件"}) : live("button[data-titlebar-menu-entry]");
        for (const target of [entry, live("[data-titlebar-search]"), live("[data-titlebar-project]")]) {
            const box = await target.boundingBox();
            expect(box, `${String(width)} ${await target.textContent()}`).not.toBeNull();
            expect(box!.x).toBeGreaterThanOrEqual(0);
            expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        }
        expect((await live("[data-titlebar-search]").boundingBox())!.width, `${String(width)} 搜索最窄 120`).toBeGreaterThanOrEqual(119.5);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    expect(Object.keys(firstWidth).map(Number).sort()).toEqual([0, 1, 2, 3, 4, 5]);

    // 收成 ≡ 后（M1）：一组一行，方向键展开子菜单
    await page.setViewportSize({width: firstWidth[2]!, height: 700});
    await expect.poll(levelAt).toBe(2);
    await live("button[data-titlebar-menu-entry]").click();
    const rows = openMenu(page).getByRole("menuitem");
    await expect(rows).toHaveText(["文件", "编辑", "视图", "帮助"]);
    await rows.nth(2).hover();
    await expect(page.getByRole("menuitemcheckbox", {name: "侧栏"})).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // 回差：从刚收起菜单栏的宽度往回放宽，不到 40px 不放，够了才放
    await page.setViewportSize({width: firstWidth[2]! + 30, height: 700});
    await expect.poll(levelAt).toBe(2);
    await page.setViewportSize({width: firstWidth[2]! + 60, height: 700});
    await expect.poll(levelAt).toBeLessThan(2);
});

test("侧栏按钮、视图菜单的勾选与命令面板的“切换区域显隐”一致；命令面板省略参数时先选区域，取消不改", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await open(page);
    const button = titlebar(page).locator('[data-titlebar-layout="sidebar"]');
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await titlebar(page).getByRole("menuitem", {name: "视图"}).click();
    await expect(openMenu(page).getByRole("menuitemcheckbox", {name: "侧栏"})).toHaveAttribute("aria-checked", "false");
    await openMenu(page).getByRole("menuitemcheckbox", {name: "侧栏"}).click();
    await expect(button).toHaveAttribute("aria-pressed", "true");

    const aux = titlebar(page).locator('[data-titlebar-layout="auxiliarybar"]');
    const before = await aux.getAttribute("aria-pressed");
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("切换区域显隐");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("option", {name: /右栏/u})).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(aux).toHaveAttribute("aria-pressed", before ?? "");
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("切换区域显隐");
    await page.keyboard.press("Enter");
    await page.getByRole("option", {name: /右栏/u}).click();
    await expect(aux).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
});

test("重新载入：有未保存正文时浏览器先问，取消则正文还在；确认后页面重新加载、项目参数不变。文档在新标签打开，原页面不变", async ({page, context}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await context.route("https://notnotype.github.io/**", (route) => route.fulfill({status: 200, contentType: "text/html", body: "<title>docs</title>"}));
    await open(page);
    await editA(page, "丙");

    const runReload = async () => {
        await titlebar(page).getByRole("menuitem", {name: "视图"}).click();
        await openMenu(page).getByRole("menuitem", {name: "重新载入"}).click();
    };
    page.once("dialog", (dialog) => {
        expect(dialog.type()).toBe("beforeunload");
        void dialog.dismiss();
    });
    await runReload();
    await expect(prose(page)).toContainText("丙");

    const popup = page.waitForEvent("popup");
    await titlebar(page).getByRole("menuitem", {name: "帮助"}).click();
    await openMenu(page).getByRole("menuitem", {name: "文档"}).click();
    const docs = await popup;
    await docs.waitForLoadState();
    expect(docs.url()).toBe("https://notnotype.github.io/neuro-book/");
    await docs.close();
    await expect(prose(page)).toContainText("丙");

    page.once("dialog", (dialog) => void dialog.accept());
    const reloaded = page.waitForEvent("load");
    await runReload();
    await reloaded;
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    expect(new URL(page.url()).searchParams.get("project")).toBe("book");
});
