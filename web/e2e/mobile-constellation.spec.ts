import { test, expect, type Page } from "@playwright/test";

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

function queryRange(url: string): string {
  const u = new URL(url);
  return `${u.searchParams.get("from")}|${u.searchParams.get("to")}`;
}

async function enterExperience(page: Page): Promise<void> {
  const enter = page.getByRole("button", { name: /enter/i });
  await expect(enter).toBeVisible();
  await enter.click();
  await expect(page.locator(".landing")).toHaveCount(0);
}

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
  await enterExperience(page);

  // The regression was: SVG measured 0x0 while the landing was still fading,
  // so no dots ever appeared. Give the animation + requestAnimationFrame retry
  // headroom, but fail before anyone mistakes blank for "working".
  const dots = page.locator("svg.constellation path.dot");
  await expect(dots.first()).toBeVisible({ timeout: 10_000 });
  await expect(dots).toHaveCount(3, { timeout: 10_000 });
});

test("constellation recovers after a viewport orientation change", async ({ page }) => {
  await page.goto("/");
  await enterExperience(page);

  const dots = page.locator("svg.constellation path.dot");
  await expect(dots).toHaveCount(3, { timeout: 10_000 });

  // Rotate to landscape and assert dots are still present (ResizeObserver path).
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(dots).toHaveCount(3, { timeout: 10_000 });
});

test("secondary controls are hidden behind More toggle on mobile", async ({ page }) => {
  // Use a typical mobile viewport
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await enterExperience(page);

  const moreBtn = page.locator("#moreBtn");
  await expect(moreBtn).toBeVisible();

  const studioBtn = page.locator("#studioBtn");
  // Should be hidden by CSS display:none on mobile
  await expect(studioBtn).not.toBeVisible();

  await moreBtn.click();

  // Should become visible when secondary-controls gets the is-open class
  await expect(studioBtn).toBeVisible();
});

test("mobile step controls request a different timeline window", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const windowRequests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/window?")) windowRequests.push(req.url());
  });

  await page.goto("/");
  await enterExperience(page);
  await expect.poll(() => windowRequests.length).toBeGreaterThan(0);

  const initialRange = queryRange(windowRequests[windowRequests.length - 1]);
  const prevBtn = page.locator("#windowPrevBtn");
  await expect(prevBtn).toBeVisible();
  await prevBtn.click();

  await expect.poll(() => windowRequests.length).toBeGreaterThan(1);
  const afterPrevRange = queryRange(windowRequests[windowRequests.length - 1]);
  expect(afterPrevRange).not.toBe(initialRange);
});
