import { expect, test } from "@playwright/test";

test.describe("extractClientBindingTree", () => {
    test("maps factories to ClientBindingNode array with all metadata", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module
            const { extractClientBindingTree } = await import("/main.js");

            const factories = [
                {
                    targetNodeId: "r.0",
                    aspectType: 1,
                    sourceAspect: "textContent",
                    targetTagName: "span",
                },
                {
                    targetNodeId: "r.1",
                    aspectType: 0,
                    dataBinding: { toString: () => "x => x.value" },
                },
            ];

            return extractClientBindingTree(factories);
        });

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
            factoryIndex: 0,
            targetNodeId: "r.0",
            aspectType: 1,
            bindingExpression: "textContent",
            tagName: "span",
        });
        expect(result[1]).toEqual({
            factoryIndex: 1,
            targetNodeId: "r.1",
            aspectType: 0,
            bindingExpression: "x => x.value",
        });
    });

    test("handles factories with no optional metadata", async ({ page }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module
            const { extractClientBindingTree } = await import("/main.js");

            return extractClientBindingTree([{ targetNodeId: "r.0" }]);
        });

        expect(result).toEqual([
            {
                factoryIndex: 0,
                targetNodeId: "r.0",
                aspectType: 0,
            },
        ]);
    });

    test("handles empty factory array", async ({ page }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module
            const { extractClientBindingTree } = await import("/main.js");
            return extractClientBindingTree([]);
        });

        expect(result).toEqual([]);
    });

    test("preserves factory ordering as factoryIndex", async ({ page }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module
            const { extractClientBindingTree } = await import("/main.js");

            const factories = [
                { targetNodeId: "r.3" },
                { targetNodeId: "r.1" },
                { targetNodeId: "r.7" },
            ];

            return extractClientBindingTree(factories);
        });

        expect(result.map((n: { factoryIndex: number }) => n.factoryIndex)).toEqual([
            0, 1, 2,
        ]);
        expect(
            result.map((n: { targetNodeId: string }) => n.targetNodeId)
        ).toEqual(["r.3", "r.1", "r.7"]);
    });

    test("prefers dataBinding.toString over sourceAspect for expression", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module
            const { extractClientBindingTree } = await import("/main.js");

            // When both exist, dataBinding takes precedence
            const factories = [
                {
                    targetNodeId: "r.0",
                    sourceAspect: "fallback",
                    dataBinding: { toString: () => "x => x.primary" },
                },
            ];

            return extractClientBindingTree(factories);
        });

        expect(result[0].bindingExpression).toBe("x => x.primary");
    });
});

test.describe("depthAnalysis", () => {
    test("returns directive_element_mismatch for depth difference >= 2", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module
            const { depthAnalysis } = await import("/main.js");
            // expected depth 4, available depth 1 => diff = 3
            return depthAnalysis("r.3.11.7.1", ["r.0", "r.1"]);
        });

        expect(result.expectedDepth).toBe(4);
        expect(result.depthDifference).toBeGreaterThanOrEqual(2);
        expect(result.likelyCause).toBe("directive_element_mismatch");
    });

    test("returns missing_marker when depths match exactly", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module
            const { depthAnalysis } = await import("/main.js");
            // expected depth 2, available has depth 2 => diff = 0
            return depthAnalysis("r.3.1", ["r.3.2", "r.3.5"]);
        });

        expect(result.expectedDepth).toBe(2);
        expect(result.nearestAvailableDepth).toBe(2);
        expect(result.depthDifference).toBe(0);
        expect(result.likelyCause).toBe("missing_marker");
    });

    test("returns duplicate_node when depth difference is 1", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module
            const { depthAnalysis } = await import("/main.js");
            // expected depth 3, available has depth 2 => diff = 1
            return depthAnalysis("r.3.1.0", ["r.3.1", "r.3.2"]);
        });

        expect(result.expectedDepth).toBe(3);
        expect(result.nearestAvailableDepth).toBe(2);
        expect(result.depthDifference).toBe(1);
        expect(result.likelyCause).toBe("duplicate_node");
    });

    test("handles empty available paths", async ({ page }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module
            const { depthAnalysis } = await import("/main.js");
            return depthAnalysis("r.3.11.7.1", []);
        });

        expect(result.commonPrefix).toBe("");
        expect(result.expectedDepth).toBe(4);
        expect(result.nearestAvailableDepth).toBe(0);
        expect(result.depthDifference).toBe(4);
        expect(result.likelyCause).toBe("directive_element_mismatch");
    });

    test("computes common prefix correctly", async ({ page }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module
            const { depthAnalysis } = await import("/main.js");
            // All share prefix "r.3."
            return depthAnalysis("r.3.11.7", ["r.3.1", "r.3.2"]);
        });

        expect(result.commonPrefix).toBe("r.3.");
    });

    test("picks nearest available depth for comparison", async ({ page }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module
            const { depthAnalysis } = await import("/main.js");
            // expected depth 3, available depths: 1, 2, 5 => nearest = 2 (diff 1)
            return depthAnalysis("r.3.1.0", ["r.0", "r.3.1", "r.3.1.2.3.4"]);
        });

        expect(result.expectedDepth).toBe(3);
        expect(result.nearestAvailableDepth).toBe(2);
        expect(result.depthDifference).toBe(1);
    });

    test("reproduces history_btr hydration mismatch pattern", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async () => {
            // @ts-expect-error: Client module
            const { depthAnalysis } = await import("/main.js");

            // Real-world scenario: client expects deep path from f-repeat
            // directive nesting, but server emitted flat markers.
            // Expected: r.3.11.7.1.1.1.0 (depth 7)
            // Available: r.0 through r.5 (depth 1 each)
            return depthAnalysis(
                "r.3.11.7.1.1.1.0",
                ["r.0", "r.1", "r.2", "r.3", "r.4", "r.5"]
            );
        });

        // Large depth mismatch → directive_element_mismatch
        expect(result.expectedDepth).toBe(7);
        expect(result.nearestAvailableDepth).toBe(1);
        expect(result.depthDifference).toBe(6);
        expect(result.likelyCause).toBe("directive_element_mismatch");
    });
});
