import { test, expect, type Page } from "./fixtures";

/**
 * /lab 诊断实验室的行为级用例（Task 150 阶段 D）。
 * 断言面全是用户可观察合同：URL 五参数、真实元素的计算样式、portal 内容、
 * 焦点归还、事件日志与离开页面后的残留。控制台 error 与 pageerror 由 fixtures.ts 归零。
 */

const THEMES = ["editorial", "macos", "aurora", "nbook"] as const;

type LabParams = {
    component?: string;
    scene?: string;
    viewport?: string;
    theme?: string;
    colorway?: string;
};

/** 直接以五参数 URL 进入 /lab，等待目标出现（默认绕开 UI 操作，单测单一职责） */
async function gotoLab(page: Page, params: LabParams = {}): Promise<URL> {
    const query = new URLSearchParams({
        component: params.component ?? "form-input",
        scene: params.scene ?? "default",
        viewport: params.viewport ?? "responsive",
        theme: params.theme ?? "nbook",
        colorway: params.colorway ?? "nbook-light",
    });
    await page.goto(`/lab?${query.toString()}`);
    await expect(page.locator("#nb-lab-target")).toBeVisible();
    return new URL(page.url());
}

async function readCssVar(page: Page, name: string): Promise<string> {
    return page.evaluate((token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(), name);
}

/** 切主题 / 开浮层后读数前必须等过过渡（坑 #18：--motion-fast 90–120ms，等待不足会读到中间态） */
async function settle(page: Page, ms = 600): Promise<void> {
    await page.waitForTimeout(ms);
}

test("smoke: 首页打开无报错", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("nb-ui 设计实验室")).toBeVisible();
});

test("lab: 打开 /lab 无报错且 URL 首屏归一化", async ({ page }) => {
    await page.goto("/lab");
    await page.waitForURL(/component=form-input/);
    const url = new URL(page.url());
    expect(url.searchParams.get("component")).toBe("form-input");
    expect(url.searchParams.get("scene")).toBe("default");
    expect(url.searchParams.get("viewport")).toBe("responsive");
    expect(url.searchParams.get("theme")).toBeTruthy();
    expect(url.searchParams.get("colorway")).toBeTruthy();
    await expect(page.locator("#nb-lab-target")).toBeVisible();
});

