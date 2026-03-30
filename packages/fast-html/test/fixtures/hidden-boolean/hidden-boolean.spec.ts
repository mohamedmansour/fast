import { expect, test } from "@playwright/test";

test.describe("?hidden boolean attribute with @observable after hydration", async () => {
    test("initial state: showContent=true shows content, hides fallback", async ({
        page,
    }) => {
        await page.goto("/fixtures/hidden-boolean/");

        const el = page.locator("#test");
        const content = el.locator(".content");
        const fallback = el.locator(".fallback");

        await expect(content).toBeVisible();
        await expect(content).not.toHaveAttribute("hidden");
        await expect(fallback).not.toBeVisible();
        await expect(fallback).toHaveAttribute("hidden", "");
    });
    test("change showContent to false: content gets hidden, fallback becomes visible", async ({
        page,
    }) => {
        await page.goto("/fixtures/hidden-boolean/");

        const el = page.locator("#test");
        const content = el.locator(".content");
        const fallback = el.locator(".fallback");

        // Wait for hydration to complete
        await expect(content).toBeVisible();

        // Programmatically change the @observable property
        await page.evaluate(() => {
            const el = document.getElementById("test") as any;
            el.showContent = false;
        });

        await expect(content).toHaveAttribute("hidden", "");
        await expect(content).not.toBeVisible();
        await expect(fallback).not.toHaveAttribute("hidden");
        await expect(fallback).toBeVisible();
    });
    test("restore showContent to true: restores initial state", async ({ page }) => {
        await page.goto("/fixtures/hidden-boolean/");

        const el = page.locator("#test");
        const content = el.locator(".content");
        const fallback = el.locator(".fallback");

        // Wait for hydration
        await expect(content).toBeVisible();

        // Change to false
        await page.evaluate(() => {
            const el = document.getElementById("test") as any;
            el.showContent = false;
        });

        await expect(content).not.toBeVisible();

        // Change back to true
        await page.evaluate(() => {
            const el = document.getElementById("test") as any;
            el.showContent = true;
        });

        await expect(content).toBeVisible();
        await expect(content).not.toHaveAttribute("hidden");
        await expect(fallback).not.toBeVisible();
        await expect(fallback).toHaveAttribute("hidden", "");
    });
});
