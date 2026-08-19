import { test, expect } from "./fixtures";

test("smoke: 首页打开无报错", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("nb-ui 设计实验室")).toBeVisible();
});

test("lab: 打开 /lab 无报错且 URL 首屏归一化", async ({ page }) => {
    await page.goto("/lab");
    // 首屏归一化：空 query 也会被补全为完整的五参数 URL
    await page.waitForURL(/component=form-input/);
    const url = new URL(page.url());
    expect(url.searchParams.get("component")).toBe("form-input");
    expect(url.searchParams.get("scene")).toBe("default");
    expect(url.searchParams.get("viewport")).toBe("responsive");
    expect(url.searchParams.get("theme")).toBeTruthy();
    expect(url.searchParams.get("colorway")).toBeTruthy();
    await expect(page.locator("#nb-lab-target")).toBeVisible();
    await page.screenshot({ path: "test-results/lab-current.png", fullPage: true });
});
