import { test, expect } from "@playwright/test";

// Fixed sample returned by the mocked /api/window endpoint. Enough rows to
// exercise time/sentiment scales and the category shape branches.
const SAMPLE = {
  from_: "2025-06-01T00:00:00Z",
  to: "2025-12-31T00:00:00Z",
  aggregates: [] as unknown[],
  exemplars: [
    { id: "a", source: "gdelt", category: "business", title: "A", snippet: "", url: "https://example.com/a", author: "", published_at: "2025-06-15T00:00:00Z", sentiment: 0.1, emotions: {}, topics: [], reach: 10 },
    { id: "b", source: "arxiv", category: "science", title: "B", snippet: "", url: "https://example.com/b", author: "", published_at: "2025-07-15T00:00:00Z", sentiment: -0.2, emotions: {}, topics: [], reach: 20 },
    { id: "c", source: "reddit", category: "public", title: "C", snippet: "", url: "https://example.com/c", author: "", published_at: "2025-08-15T00:00:00Z", sentiment: 0.4, emotions: {}, topics: [], reach: 30 },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/window**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SAMPLE) }),
  );
  await page.route("**/api/stats", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ total_posts: 3, by_category: { business: 1, science: 1, public: 1 } }),
    }),
  );
});

test("constellation renders dots on mobile after entering from the landing overlay", async ({ page }) => {
  await page.goto("/");

  // Landing gate: a button labeled "Enter" dismisses the overlay with an 800ms fade.
  const enter = page.getByRole("button", { name: /enter/i });
  await expect(enter).toBeVisible();
  await enter.click();

  // The regression was: SVG measured 0x0 while the landing was still fading,
  // so no dots ever appeared. Give the animation + requestAnimationFrame retry
  // headroom, but fail before anyone mistakes blank for "working".
  const dots = page.locator("svg.constellation path.dot");
  await expect(dots.first()).toBeVisible({ timeout: 10_000 });
  await expect(dots).toHaveCount(3, { timeout: 10_000 });
});

test("constellation recovers after a viewport orientation change", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /enter/i }).click();

  const dots = page.locator("svg.constellation path.dot");
  await expect(dots).toHaveCount(3, { timeout: 10_000 });

  // Rotate to landscape and assert dots are still present (ResizeObserver path).
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(dots).toHaveCount(3, { timeout: 10_000 });
});