test("场景切换同步 URL，刷新后恢复", async ({ page }) => {
    await gotoLab(page);
    await page.locator('[aria-label="场景"]').getByText("前缀").click();
    await page.waitForURL(/scene=prefix/);
    // 前缀场景的可见证据：prefix 槽位的 @ 渲染出来
    await expect(page.getByText("@", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator("#nb-lab-target")).toBeVisible();
    const url = new URL(page.url());
    expect(url.searchParams.get("scene")).toBe("prefix");
    await expect(page.getByText("@", { exact: true })).toBeVisible();
});

test("非法 URL 首屏归一化并用 replace 覆盖历史", async ({ page }) => {
    await page.goto("/lab?component=bogus&scene=nope&viewport=huge&theme=ghost&colorway=ghost");
    await page.waitForURL(/component=form-input/);
    const url = new URL(page.url());
    expect(url.searchParams.get("scene")).toBe("default");
    expect(url.searchParams.get("viewport")).toBe("responsive");
    expect(url.searchParams.get("theme")).not.toBe("ghost");
    // replace 语义：历史里只有归一化后的这一条，后退不会回到非法 URL
    await page.goBack();
    expect(page.url()).not.toContain("/lab");
});

test("theme=bare 裸基线可复现且不装主题", async ({ page }) => {
    await gotoLab(page, { theme: "bare" });
    const url = new URL(page.url());
    expect(url.searchParams.get("theme")).toBe("bare");
    const hasTheme = await page.evaluate(() => document.documentElement.hasAttribute("data-nb-theme"));
    expect(hasTheme).toBe(false);
    await page.reload();
    await expect(page.locator("#nb-lab-target")).toBeVisible();
    expect(new URL(page.url()).searchParams.get("theme")).toBe("bare");
});

test("4 主题 × 明暗配色切换后读数变化", async ({ page }) => {
    for (const theme of THEMES) {
        const readings: string[] = [];
        for (const colorway of ["nbook-light", "nbook-dark"]) {
            await gotoLab(page, { theme, colorway });
            await settle(page);
            const value = await readCssVar(page, "--bg-panel");
            expect(value, `${theme}/${colorway} 的 --bg-panel 应有值`).not.toBe("");
            // 变量面板的当前计算值（读的是元素计算样式，不是变量表）与根读数一致
            const input = page.getByLabel("--bg-panel 覆盖值");
            await expect(input).toHaveAttribute("placeholder", value);
            readings.push(value);
        }
        expect(readings[0], `${theme} 明暗两档的 --bg-panel 必须不同`).not.toBe(readings[1]);
    }
});

test("变量覆盖实时更新读数，单项与全部重置生效", async ({ page }) => {
    await gotoLab(page);
    const original = await readCssVar(page, "--accent-main");

    const input = page.getByLabel("--accent-main 覆盖值");
    await input.fill("rebeccapurple");
    await input.blur();
    await settle(page);
    expect(await readCssVar(page, "--accent-main")).toBe("rebeccapurple");
    await expect(page.locator(".lab-vars__count")).toHaveText("1 项覆盖");

    // 单项重置
    await page.getByRole("button", { name: "重置 --accent-main" }).click();
    await settle(page);
    expect(await readCssVar(page, "--accent-main")).toBe(original);
    await expect(page.locator(".lab-vars__count")).toHaveText("0 项覆盖");

    // 全部重置
    await input.fill("rebeccapurple");
    await input.blur();
    const other = page.getByLabel("--bg-panel 覆盖值");
    await other.fill("rgb(1, 2, 3)");
    await other.blur();
    await expect(page.locator(".lab-vars__count")).toHaveText("2 项覆盖");
    await page.getByRole("button", { name: "全部重置" }).click();
    await settle(page);
    await expect(page.locator(".lab-vars__count")).toHaveText("0 项覆盖");
    expect(await readCssVar(page, "--accent-main")).toBe(original);
});

test("快照导出为合法 JSON，导入合法生效，三份非法拒入且不污染旧覆盖", async ({ page }) => {
    await gotoLab(page);
    const input = page.getByLabel("--accent-main 覆盖值");
    await input.fill("rebeccapurple");
    await input.blur();
    await settle(page);

    // 导出：内容是可再导入的快照
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 JSON 快照" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("nb-ui-component-lab-overrides.json");
    const stream = await download.createReadStream();
    let raw = "";
    for await (const chunk of stream) raw += String(chunk);
    const snapshot = JSON.parse(raw) as { schema: string; version: number; overrides: Record<string, string> };
    expect(snapshot.schema).toBe("nb-ui-component-lab-overrides");
    expect(snapshot.version).toBe(1);
    expect(snapshot.overrides["--accent-main"]).toBe("rebeccapurple");

    const fileInput = page.locator("input[type=file].lab-vars__file");
    const upload = async (payload: unknown) => {
        await fileInput.setInputFiles({
            name: "snapshot.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(payload)),
        });
    };
    const valid = (overrides: Record<string, string>) => ({
        schema: "nb-ui-component-lab-overrides",
        version: 1,
        overrides,
    });

    // 非法 1：未登记变量——拒入且旧覆盖（rebeccapurple）不变
    await upload(valid({ "--not-a-token": "red" }));
    await expect(page.locator(".lab-vars__status")).toContainText("导入被拒绝");
    await expect(page.locator(".lab-vars__status")).toContainText("未登记的变量");
    await expect(page.locator(".lab-vars__count")).toHaveText("1 项覆盖");
    expect(await readCssVar(page, "--accent-main")).toBe("rebeccapurple");

    // 非法 2：值里带分号注入
    await upload(valid({ "--accent-main": "red;position:fixed" }));
    await expect(page.locator(".lab-vars__status")).toContainText("导入被拒绝");
    await expect(page.locator(".lab-vars__status")).toContainText("分号");
    await expect(page.locator(".lab-vars__count")).toHaveText("1 项覆盖");
    expect(await readCssVar(page, "--accent-main")).toBe("rebeccapurple");

    // 非法 3：schema 不符
    await upload({ schema: "wrong", version: 1, overrides: { "--accent-main": "blue" } });
    await expect(page.locator(".lab-vars__status")).toContainText("导入被拒绝");
    await expect(page.locator(".lab-vars__status")).toContainText("schema");
    await expect(page.locator(".lab-vars__count")).toHaveText("1 项覆盖");
    expect(await readCssVar(page, "--accent-main")).toBe("rebeccapurple");

    // 合法导入：整份替换
    await upload(valid({ "--accent-main": "rgb(9, 8, 7)" }));
    await expect(page.locator(".lab-vars__status")).toContainText("已导入 1 项覆盖");
    await settle(page);
    expect(await readCssVar(page, "--accent-main")).toBe("rgb(9, 8, 7)");
});

test("数字输入：中间态保留、步进 clamp、Enter 提交", async ({ page }) => {
    await gotoLab(page, { component: "form-number-input" });
    const target = page.locator("#nb-lab-target");

    // 中间态：负号与小数点原样保留（min=0 max=2 step=0.5）
    await target.fill("-");
    await expect(target).toHaveValue("-");
    await target.fill("1.");
    await expect(target).toHaveValue("1.");

    // 非有限值上步进：从 min 起跳 + 1 档 step（min=0 step=0.5 -> 0.5）
    await target.fill("-");
    await target.press("ArrowUp");
    await expect(target).toHaveValue("0.5");

    // Enter 提交进入事件日志
    await page.locator('[aria-label="检查器页签"]').getByText("事件").click();
    await target.fill("1.5");
    await target.press("Enter");
    await expect(page.locator(".lab-events__row").first()).toContainText("submit");

    // 边界场景：从 max 起步，ArrowUp 被 clamp 住
    await gotoLab(page, { component: "form-number-input", scene: "bounded" });
    await expect(target).toHaveValue("2");
    await target.press("ArrowUp");
    await expect(target).toHaveValue("2");
    await target.press("ArrowDown");
    await expect(target).toHaveValue("1.5");
});

test("选择器：Enter 展开、富选项、禁用项、焦点归还、body 不锁", async ({ page }) => {
    await gotoLab(page, { component: "form-select", scene: "rich" });
    const trigger = page.locator("#nb-lab-target");

    // 键盘 Enter 展开（坑 #26：弹出层必须打开测，不能只测关闭态）
    await trigger.focus();
    await page.keyboard.press("Enter");
    const listbox = page.locator("[role=listbox]");
    await expect(listbox).toBeVisible();
    // 向下展开时 data-side=bottom
    await expect(page.locator("[data-reka-popper-content-wrapper] > *").first()).toHaveAttribute("data-side", "bottom");

    // 非模态浮层：页面仍是活的（坑 #33——先断言列表开着再断言 body 无 lock）
    const bodyStyle = await page.evaluate(() => ({ overflow: document.body.style.overflow, pointerEvents: document.body.style.pointerEvents }));
    expect(bodyStyle).toEqual({ overflow: "", pointerEvents: "" });

    // 富选项：说明文字与图标都渲染
    await expect(listbox.getByText("适合长文写作")).toBeVisible();
    await expect(listbox.locator(".i-lucide-file-text").first()).toBeAttached();

    // 禁用项不可选：值保持预选 md
    await listbox.getByText("PDF（暂不可用）").click();
    await expect(trigger).toContainText("Markdown（.md）");
    await expect(listbox).toBeVisible();

    // Escape 关闭且焦点回到触发器
    await page.keyboard.press("Escape");
    await expect(listbox).toBeHidden();
    const focusBack = await page.evaluate(() => document.activeElement === document.querySelector("#nb-lab-target"));
    expect(focusBack).toBe(true);
});

test("选择器向上展开时 data-side=top", async ({ page }) => {
    await gotoLab(page, { component: "form-select" });
    await page.locator(".lab-props__row", { hasText: "展开方向" }).locator("[role=combobox]").click();
    await page.locator("[role=listbox]").getByText("向上").click();
    const trigger = page.locator("#nb-lab-target");
    await trigger.click();
    await expect(page.locator("[role=listbox][data-state=open]")).toBeVisible();
    await expect(page.locator("[data-reka-popper-content-wrapper] > *").first()).toHaveAttribute("data-side", "top");
});

test("输入框：prefix 渲染、focus 入事件日志", async ({ page }) => {
    await gotoLab(page, { component: "form-input", scene: "prefix" });
    await expect(page.getByText("@", { exact: true })).toBeVisible();
    await page.locator('[aria-label="检查器页签"]').getByText("事件").click();
    await page.locator("#nb-lab-target").click();
    await expect(page.locator(".lab-events__row").first()).toContainText("focus");
});

test("复选框：无 label 时回退显示布尔值，focus 入事件日志", async ({ page }) => {
    await gotoLab(page, { component: "form-checkbox", scene: "fallback" });
    const target = page.locator("#nb-lab-target");
    await expect(target).toHaveRole("checkbox");
    // fallback 场景从 false 起步，组件显示当前布尔值
    await expect(page.locator(".lab-canvas").getByText("false", { exact: true })).toBeVisible();
    await page.locator('[aria-label="检查器页签"]').getByText("事件").click();
    // 目标是 sr-only 的原生 input，指针操作走它的 label 包装（label 激活会聚焦控件）
    await page.locator(".lab-canvas label").first().click();
    await expect(page.locator(".lab-events__row", { hasText: "focus" }).first()).toBeVisible();
});

test("事件日志 100 条封顶且可清空", async ({ page }) => {
    await gotoLab(page, { component: "button" });
    const target = page.locator("#nb-lab-target");
    await page.locator('[aria-label="检查器页签"]').getByText("事件").click();
    for (let i = 0; i < 105; i += 1) {
        await target.click();
    }
    await expect(page.locator(".lab-events__count")).toHaveText("100/100");
    await page.getByRole("button", { name: "清空事件日志" }).click();
    await expect(page.locator(".lab-events__count")).toHaveText("0/100");
    await expect(page.getByText("与组件交互后事件会出现在这里")).toBeVisible();
});

test("离开 /lab 后覆盖层与激活属性无残留", async ({ page }) => {
    await gotoLab(page);
    const input = page.getByLabel("--accent-main 覆盖值");
    await input.fill("rebeccapurple");
    await input.blur();
    await page.locator(".lab-vars__count").filter({ hasText: "1 项覆盖" }).waitFor();
    await expect(page.locator("#nb-ui-component-lab-overrides")).toBeAttached();
    await page.goto("/components");
    await expect(page.locator("#nb-ui-component-lab-overrides")).toHaveCount(0);
    const hasAttr = await page.evaluate(() => document.documentElement.hasAttribute("data-nb-lab-active"));
    expect(hasAttr).toBe(false);
});

test("1440 与 390 宽度下根节点无横向溢出", async ({ page }) => {
    for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 800 });
        await gotoLab(page);
        await settle(page, 300);
        const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
        expect(fits, `${width}px 下不应有页面级横向溢出`).toBe(true);
    }
});
