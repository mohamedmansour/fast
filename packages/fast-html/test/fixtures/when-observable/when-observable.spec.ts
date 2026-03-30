import { expect, test } from "@playwright/test";

test.describe("f-when with @observable property change after hydration", async () => {
    test("initial state: workplaceJoined=true shows Continue, hides error/retry", async ({
        page,
    }) => {
        await page.goto("/fixtures/when-observable/");

        const el = page.locator("#test");

        await expect(el.locator(".continue-btn")).toHaveText("Continue");
        await expect(el.locator(".error-msg")).toHaveCount(0);
        await expect(el.locator(".retry-btn")).toHaveCount(0);
        await expect(el.locator(".cancel-btn")).toHaveText("Cancel");
    });
    test("change workplaceJoined to false: Continue hidden, error/retry visible", async ({
        page,
    }) => {
        await page.goto("/fixtures/when-observable/");

        const el = page.locator("#test");

        // Wait for hydration to complete
        await expect(el.locator(".continue-btn")).toHaveText("Continue");

        // Simulate mojo callback changing workplaceJoined to false
        await page.evaluate(() => {
            const el = document.getElementById("test") as any;
            el.workplaceJoined = false;
        });

        await expect(el.locator(".continue-btn")).toHaveCount(0);
        await expect(el.locator(".error-msg")).toHaveText("Workplace join required");
        await expect(el.locator(".retry-btn")).toHaveText("Retry");
        await expect(el.locator(".cancel-btn")).toHaveText("Cancel");
    });
    test("reactive round-trip: toggle workplaceJoined without page reload", async ({
        page,
    }) => {
        await page.goto("/fixtures/when-observable/");

        const el = page.locator("#test");

        // Verify initial state after hydration
        await expect(el.locator(".continue-btn")).toHaveText("Continue");
        await expect(el.locator(".error-msg")).toHaveCount(0);

        // Change to false
        await page.evaluate(() => {
            const el = document.getElementById("test") as any;
            el.workplaceJoined = false;
        });

        // Verify reactive update
        await expect(el.locator(".continue-btn")).toHaveCount(0);
        await expect(el.locator(".error-msg")).toHaveText("Workplace join required");
        await expect(el.locator(".retry-btn")).toHaveText("Retry");

        // Change back to true
        await page.evaluate(() => {
            const el = document.getElementById("test") as any;
            el.workplaceJoined = true;
        });

        // Verify restoration without reload
        await expect(el.locator(".continue-btn")).toHaveText("Continue");
        await expect(el.locator(".error-msg")).toHaveCount(0);
        await expect(el.locator(".retry-btn")).toHaveCount(0);
        await expect(el.locator(".cancel-btn")).toHaveText("Cancel");
    });
});
