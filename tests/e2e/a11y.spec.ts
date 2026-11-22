import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('home page passes axe-core in default mode', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('home page passes axe-core in panel-open mode', async ({ page }) => {
  await page.goto('/');
  await page.locator('.panel__toggle').click();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('the fleet panel and the search bar pass axe-core', async ({ page }) => {
  // Three new surfaces have never been under axe: the disclosure button,
  // two checkboxes and a search landmark.
  await page.goto('/');
  await page.locator('.hud__summary').click();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('the city names pass axe-core, which they can only do zoomed in', async ({ page }) => {
  // A label that only exists below a 350 NM cap is a label axe has never
  // seen. The nodes are aria-hidden, not focusable and pointer-events:
  // none — they are geography, not commands, and announcing 24 of them
  // into a live region that already speaks about the feed would be noise
  // over the thing that matters (D43).
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => {
    const w = window as unknown as { __airViewZoomTo?: (d: number) => void };
    return typeof w.__airViewZoomTo === 'function';
  });
  await page.evaluate(() => {
    const w = window as unknown as { __airViewZoomTo?: (d: number) => void };
    // 1,8 units out is a cap of about 250 NM, inside the SCALERANK <= 4 band
    // where the worst measured case is 26 candidates.
    w.__airViewZoomTo?.(1.8);
  });
  await page.waitForTimeout(500);
  await expect(page.locator('.city').first()).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
